"""Orquestación del escaneo (ranker fundamental híbrido, método whitepaper DeepSeek).

Embudo para ir rápido y barato sin perder profundidad donde importa:
  1. universo ENTERO del screener de NASDAQ (~3.000 tras suelo de liquidez en dólares y tope
     `universe_max_names`; sin suelo de capitalización) — las posiciones abiertas y los tickers
     de `always_deep_tickers` van siempre dentro
  2. bloque macro común sin LLM: datos de mercado, eventos y titulares (ver `macro.get_macro`)
  3. PASO 1 — pre-score de todo el universo en paralelo, 1 llamada por nombre → ranking 1-100.
     Lo sirve `prescore_provider` (hoy Jev), no el DeepSeek del resto del embudo
  3b. capa media (interruptor de Alpha, apagada por defecto): repuntúa los mejores de cada
     sector — el carril "global" del corte a finalistas sale de esa segunda opinión
  4. PASO 2 — informe PROFUNDO (DeepSeek) en los finalistas (`deep_finalists_cap`)
  5. el leaderboard persiste SOLO los analizados a fondo. La watchlist ya NO se alimenta: el
     paper no la tiene y dejó de dar acceso al profundo (ver donde se arma `always`)
  6. SELECCIÓN fiel al paper (código): top-N por score PROFUNDO, desempate por market cap →
     el constructor (DeepSeek) solo ASIGNA PESOS a los ya seleccionados (Exhibit 2E)
  6b. cartera de Jev (solo con prescore de Jev): top 5 del prescore, máx. 2 por industria, 20%
     cada una. Sombra sin dinero: solo se guarda para medir su rentabilidad bruta
  7. traduce a trades con aritmética EXACTA (Decimal, nunca el LLM); SOLO si el escaneo DECIDE
     persiste la propuesta, ejecuta la sombra y propone a la real. Un escaneo con `decide=False`
     es OBSERVATORIO: aprende (ranking/memoria/traza) sin tocar libros

El único escaneo PROGRAMADO es el mensual, que siempre decide (ver `scheduler.py`). El
observatorio y la muestra rotatoria (`scan_sample_size`, `_CURSOR_KEY`) siguen existiendo para
los lanzamientos manuales de Alpha; el cron semanal que los usaba se retiró.

El dinero lo calcula el código; el LLM solo decide los pesos. El coste se acumula del `usage`
que devuelve el proveedor y viaja en result["cost"]; el histórico real por escaneo vive en
`ScanRun.cost_usd`, que es donde hay que mirarlo en vez de fiarse de un número escrito aquí.

Este módulo solo ORQUESTA. La matemática de cartera (selección, pesos, diff a trades) vive en
`app.portfolio_service`; la ejecución del libro sombra, en `app.execution_service`.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app import execution_service, scan_audit, scan_config, scan_progress
from app import instruments as instruments_mod
from app import portfolio_service as portfolio
from app import watchlist as watchlist_mod
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.config import settings
from app.ledger import service as ledger
from app.llm import deepseek as deepseek_mod
from app.llm import get_llm
from app.llm.jev import JevProvider
from app.llm.trace import LLMTrace
from app.models import (
    Proposal,
    ProposalItem,
    ProposalOmitted,
    ScanRun,
    ScanRunChange,
    ScanRunConstructionItem,
    ScanRunConstructionOmitted,
    ScanRunFailure,
    ScanRunFinalist,
    ScanRunFinalistNews,
    ScanRunIssue,
    ScanRunJevItem,
    ScanRunMacroHeadline,
    ScanRunTiming,
    Score,
)
from app.scan_guardrails import (
    _aparta_opadas,
    _flag_constructor_backfill,
    _lista,
    _log_funnel,
)
from app.scan_llm_stage import _llm_for, _prescore_llm, _sampling_kwargs, _stage_cfg
from app.scan_persist import (
    _guardar_cost_breakdown,
    _guardar_news_used,
    _guardar_trade_items,
    _llm_usage,
)
from app.scan_state import _advance_scan_cursor, _memory_store, _scan_cursor
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod
from app.screener import universe as universe_mod
from app.screener import universe_global

logger = logging.getLogger(__name__)

# Concurrencia del prescore: mira `prescore_provider`, no `llm_provider` — mid/deep siguen en
# DeepSeek pase lo que pase aquí (ver `_prescore_llm`). Jev va PRIMERO y aparte: antes caía al
# `elif` de abajo (mira `llm_provider`, no `prescore_provider`) y heredaba los 500 de DeepSeek
# sin querer -- 15x el techo real de Jev.
if settings.prescore_provider == "jev" and settings.typesafe_api_key:
    # Techo documentado: 1.200 req/min = 20 req/s (docs.typesafe.ai/models, verificado
    # 17-sep-2026). Latencia real medida en las pruebas de evaluación: 1,29-3,19s/llamada (ver
    # docs/jev-typesafe-ai.md) -- con 20 hilos, incluso en el caso más rápido (~1,3s), el
    # throughput sostenido queda en ~15 req/s, con margen bajo el techo.
    _PRESCORE_WORKERS = 20
elif settings.prescore_provider == "qwen" and settings.dashscope_api_key:
    _PRESCORE_WORKERS = 100  # QwenCloud: 15.000 RPM/cuenta documentado, sin medir en vivo aún.
elif settings.llm_provider == "deepseek":
    _PRESCORE_WORKERS = 500   # Flash, triaje individual (1 llamada/ticker, fiel al paper)
else:
    _PRESCORE_WORKERS = 10

if settings.llm_provider == "deepseek":
    _MID_WORKERS = 100        # Pro, capa media (~200 candidatos)
    # 50->40 (escaneo 57, 1-sep): 156 429 y 51 nombres perdidos "no parseable tras reintento" --
    # el reintento (2 extra en `_deep()`/`_mid()`) disparaba casi inmediato, sin esperar nada,
    # así que si el primer intento chocaba con el rate limit de DeepSeek los siguientes chocaban
    # también, casi seguro, contra la MISMA ventana. Bajar la concurrencia es más simple y más
    # seguro que confiar solo en el backoff para absorber picos.
    _DEEP_WORKERS = 40        # Pro, profundo (hasta `deep_finalists_cap` finalistas)
else:
    _MID_WORKERS = _DEEP_WORKERS = 10

# Espera antes de cada reintento en `_mid()`/`_deep()` (ver arriba): un 429 puntual de DeepSeek
# suele resolverse solo si se le da un respiro; reintentar sin esperar nada choca casi seguro
# contra la misma ventana de rate limit.
_RETRY_BACKOFF_S = 2.0
# Proveedor de prescore caído (clave inválida, outage): sin este corte, cada uno de los ~3.000
# nombres agota sus 2 reintentos igual, machacando un proveedor que ya no responde.
_PRESCORE_CORTE_FALLOS = 50
# Gather: 4 hilos vía yahoo_scraper (validado 100% limpio a 3.000/3.000 tickers reales, en
# local, 24-ago-2026). 6 hilos ya cae a ~85% (bloqueo de Yahoo); 4 es el techo con margen.
_GATHER_WORKERS = 4
# Pausa/hilo (0,4s): validada en vivo junto con _GATHER_WORKERS.
# Se aplica en fundamentals.gather(), no yahoo_scraper.py (módulo limpio, solo HTTP).
_GATHER_PACE_S = 0.4
# 180s cooldown tras última petición: no alcanza (Yahoo bloquea horas, no minutos).
# Red de seguridad para fallos parciales, no arreglo del bloqueo.
_GATHER_RETRY_COOLDOWN_S = 180.0


class ScanCancelado(RuntimeError):
    """Distinto de un RuntimeError normal para que `pipeline._run()` marque status="cancelled"
    en vez de "error" -- mismo camino de aborto, pero no es un fallo, es lo que se pidió."""


def _revisar_cancelado(cancel_event: threading.Event | None) -> None:
    """Punto de control entre etapas caras — best-effort, evita entrar en la siguiente etapa si
    alguien ya pidió cancelar, pero no corta llamadas ya en vuelo dentro de una."""
    if cancel_event is not None and cancel_event.is_set():
        raise ScanCancelado("Escaneo cancelado por el usuario antes de completarse.")


def _dormir_cancelable(seconds: float, cancel_event: threading.Event | None) -> None:
    """Como `time.sleep(seconds)` pero en trozos de 1s -- el cooldown del gather_retry puede ser
    de hasta 180s, y una espera de una sola pieza ignoraba una cancelación pedida durante ella
    (el botón "Detener" parecía no hacer nada hasta que pasaban los 180s enteros)."""
    fin = time.monotonic() + seconds
    while True:
        _revisar_cancelado(cancel_event)
        restante = fin - time.monotonic()
        if restante <= 0:
            return
        time.sleep(min(1.0, restante))


def run_scan_and_store(db: Session, sample_size: int | None = None,
                       decide: bool = True,
                       llm_overrides: dict | None = None,
                       reutilizar_ultima_foto: bool = False,
                       modo_universo: str = "nasdaq",
                       cancel_event: threading.Event | None = None) -> dict:
    """Escaneo en 2 pasos (pre-score rápido → profundo en finalistas). Persiste y resume.

    `decide=False` → escaneo OBSERVATORIO (usado hoy por la "simulación" manual de Alpha,
    banco de pruebas de configuración): puntúa el universo y refresca ranking, watchlist,
    memoria vectorial y auditoría — el conocimiento — pero NO pisa la propuesta vigente, NO toca
    el libro sombra y NO crea aprobaciones para la real. El cron programado (`scheduler.py`) es
    mensual único y siempre decide — la señal del scorer es a un mes, así cada elección vive su
    mes y la curva mide la selección, no ruido semanal del LLM.

    `llm_overrides`: {"prescore"|"mid"|"deep"|"constructor": {"model", "reasoning_effort",
    "temperature", "top_p"}} — SOLO para el botón "simulación" de Alpha (banco de pruebas de
    configuración con coste/modelo reales, sin tocar ninguna cartera). El cron y "Analizar
    mercado" no mandan nada, así que se comportan exactamente como antes (defaults de `settings`).

    `reutilizar_ultima_foto`: checkbox de los dos modales de Alpha. Por defecto el gather
    pide dato fresco o de hasta 12h (`fundamentals._FOTO_TTL_H`); con esto a True, usa la última
    foto de cada ticker sin importar su antigüedad — para no esperar un gather completo en
    pruebas a mitad de mes. El cron nunca lo manda (siempre False, dato fresco de verdad).

    `modo_universo`: "nasdaq" (de siempre) o "global_topcap" (los N de mayor `market_cap_usd` del
    universo global soportados por IBKR, ver `universe_global.top_market_cap_usd`) — SOLO para
    el modal de simulación (`decide=False`); depende de que ya exista foto global reciente, así
    que no tiene ventana rotatoria ni cursor (siempre la lista entera, `n=None`).
    """
    scan_progress.reset()
    t_scan_inicio = time.monotonic()
    # Saldo REAL de DeepSeek antes del escaneo (no una estimación por tokens) — comparado con el
    # de después da el coste real de esta tirada exacta. Solo aplica al circuito oficial; None
    # con OpenRouter o si el endpoint de saldo falla (best-effort, no debe romper el escaneo).
    saldo_antes = (
        deepseek_mod.account_balance_usd(settings.deepseek_api_key, settings.deepseek_base_url)
        if settings.llm_provider == "deepseek" and settings.deepseek_api_key else None
    )
    # Duración de cada fase (segundos, ver `ScanRun.timings`): una clave ausente significa que
    # esa fase no llegó a correr (ej. "mid" sin capa media activa), no que tardó 0s.
    timings: dict[str, float] = {}
    # Config efectiva por etapa: override del caller (modal de "simulación") o default de
    # `settings` si no hay nada. `constructor_cfg` se calcula ya aquí aunque su LLM se cree más
    # tarde (lazy, ver más abajo) para no tener que releer `llm_overrides` en dos sitios.
    # OJO con el default de "model" en deep/constructor: se deja en `None` (no en
    # `settings.llm_model` explícito) a propósito — sin override, `get_llm(None, ...)` cae
    # DENTRO de `get_llm()` al mismo `settings.llm_model`, pero pasarlo aquí ya resuelto lo
    # volvía indistinguible de `settings.mid_model` (mismo string, "deepseek-v4-pro") para
    # cualquier caller que decida QUÉ etapa es mirando el modelo pasado a `get_llm()` (los tests
    # de la capa media, ver `_stub_llms` en `test_capa_media_y_opa.py`).
    deep_cfg = _stage_cfg(llm_overrides, "deep", None, settings.deep_reasoning_effort)
    prescore_cfg = _stage_cfg(llm_overrides, "prescore", settings.prescore_model,
                              settings.prescore_reasoning_effort,
                              settings.prescore_temperature)
    mid_cfg = _stage_cfg(llm_overrides, "mid", settings.mid_model, settings.mid_reasoning_effort,
                        settings.mid_temperature)
    constructor_cfg = _stage_cfg(llm_overrides, "constructor", None, settings.reasoning_effort)

    # Traza de llamadas (ver `app/llm/trace.py`): se acumula en memoria y se vuelca de una vez al
    # final, con el `ScanRun` ya escrito para poder referenciarlo.
    traza = LLMTrace()
    deep_llm = _llm_for(deep_cfg, "deep", traza)
    prescore_llm = _prescore_llm(prescore_cfg, bool((llm_overrides or {}).get("prescore")), traza)
    # Capa media (opcional): repuntúa los mejores de cada sector con un modelo mejor que Flash
    # antes del corte a finalistas. Se crea aquí (como los otros dos) para que su coste entre en
    # `_llm_usage` aunque no llegue a usarse ninguna vez si `mid_layer` está desactivado.
    # El interruptor de Alpha (`scan_config.mid_layer_activa`) manda sobre `settings.mid_layer`.
    capa_media = scan_config.mid_layer_activa(db)
    mid_llm = _llm_for(mid_cfg, "mid", traza) if capa_media else None
    # sample_size explícito (pruebas) manda; si no, TODO el universo salvo que se desactive.
    if sample_size is not None:
        n = sample_size
    elif settings.scan_full_universe:
        n = None                                      # None = universo entero
    else:
        n = settings.scan_sample_size

    # 1) Nombres a analizar: posiciones + cartera personal (siempre) + el universo (entero por
    # defecto). La cartera personal (`always_deep_tickers`) es SOLO para que Manuel vea la opinión
    # del sistema sobre sus tickers — entran garantizados a fondo (carril "seguimiento" en
    # `select_finalists`) pero compiten en igualdad en la selección, sin veto ni ventaja; no
    # implica nada sobre la cartera del AGENTE ni toca sus posiciones personales de IBKR
    # (`PersonalPosition`, totalmente aparte).
    # La watchlist ya NO entra: el paper no tiene ninguna capa de "lo que vigilo", y garantizar
    # sitio a los que ya puntuaron alto premia el éxito pasado (que correlaciona con haber subido).
    held = {p.ticker: p for p in ledger.open_positions(db)}
    watch = set(watchlist_mod.tickers(db))   # solo para el badge del ranking, no da acceso
    personal = list(settings.always_deep_tickers)
    always = (list(held.keys())
             + [t for t in personal if t not in held])
    # yahoo_symbol por ticker, SOLO para `modo_universo="global_topcap"` -- NASDAQ cotiza pelado,
    # el gather no necesita el mapa (ver `_gather` más abajo).
    simbolos_global: dict[str, str | None] = {}
    if modo_universo == "global_topcap":
        # Universo FIJO (el top N por market cap ya rankeado, ver `top_market_cap_usd`): sin
        # ventana rotatoria ni cursor -- eso es un concepto de la muestra semanal de NASDAQ, que
        # aquí no aplica. Depende de que ya exista foto global con `market_cap_usd`, así que no
        # hay "fuente vivo/seed" que degradar: o hay candidatos, o no hay scan.
        candidatos = universe_global.top_market_cap_usd(db, limite=settings.global_topcap_size)
        if not candidatos:
            raise RuntimeError(
                "Sin candidatos para el universo global por market cap: hace falta una foto "
                "global reciente con market_cap_usd ya calculado (ver /admin/foto?alcance=global "
                "y el job de tasas de cambio de las 5:00)."
            )
        simbolos_global = dict(candidatos)
        n = None
        sample = list(dict.fromkeys(always + [t for t, _ in candidatos]))
        universo_info = {"fuente": "global_topcap", "size": len(candidatos), "dias": None,
                         "sobre_suelo": None, "at": datetime.now(UTC).isoformat()}
    else:
        # Muestra semanal = ventana ROTATORIA (offset persistido) para tejer el universo sin
        # repetir; el mensual (n=None) coge el universo entero y no mueve el cursor.
        # El universo sale de la FOTO del último cierre: el volumen de NASDAQ es el acumulado de
        # la sesión en curso, así que filtrar en caliente a las 10:15 ET dejaba fuera casi todo el
        # mercado y colaba justo lo que tenía actividad anormal esa mañana.
        universo, universo_info = universe_mod.universe_for_scan(db)
        if universo_info["fuente"] == "seed":
            # Fallar RUIDOSAMENTE es mejor que escanear: un ranking salido de 40 nombres de
            # emergencia parecería normal en la web y no lo es.
            raise RuntimeError(
                f"Sin universo: NASDAQ no responde y no hay foto del cierre guardada. El escaneo "
                f"se aborta antes de gastar nada (solo había {universo_info['size']} nombres de "
                f"emergencia). Se reintenta en el próximo cierre o a mano."
            )
        if decide and universo_info["fuente"] != "cierre":
            # Un observatorio con el universo a medias es un mal menor (avisa y aprende); una
            # DECISIÓN que elige la cartera del mes con medio mercado mirado, no.
            raise RuntimeError(
                "Decisión abortada: no hay foto del universo del último cierre y en vivo el "
                f"mercado sale a medias ({universo_info['size']} nombres). Elegir la cartera del "
                "mes así sería mirar una fracción del mercado. Repite cuando exista la foto."
            )
        sample = universe_mod.sample_for_scan(always, n, _scan_cursor(db), universe=universo)
        # OJO: el cursor NO avanza aquí sino al final. Avanzarlo ahora consumía la franja
        # aunque el escaneo reventase a mitad, y esos nombres no volvían hasta la siguiente vuelta.

    # Incidencias para el informe persistido: los fallos PARCIALES que hasta ahora solo se
    # veían leyendo los logs de Railway (fuentes caídas, LLM no parseable, nombres sin datos).
    issues: list[str] = []
    # Con qué universo se trabajó: si algún día son 40 nombres (SEED) o una foto rancia, tiene
    # que verse en el panel. Antes, un universo degradado pasaba por un escaneo normal.
    if universo_info["fuente"] == "vivo":
        issues.append(f"Universo tomado EN VIVO ({universo_info['size']} nombres): no había foto "
                      "del cierre. Con el mercado abierto el volumen va a medias y el universo "
                      "sale recortado.")
    elif (universo_info["dias"] or 0) > 4:
        issues.append(f"La foto del universo tiene {universo_info['dias']} días "
                      "(¿el job del cierre no está corriendo?).")
    sobre_suelo = universo_info.get("sobre_suelo") or universo_info["size"]
    if sobre_suelo > universo_info["size"] * 1.15:
        # Que el tope recorte algo es lo normal y no es noticia (el número exacto viaja igual en
        # `universe.sobre_suelo`). Solo es incidencia cuando recorta MUCHO: ahí lo que dice es
        # que el suelo de liquidez se quedó corto y el tope está eligiendo por él.
        issues.append(f"El tope está recortando fuerte: {sobre_suelo} nombres pasaban el suelo "
                      f"de liquidez y solo se escanearon los {universo_info['size']} de más "
                      "volumen. Conviene subir el suelo en dólares.")

    # 2) Gather ANTES que el macro: si Yahoo está caído entero, se aborta sin descargar nada más.
    # _GATHER_WORKERS/PACE_S: validados en vivo (2 hilos, 0,4s pausa) para yahoo_scraper.
    fund_mod._GATHER_PACE_S = _GATHER_PACE_S
    ttl_h = float("inf") if reutilizar_ultima_foto else fund_mod._FOTO_TTL_H

    def _gather(ticker: str):
        data, err = fund_mod.gather(ticker, db=db, ttl_h=ttl_h,
                                    yahoo_symbol=simbolos_global.get(ticker),
                                    es_dataset=modo_universo == "global_topcap")
        return ticker, data, err

    def _run_gather(tickers: list[str]) -> list[tuple[str, object, str | None]]:
        """Consume ex.map uno a uno para marcar progreso por nombre sin acumular en lista.
        Comprueba cancelación en cada nombre -- antes el gather (la etapa más larga del escaneo,
        miles de tickers a 4 hilos) no miraba `cancel_event` en ningún punto, así que "Detener
        escaneo" no hacía nada visible hasta que el gather entero terminaba solo."""
        out: list[tuple[str, object, str | None]] = []
        categorias: Counter[str] = Counter()
        cancelado = False
        with ThreadPoolExecutor(max_workers=_GATHER_WORKERS) as ex:
            for t, d, e in ex.map(_gather, tickers):
                if cancel_event is not None and cancel_event.is_set():
                    cancelado = True
                    break
                out.append((t, d, e))
                razon = f"{t}: {e}" if d is None and e else None
                scan_progress.tick(ok=d is not None, reason=razon)
                if d is None and e:
                    categorias[fund_mod.categoria_fallo(e)] += 1
                if len(out) % 250 == 0:
                    snap = scan_progress.snapshot()
                    logger.info("gather %d/%d: %d ok, %d fallidos",
                               len(out), len(tickers), snap["ok"], snap["fail"])
            if cancelado:
                # Mismo criterio que prescore/profundo: corta lo que no había arrancado, lo ya
                # en vuelo (como mucho _GATHER_WORKERS peticiones) termina solo.
                ex.shutdown(wait=False, cancel_futures=True)
        if categorias:
            logger.info("Gather terminado, fallos por tipo: %s",
                        ", ".join(f"{k}={v}" for k, v in categorias.most_common()))
        if cancelado:
            raise ScanCancelado("Escaneo cancelado por el usuario durante el gather.")
        return out

    scan_progress.set_stage("gather", total=len(sample), unit="tickers")
    logger.info("Escaneo: iniciando GATHER (%d nombres).", len(sample))
    t0 = time.monotonic()
    gathered = _run_gather(sample)
    t_ultimo_gather = time.monotonic()          # fin del gather Y arranque del reloj del cooldown
    timings["gather"] = round(t_ultimo_gather - t0, 1)
    logger.info("Escaneo: GATHER completado en %.1fs.", timings["gather"])

    fallidos = [t for t, d, _e in gathered if d is None]
    if fallidos:
        # Reintento en bloque (no por ticker): miles de reintentos alargaría escaneo sin límite.
        espera = _GATHER_RETRY_COOLDOWN_S - (time.monotonic() - t_ultimo_gather)
        if espera > 0:
            _dormir_cancelable(espera, cancel_event)
        scan_progress.set_stage("gather_retry", total=len(fallidos), unit="tickers")
        logger.info("Escaneo: iniciando GATHER_RETRY (%d nombres).", len(fallidos))
        t0 = time.monotonic()
        reintentados = {t: (t, d, e) for t, d, e in _run_gather(fallidos)}
        timings["gather_retry"] = round(time.monotonic() - t0, 1)
        logger.info("Escaneo: GATHER_RETRY completado en %.1fs.", timings["gather_retry"])
        gathered = [reintentados.get(t, (t, d, e)) for t, d, e in gathered]

    failed = [t for t, d, _e in gathered if d is None]      # gather sin datos, tras el reintento
    if failed:
        issues.append(f"{len(failed)} nombre(s) sin datos de mercado: " + ", ".join(failed))
    # Motivo real por ticker (antes se tragaba entero) — va a `ScanRun.failures` con el resto.
    gather_errors = [(t, e) for t, d, e in gathered if d is None and e]
    datos_ok = [d for _t, d, _e in gathered if d is not None]
    if not datos_ok:
        # Cero nombres útiles tras gather + reintento: Yahoo caído o universo roto.
        raise RuntimeError(
            f"Gather sin ningún dato útil: los {len(sample)} nombres fallaron (Yahoo caído o "
            "universo roto). El escaneo se aborta antes del macro."
        )

    # 3) Macro sin LLM. DeepSeek ve siempre el bloque con contexto (E); Jev, según su interruptor.
    _revisar_cancelado(cancel_event)
    scan_progress.set_stage("macro")
    logger.info("Escaneo: iniciando MACRO.")
    t0 = time.monotonic()
    macro = macro_mod.get_macro(db)
    macro_block = macro_mod.bloque_macro(macro)
    es_jev = isinstance(prescore_llm, JevProvider)
    jev_macro = scan_config.jev_macro_activa(db) if es_jev else None
    macro_block_pre = macro_mod.bloque_macro(macro, con_contexto=jev_macro is not False)
    timings["macro"] = round(time.monotonic() - t0, 1)
    logger.info("Escaneo: MACRO completado en %.1fs (bloque %d chars, prescore %d chars, "
                "Jev con contexto=%s, fuentes=%s).", timings["macro"], len(macro_block),
                len(macro_block_pre), jev_macro, macro.get("events"))

    ev = macro.get("events")
    if ev is not None:
        if not ev.get("wiki") and not ev.get("sched"):
            issues.append("Eventos macro: Wikipedia sin contenido (¿bloqueo del User-Agent?).")
        # La fuente principal es Google News y GDELT la reserva (ver macro.py).
        # Que GDELT no traiga nada dejó de ser noticia: lo raro —y lo que hay que avisar— es que
        # falle la principal, o que fallen las dos.
        if not ev.get("gnews"):
            if ev.get("gdelt"):
                issues.append("Eventos macro: Google News sin titulares; cubrió la reserva "
                              "de GDELT.")
            else:
                issues.append("Eventos macro: sin titulares — Google News y la reserva de "
                              "GDELT cayeron a la vez.")
    if not macro.get("datos"):
        issues.append("Datos de mercado del macro no disponibles (Yahoo): el bloque va sin ellos.")

    # 4) PASO 1 — prescore rápido (Flash) en lotes. Agrupa sobrecarga fija de llamadas.
    # Reintento lote (hasta 2 extra) vive en scorer.prescore_batch(), no aquí.
    _prescore_kw = _sampling_kwargs(prescore_cfg)

    # Racha de fallos seguidos en `_pre_uno` = proveedor caído, no mala suerte por ticker.
    # Lo comparten los hilos del pool, de ahí el lock.
    _corte_lock = threading.Lock()
    _corte_estado = {"consecutivos": 0, "cortado": False, "ultimo_error": None}

    def _pre_uno(d):
        if _corte_estado["cortado"]:
            # Ya cortado: ni una llamada más al proveedor para los nombres aún sin arrancar.
            return [(scorer_mod.PrescoreResult(
                d.ticker, 0.0, error="Prescore cortado: proveedor caído"), d)]
        p = scorer_mod.prescore_one(prescore_llm, d, macro_block_pre, **_prescore_kw)
        for _ in range(2):   # mismo criterio que capa media/profundo: DOS reintentos, no uno
            if not p.error:
                break
            p = scorer_mod.prescore_one(prescore_llm, d, macro_block_pre, **_prescore_kw)
        scan_progress.tick(ok=not p.error, reason=f"{p.ticker}: {p.error}" if p.error else None)
        with _corte_lock:
            if p.error:
                _corte_estado["consecutivos"] += 1
                _corte_estado["ultimo_error"] = p.error
                if _corte_estado["consecutivos"] >= _PRESCORE_CORTE_FALLOS:
                    if not _corte_estado["cortado"]:
                        logger.error(
                            "Prescore cortado: %d nombres seguidos fallaron (¿proveedor caído o "
                            "clave inválida?). Último error: %s",
                            _PRESCORE_CORTE_FALLOS, p.error)
                    _corte_estado["cortado"] = True
            else:
                _corte_estado["consecutivos"] = 0
        return [(p, d)]

    def _pre_lote(lote: list):
        notas = scorer_mod.prescore_batch(prescore_llm, lote, macro_block_pre, **_prescore_kw)
        par = [(notas[d.ticker], d) for d in lote]
        # Fallo de lote = mismo criterio que `pre_errors` más abajo (`p.error`, lote no
        # parseable/degenerado tras reintentos internos de `prescore_batch`).
        errores = [p for p, _d in par if p.error]
        scan_progress.tick(ok=not errores,
                           reason=f"{errores[0].ticker}: {errores[0].error}" if errores else None)
        return par

    # Individual (fiel al paper, 1 llamada/ticker, hasta 2 reintentos) — solo DeepSeek directo.
    # Lotes SOLO con OpenRouter (pruebas locales): el overhead fijo por llamada detrás de su
    # alias de ~28 proveedores sí lo justifica; en DeepSeek directo los lotes costaban MÁS (cada
    # entrada repite el ticker en la respuesta) sin comprar nada a cambio.
    if settings.llm_provider == "deepseek":
        tareas = datos_ok
        correr, unidad = _pre_uno, "nombres"
    else:
        tam_lote = settings.prescore_batch_size
        tareas = [datos_ok[i:i + tam_lote] for i in range(0, len(datos_ok), tam_lote)]
        correr, unidad = _pre_lote, "lotes"

    _revisar_cancelado(cancel_event)
    scan_progress.set_stage("prescore", total=len(tareas), unit=unidad)
    logger.info("Escaneo: iniciando PRESCORE (%d %s, %d nombres, modelo=%s, reasoning=%s).",
               len(tareas), unidad, len(datos_ok),
               prescore_cfg["model"], prescore_cfg["reasoning_effort"])
    t0 = time.monotonic()
    por_lote: list = []
    with ThreadPoolExecutor(max_workers=_PRESCORE_WORKERS) as ex:
        futs = [ex.submit(correr, t) for t in tareas]
        cancelado = False
        for fut in as_completed(futs):
            if cancel_event is not None and cancel_event.is_set():
                cancelado = True
                break
            por_lote.append(fut.result())
        if cancelado:
            # Corta lo que aún no había arrancado; lo ya en vuelo termina solo (no se puede
            # abortar una llamada HTTP a media petición).
            ex.shutdown(wait=False, cancel_futures=True)
    if cancelado:
        raise ScanCancelado("Escaneo cancelado por el usuario durante el prescore.")
    if _corte_estado["cortado"]:
        raise RuntimeError(
            f"Prescore cortado: {_PRESCORE_CORTE_FALLOS} nombres seguidos fallaron (¿proveedor "
            f"caído o clave inválida?). Último error: {_corte_estado['ultimo_error']}"
        )
    timings["prescore"] = round(time.monotonic() - t0, 1)
    logger.info("Escaneo: PRESCORE completado en %.1fs.", timings["prescore"])
    results = [par for lote_res in por_lote for par in lote_res]   # aplanado, 1 par por ticker

    prescored = [r for r in results if r[0].score > 0]
    # Desempate por market cap (criterio del paper): evita que orden de llegada decida frontera.
    prescored.sort(key=lambda x: (-x[0].score, -(x[1].market_cap or 0.0)))
    # Fallo prescore = p.error (lote no parseable/degenerado tras 3 intentos).
    # Van a auditoría stage="prescore_error"; si no, desaparecen sin rastro.
    pre_errors = [(p, d) for p, d in results if p.error]
    if pre_errors:
        # Agrupa por motivo: lote comparte error; listarlo 20x no suma info (1 línea/motivo).
        por_motivo: dict[str, list[str]] = {}
        for p, _d in pre_errors:
            por_motivo.setdefault(p.error, []).append(p.ticker)
        partes = [f"{motivo} ({len(tickers)}): {', '.join(tickers)}"
                 for motivo, tickers in por_motivo.items()]
        issues.append(f"{len(pre_errors)} pre-score(s) fallidos — " + " · ".join(partes))

    # Finalistas al profundo: top-2/sector (amplitud) ∪ top-15 global + posiciones + watchlist,
    # truncado a un tope duro. El corte YA NO es ciego al macro (el prescore lo ve entero), así
    # que deja de colapsar en defensivo-value.
    data_by_t = {d.ticker: d for _p, d in prescored}

    # Capa media: top-N/sector repuntuados (segunda opinión). El interruptor manda en todo escaneo.
    mid_scores: dict[str, float] | None = None
    if capa_media:
        mid_candidates = portfolio.top_por_sector(prescored, settings.mid_per_sector)
        if len(mid_candidates) > settings.mid_candidates_cap:
            sectores = {(d.sector or "").strip() for _p, d in prescored}
            issues.append(
                f"capa media: {len(mid_candidates)} candidatos (más de "
                f"{settings.mid_candidates_cap}); se recortan a los de mayor pre-score. "
                f"Sectores distintos vistos: {len(sectores - {''})}.")
            mid_candidates = mid_candidates[:settings.mid_candidates_cap]
        elif len(mid_candidates) < settings.mid_candidates_cap:
            # Relleno top-prescore global (sin duplicar ya entraron por sector).
            ya = {t for t in mid_candidates}
            relleno = [p.ticker for p, _d in prescored if p.ticker not in ya]
            mid_candidates += relleno[:settings.mid_candidates_cap - len(mid_candidates)]

        _mid_kw = _sampling_kwargs(mid_cfg)

        def _mid(ticker: str):
            p = scorer_mod.mid_prescore(mid_llm, data_by_t[ticker], macro_block, **_mid_kw)
            for _ in range(2):   # mismo criterio que el prescore: DOS reintentos, no uno
                if not p.error:
                    break
                time.sleep(_RETRY_BACKOFF_S)
                p = scorer_mod.mid_prescore(mid_llm, data_by_t[ticker], macro_block, **_mid_kw)
            scan_progress.tick(ok=not p.error, reason=f"{ticker}: {p.error}" if p.error else None)
            return p

        _revisar_cancelado(cancel_event)
        scan_progress.set_stage("mid", total=len(mid_candidates), unit="candidatos")
        logger.info("Escaneo: iniciando MID (%d candidatos, modelo=%s, reasoning=%s).",
                   len(mid_candidates), mid_cfg["model"], mid_cfg["reasoning_effort"])
        t0 = time.monotonic()
        with ThreadPoolExecutor(max_workers=_MID_WORKERS) as ex:
            mid_results = list(ex.map(_mid, mid_candidates))
        timings["mid"] = round(time.monotonic() - t0, 1)
        logger.info("Escaneo: MID completado en %.1fs.", timings["mid"])
        # Si falla: nombre conserva pre-score (error de transporte no es veredicto).
        crudo = {p.ticker: p.score for p, _d in prescored}
        mid_scores = {p.ticker: (crudo.get(p.ticker, 0.0) if p.error else p.score)
                      for p in mid_results}

    # Sin capa media (semanal): carril sectorial=2 (garantiza profundo ve cada sector).
    per_sector = settings.deep_per_sector_mid if mid_scores else settings.deep_per_sector
    # Carril "watchlist" vacío a propósito: ver el motivo donde se arma `always`.
    finalists, lanes = portfolio.select_finalists(
        prescored, set(held), (),
        per_sector, settings.deep_finalists_cap,
        top_caps=settings.deep_top_caps, mid_scores=mid_scores, tracked=personal)

    # 5) PASO 2 — profundo (V4-Pro) + price target en finalistas.
    # Memoria vectorial solo al final (remember). Tesis previa quitada: cada escaneo juzga desde cero.
    store = _memory_store()

    _deep_kw = _sampling_kwargs(deep_cfg)

    def _deep(ticker: str):
        r = scorer_mod.score(deep_llm, data_by_t[ticker], macro_block, **_deep_kw)
        for _ in range(2):   # mismo criterio que el prescore: DOS reintentos, no uno
            if not r.error:
                break
            time.sleep(_RETRY_BACKOFF_S)
            r = scorer_mod.score(deep_llm, data_by_t[ticker], macro_block, **_deep_kw)
        return r

    _revisar_cancelado(cancel_event)
    scan_progress.set_stage("deep", total=len(finalists), unit="finalistas")
    logger.info("Escaneo: iniciando DEEP (%d finalistas, modelo=%s, reasoning=%s).",
               len(finalists), deep_cfg["model"] or settings.llm_model, deep_cfg["reasoning_effort"])
    t0 = time.monotonic()
    analizados: dict[str, scorer_mod.ScoreResult] = {}
    with ThreadPoolExecutor(max_workers=_DEEP_WORKERS) as ex:
        futs = [ex.submit(_deep, t) for t in finalists]
        cancelado = False
        for fut in as_completed(futs):
            if cancel_event is not None and cancel_event.is_set():
                cancelado = True
                break
            res = fut.result()
            analizados[res.ticker] = res
            # Score 0 = fallo parseo (profundo puntúa 1-100).
            scan_progress.tick(ok=res.score > 0,
                               reason=f"{res.ticker}: {res.error}" if res.error else None)
        if cancelado:
            ex.shutdown(wait=False, cancel_futures=True)
    if cancelado:
        raise ScanCancelado("Escaneo cancelado por el usuario durante el profundo.")
    timings["deep"] = round(time.monotonic() - t0, 1)
    logger.info("Escaneo: DEEP completado en %.1fs.", timings["deep"])
    # Score 0 = fallo parseo. Cae del ranking y NO llega watchlist (guardarraíl memoria).
    deep = {t: r for t, r in analizados.items() if r.score > 0}
    deep_caidos = sorted(set(analizados) - set(deep))
    if deep_caidos:
        detalle = ", ".join(
            f"{t}[{(analizados[t].error or '?').split(':')[0]}]" for t in deep_caidos)
        issues.append("Informe profundo no parseable tras reintento (fuera del ranking): "
                      + detalle)

    price_map = {d.ticker: d.price for _p, d in prescored if d.price}
    instr_prices = instruments_mod.prices()        # {} si el allowlist UCITS está vacío
    price_map.update(instr_prices)
    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in deep}
    # score_map: profundo para finalistas, pre-score para resto (watchlist/display), ambos enteros.
    score_map = {p.ticker: (deep[p.ticker].score if p.ticker in deep else round(p.score))
                 for p, _d in prescored}
    target_map = {t: r.target_price for t, r in deep.items()}

    # Última salida limpia: lo de aquí en adelante empieza a persistir de verdad (Score, memoria,
    # ScanRun...). Cancelar después de este punto ya no evita nada.
    _revisar_cancelado(cancel_event)

    # 6) Leaderboard: DECISIÓN reemplaza total; OBSERVATORIO refresca solo hoy-profundos. Las
    # noticias se congelan en los dos casos (`_guardar_news_used`), un observatorio es traza igual.
    # Foto prev ranking/watchlist para detectar novedades (qué entra/sale) en informe.
    prev_ranking = {s.ticker for s in db.query(Score).all()}
    prev_watch = set(watchlist_mod.tickers(db))
    refreshed = 0
    if decide:
        db.query(Score).delete()
        for ticker, d in deep.items():
            data = data_by_t[ticker]
            score_row = Score(
                ticker=ticker, sector=data.sector, score=d.score,
                headline=d.headline, report=d.report,
                price=data.price, market_cap=data.market_cap, target_price=d.target_price,
                held=ticker in held, on_watchlist=ticker in watch,  # provisional: resella al final
                under_acquisition=d.under_acquisition,
            )
            db.add(score_row)
            db.flush()   # necesita el id para las noticias hermanas
            _guardar_news_used(db, score_row.id, data.news)
    else:
        existing = {s.ticker: s for s in db.query(Score).all()}
        for ticker, d in deep.items():
            row = existing.get(ticker)
            if row is None:
                continue                       # nombre nuevo del semanal: no entra al ranking
            data = data_by_t[ticker]
            row.score, row.headline, row.report = d.score, d.headline, d.report
            row.price, row.market_cap = data.price, data.market_cap
            row.target_price, row.sector = d.target_price, data.sector
            row.under_acquisition = d.under_acquisition
            _guardar_news_used(db, row.id, data.news)
            refreshed += 1
    db.commit()
    if store:                                      # guarda las tesis nuevas para recordarlas luego
        for t, d in deep.items():
            try:
                # Informe COMPLETO, no un corte a 400 chars: `MemoryStore.remember()` trocea y
                # embebe por ventanas (ver `memory/store.py`), ya no hace falta cortar aquí.
                store.remember(f"{d.headline} {d.report}", kind="thesis", ticker=t)
            except Exception:
                pass
    # Watchlist SIN alimentar: no está en el paper y ya no da acceso al profundo (ver `always`).
    # El módulo y la tabla se quedan: lo guardado sigue viéndose, pero deja de crecer.

    # 7) SELECCIÓN fiel al paper: top-N por SCORE PROFUNDO, desempate por MARKET CAP.
    #    (La convicción del constructor solo pondera; no re-selecciona.)
    #    Antes del corte se apartan las opadas (ver `_aparta_opadas`).
    selected = portfolio.select_top(
        _aparta_opadas(list(deep.values()), issues),
        mcap_map, settings.min_buy_score, settings.select_count)
    constructor_llm = None
    if not selected and not held:
        floor = settings.min_buy_score
        reason = (f"Ningún finalista alcanza el suelo de score ({floor})" if floor > 0
                  else "No se analizó ningún nombre")
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary=f"{reason} — 100% en caja.",
        )
    else:
        # Informe COMPLETO por candidato, no un titular — fiel a Exhibit 2E ("we have the
        # following reports for the stocks that were scored the highest").
        candidates_text = portfolio.candidates_text(
            selected, {t: d.sector for t, d in data_by_t.items()}, mcap_map)
        candidates_text += instruments_mod.prompt_block(instr_prices)  # UCITS ('' si vacío)
        valid = {r.ticker for r in selected} | set(instr_prices)
        scan_progress.set_stage("constructor")
        logger.info("Escaneo: iniciando CONSTRUCTOR (%d candidatos, modelo=%s, reasoning=%s).",
                   len(selected), constructor_cfg["model"] or settings.llm_model,
                   constructor_cfg["reasoning_effort"])
        t0 = time.monotonic()
        # Instancia SEPARADA (no `deep_llm`): el constructor lleva su propio reasoning (ver
        # config.py). Se crea aquí, justo antes de usarse, para no alterar el ORDEN de las
        # llamadas a `get_llm()` que usan los tests para distinguir prescore/mid/deep.
        constructor_llm = _llm_for(constructor_cfg, "constructor", traza)
        construction = constructor_mod.construct(
            constructor_llm, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions,
            **_sampling_kwargs(constructor_cfg),
        )
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)
        timings["constructor"] = round(time.monotonic() - t0, 1)
        logger.info("Escaneo: CONSTRUCTOR completado en %.1fs.", timings["constructor"])
        _flag_constructor_backfill(construction, issues)

    # 8) Trades con aritmética exacta (la cartera que PROPONDRÍA hoy; solo se persiste al decidir).
    high52_map = {t: d.high_52w for t, d in data_by_t.items()}
    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map,
                                   high52_map)
    macro_line = construction.summary

    # Cartera de Jev: sombra sin dinero, calculada en todo escaneo y sin llamadas.
    jev_cartera: list = []
    if es_jev:
        opadas = {t for t, r in deep.items() if r.under_acquisition is True}
        jev_cartera = portfolio.cartera_jev(prescored, opadas, settings.jev_portfolio_n,
                                            settings.jev_max_por_industria)
        if len(jev_cartera) < settings.jev_portfolio_n:
            issues.append(f"Cartera Jev incompleta: {len(jev_cartera)} de "
                          f"{settings.jev_portfolio_n} nombres (industria desconocida u opadas).")

    # Traza de auditoría del embudo (diagnóstico; nunca debe tirar el escaneo).
    try:
        scan_audit.record(db, prescored=prescored, failed=failed, finalists=finalists,
                          deep=deep, selected=selected, construction=construction,
                          pre_errors=pre_errors, deep_errors=deep_caidos, decide=decide,
                          lanes=lanes, mid_scores=mid_scores,
                          jev_cartera={p.ticker for p, _d in jev_cartera} if es_jev else None)
    except Exception:
        logger.exception("No se pudo escribir la traza de auditoría (no aborta el escaneo).")

    modo = "decisión" if decide else "observatorio"
    cadence = f"{modo}/full" if n is None else f"{modo}/muestra {n}"
    _log_funnel(cadence, sample, prescored, failed, finalists, data_by_t, selected,
                construction, instr_prices)

    # 9) DECISIÓN (mensual o manual): persistir la propuesta, ejecutar la sombra y proponer a
    #    la real. El escaneo observatorio termina antes de este bloque: el libro conserva la
    #    cartera del último decidido para que cada elección viva su mes entero.
    if decide:
        prop = Proposal(cash_target_pct=construction.cash_pct, macro_summary=macro_line)
        db.add(prop)
        db.flush()   # necesita el id para los items/omitted hermanos
        _guardar_trade_items(db, ProposalItem, "proposal_id", prop.id, items)
        for o in construction.omitted:
            db.add(ProposalOmitted(proposal_id=prop.id, ticker=o.ticker, reason=o.reason))
        db.commit()
        # Sombra: se ejecuta SOLA, sin botones — dinero simulado, cero riesgo. Ventas antes que
        # compras (execute_proposal_all lo garantiza) para que la caja se libere primero. Un
        # fallo aquí NUNCA debe tirar el escaneo (los datos ya están persistidos y a salvo).
        try:
            exec_result = execution_service.execute_proposal_all(db)
            logger.info("Auto-ejecución sombra: %s", exec_result["message"])
            issues.extend(f"Sombra, item saltado: {s}" for s in exec_result["skipped"])
        except Exception as exc:  # noqa: BLE001 — el motivo va al informe del escaneo
            logger.exception("Fallo en la auto-ejecución del libro sombra (no aborta el escaneo).")
            issues.append(f"Auto-ejecución del libro sombra falló: {exc}")
        # Real: cada trade propuesto queda PENDIENTE de tu Sí/No (push best-effort). El agente
        # jamás ejecuta solo — ni siquiera en dry-run.
        try:
            from app import approvals as approvals_mod
            approvals_mod.create_from_items(db, items, macro_line)
        except Exception as exc:  # noqa: BLE001 — el motivo va al informe del escaneo
            logger.exception("No se pudieron crear las aprobaciones del modo real.")
            issues.append(f"No se pudieron crear las aprobaciones de Alpha: {exc}")
    else:
        logger.info("Escaneo observatorio: ranking, watchlist y memoria al día; la cartera "
                    "(sombra y real) no se toca — la decisión es mensual.")
    # La watchlist es "lo que VIGILO y no tengo": lo que esté en cartera sale de ella (el update
    # del paso 5 pudo re-meter posiciones re-analizadas; tras decidir, también lo recién comprado).
    watchlist_mod.drop(db, {p.ticker for p in ledger.open_positions(db)})

    # Novedades vs el escaneo anterior — van al informe (el panel las pinta en su línea).
    # OJO: se compara contra la composición FINAL de la tabla (no contra `deep`): en
    # observatorio el conjunto de tickers no cambia (solo se refrescan valores de filas ya
    # existentes), así que sale vacío de forma natural. Comparar contra `deep` habría anunciado
    # "entra/sale" para nombres que en realidad ni se añadieron ni se borraron de Score.
    changes: list[str] = []
    final_ranking = {s.ticker for s in db.query(Score).all()}
    entran = sorted(final_ranking - prev_ranking)
    salen = sorted(prev_ranking - final_ranking)
    if entran or salen:
        partes = ([f"entran {_lista(entran)}"] if entran else []) \
            + ([f"salen {_lista(salen)}"] if salen else [])
        changes.append(f"Ranking ({len(deep)} a fondo): " + " · ".join(partes))
    watch_now = set(watchlist_mod.tickers(db))
    # El badge del ranking (`held` y `on_watchlist`) se estampó ANTES de ejecutar los trades de
    # este escaneo y de actualizar/limpiar la watchlist, así que iba un escaneo por detrás
    # (marcaba en seguimiento nombres ya comprados o ya caducados, y no en cartera lo que este
    # mismo escaneo acababa de comprar). Se re-sella contra el estado REAL de después: `held`
    # llevaba el mismo desfase que `on_watchlist` y solo este último se corregía.
    held_now = {p.ticker for p in ledger.open_positions(db)}
    for s in db.query(Score).all():
        s.on_watchlist = s.ticker in watch_now
        s.held = s.ticker in held_now
    db.commit()

    w_in = sorted(watch_now - prev_watch)
    w_out = sorted(prev_watch - watch_now)
    if w_in or w_out:
        partes = ([f"entra {_lista(w_in)}"] if w_in else []) \
            + ([f"sale {_lista(w_out)}"] if w_out else [])
        changes.append(f"Watchlist ({len(watch_now)} vigilados): " + " · ".join(partes))

    # La ventana rotatoria avanza AL FINAL, con el escaneo ya analizado, auditado y decidido: si
    # revienta a mitad, esta franja no se consume y le vuelve a tocar en la siguiente pasada.
    if n is not None:
        _advance_scan_cursor(db, n)

    timings["total"] = round(time.monotonic() - t_scan_inicio, 1)
    logger.info("Escaneo: TOTAL %.1fs. Por fase: %s", timings["total"],
               ", ".join(f"{fase}={dur}s" for fase, dur in timings.items() if fase != "total"))
    coste = _llm_usage(prescore=prescore_llm, mid=mid_llm,
                       profundo=deep_llm, constructor=constructor_llm)
    # NO se relee el saldo al terminar: DeepSeek liquida con retraso y la resta salía a menos de
    # la mitad de lo real (medido: $0,04 al acabar vs $0,10 minutos después, con $0,103 estimados
    # por tokens). Se guarda el saldo de ANTES; la resta contra el `saldo_antes` del escaneo
    # siguiente sí está liquidada y se calcula offline sobre `ScanRun`.
    coste["saldo_antes_usd"] = saldo_antes
    # Confianza del prescore resumida: los logs de Railway caducan (y a 3.000 llamadas descartan
    # líneas), así que el único sitio donde se puede leer DESPUÉS es el informe persistido.
    _confs = sorted(p.confidence for p, _d in prescored if p.confidence is not None)
    confianza = {
        "n": len(_confs), "min": round(_confs[0], 4), "max": round(_confs[-1], 4),
        "mediana": round(_confs[len(_confs) // 2], 4),
        "bajo_umbral": sum(1 for c in _confs if c < scorer_mod._LOW_CONFIDENCE),
        "umbral": scorer_mod._LOW_CONFIDENCE,
    } if _confs else None
    result = {
        "universe": universo_info,
        "scanned": len(sample), "prescored": len(prescored), "deep": len(deep),
        # Solo cuenta en observatorio; en decisión el ranking se reemplaza entero (None).
        "refreshed": None if decide else refreshed,
        "confianza_prescore": confianza,
        "watchlist": len(watchlist_mod.tickers(db)),
        "proposed": len([i for i in items if i["action"] != "mantener"]),
        "positions": len(construction.positions),
        "decided": decide,
        # coste con `by_stage` además de `by_model` (ver `_llm_usage`) — `mid_llm` puede ser None
        # (desactivada), se tolera igual que a un FakeLLM sin `usage`.
        "cost": coste,
        "outlook": macro.get("datos") or "",
        "jev_macro": jev_macro,
        "jev_cartera": [
            {"ticker": p.ticker, "industry": d.industry, "score": p.score,
             "confidence": p.confidence, "weight_pct": round(100 / len(jev_cartera), 2)}
            for p, d in jev_cartera
        ],
        # Duración por fase, segundos (ver `timings` arriba) — clave ausente = fase no corrió.
        "timings": timings,
    }
    try:
        # Fila HISTÓRICA (nunca se pisa) y además el informe de `/scan/report`. `finalists`/
        # `construction`: recuperación completa, decida o no — `Proposal` solo existe al decidir.
        pre_map = {p.ticker: p.score for p, _d in prescored}
        selected_set = {r.ticker for r in selected}
        funded_map = {p.ticker: p.weight_pct for p in construction.positions}
        finalists_detail = [
            {
                "ticker": t, "sector": data_by_t[t].sector,
                "prescore": pre_map.get(t), "price": data_by_t[t].price,
                "market_cap": data_by_t[t].market_cap,
                "mid_score": (mid_scores or {}).get(t),
                "deep_score": deep[t].score if t in deep else None,
                "high_52w": data_by_t[t].high_52w,
                "headline": deep[t].headline if t in deep else None,
                # Informe completo + guardarraíles del target: `Score` se pisa en cuanto ese
                # ticker se re-analiza, esta fila no — es el archivo de verdad de esa fecha.
                "report": deep[t].report if t in deep else None,
                "target_price": deep[t].target_price if t in deep else None,
                "selected": t in selected_set, "funded": t in funded_map,
                "weight_pct": funded_map.get(t),
                "error": analizados[t].error if t in deep_caidos else None,
                "under_acquisition": deep[t].under_acquisition if t in deep else None,
            }
            for t in finalists
        ]
        failures_detail = (
            [{"ticker": t, "etapa": "gather", "error": e, "raw": None} for t, e in gather_errors]
            + [{"ticker": p.ticker, "etapa": "prescore", "error": p.error, "raw": p.raw}
               for p, _d in pre_errors]
            + [{"ticker": t, "etapa": "profundo", "error": analizados[t].error,
                "raw": analizados[t].raw} for t in deep_caidos]
        )
        coste = result["cost"]
        run = ScanRun(
            cadence=cadence, decide=decide, refreshed=result["refreshed"],
            regime=macro.get("regime") or "",
            vix=macro.get("vix"), outlook=macro.get("datos") or "", jev_macro=jev_macro,
            universe_fuente=universo_info["fuente"], universe_at=universo_info["at"],
            universe_dias=universo_info["dias"], universe_size=universo_info["size"],
            universe_sobre_suelo=universo_info.get("sobre_suelo"),
            counter_scanned=len(sample), counter_prescored=len(prescored),
            counter_deep=len(deep), counter_selected=len(selected),
            counter_positions=len(construction.positions),
            cost_calls=coste["calls"], cost_prompt_tokens=coste["prompt_tokens"],
            cost_completion_tokens=coste["completion_tokens"],
            cost_cache_hit_tokens=coste["cache_hit_tokens"],
            cost_cache_miss_tokens=coste["cache_miss_tokens"], cost_peak_calls=coste["peak_calls"],
            cost_usd=coste["cost_usd"], cost_cache_hit_ratio=coste["cache_hit_ratio"],
            saldo_antes_usd=coste.get("saldo_antes_usd"),
            construction_cash_pct=construction.cash_pct, construction_summary=construction.summary,
            macro_wiki_events=macro.get("wiki_events_text") or "",
            macro_wiki_scheduled=macro.get("wiki_scheduled_text") or "",
        )
        db.add(run)
        db.flush()   # necesita el id para todas las filas hermanas de abajo
        for fuente, titulares in (macro.get("macro_headlines") or {}).items():
            for i, texto in enumerate(titulares or []):
                db.add(ScanRunMacroHeadline(scan_run_id=run.id, fuente=fuente, posicion=i,
                                            texto=texto))
        _guardar_cost_breakdown(db, run.id, coste)
        for fase, segundos in timings.items():
            db.add(ScanRunTiming(scan_run_id=run.id, fase=fase, segundos=segundos))
        for i, texto in enumerate(issues):
            db.add(ScanRunIssue(scan_run_id=run.id, posicion=i, texto=texto))
        for i, texto in enumerate(changes):
            db.add(ScanRunChange(scan_run_id=run.id, posicion=i, texto=texto))
        for i, j in enumerate(result["jev_cartera"]):
            db.add(ScanRunJevItem(scan_run_id=run.id, posicion=i, ticker=j["ticker"],
                                  industry=(j["industry"] or "")[:64], score=j["score"],
                                  confidence=j["confidence"], weight_pct=j["weight_pct"]))
        for f in failures_detail:
            db.add(ScanRunFailure(scan_run_id=run.id, ticker=f["ticker"], etapa=f["etapa"],
                                  error=f["error"], raw=f["raw"]))
        finalist_rows = []
        for i, f in enumerate(finalists_detail):
            row = ScanRunFinalist(scan_run_id=run.id, posicion=i, **f)
            db.add(row)
            finalist_rows.append(row)
        db.flush()   # necesita el id de cada finalista para colgarle sus noticias
        for row in finalist_rows:
            for j, texto in enumerate(data_by_t[row.ticker].news or []):
                db.add(ScanRunFinalistNews(scan_run_finalist_id=row.id, posicion=j, texto=texto))
        _guardar_trade_items(db, ScanRunConstructionItem, "scan_run_id", run.id, items)
        for o in construction.omitted:
            db.add(ScanRunConstructionOmitted(scan_run_id=run.id, ticker=o.ticker,
                                              reason=o.reason))
        db.commit()
        scan_run_id = run.id
    except Exception:
        logger.exception("No se pudo persistir ScanRun (no aborta el escaneo).")
        scan_run_id = None
    try:
        # Va fuera del try de arriba: si `ScanRun` falla, la traza se guarda igual (suelta, sin
        # escaneo al que colgarse) — es justo cuando más falta hace.
        logger.info("Traza LLM: %d llamadas guardadas.", traza.flush(db, scan_run_id))
    except Exception:
        logger.exception("No se pudo persistir la traza de llamadas (no aborta el escaneo).")
    scan_progress.set_stage("done")
    return result


def recheck(db: Session) -> dict:
    """Re-comprobación del top: re-corre SOLO la construcción sobre los nombres ya analizados a
    fondo (report != ''), reutilizando sus informes/scores/targets guardados y aplicando el suelo
    ACTUAL. No re-escanea el universo → instantáneo y casi gratis (1 llamada de construcción)."""
    llm = get_llm(reasoning_effort=settings.reasoning_effort)   # solo construcción
    deep = (db.query(Score).filter(Score.report != "").order_by(Score.score.desc()).all())
    if not deep:
        raise ValueError("No hay análisis profundo previo; lanza un escaneo primero.")

    floor = settings.min_buy_score
    held = {p.ticker: p for p in ledger.open_positions(db)}
    price_map = {r.ticker: r.price for r in deep if r.price}
    mcap_map = {r.ticker: (r.market_cap or 0.0) for r in deep}
    score_map = {r.ticker: r.score for r in deep}
    target_map = {r.ticker: r.target_price for r in deep}
    # Mismo guardarraíl que el escaneo: `recheck` reconstruye sobre informes ya guardados, sin
    # esto una opada apartada volvería a entrar. Filas antiguas con el campo a NULL no se apartan.
    issues_recheck: list[str] = []
    selected = portfolio.select_top(
        _aparta_opadas(deep, issues_recheck), mcap_map, floor, settings.select_count)
    macro_block = macro_mod.bloque_macro(macro_mod.get_macro(db))

    if not selected and not held:
        reason = (f"Ningún nombre del top alcanza el suelo ({floor})" if floor > 0
                  else "No hay nombres analizados")
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary=f"{reason} — 100% en caja.")
    else:
        candidates_text = portfolio.candidates_text(
            selected, {r.ticker: r.sector for r in selected}, mcap_map)
        valid = {r.ticker for r in selected}
        construction = constructor_mod.construct(
            llm, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions)
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)
        _flag_constructor_backfill(construction, issues_recheck)

    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map)
    prop = Proposal(cash_target_pct=construction.cash_pct, macro_summary=construction.summary)
    db.add(prop)
    db.flush()
    _guardar_trade_items(db, ProposalItem, "proposal_id", prop.id, items)
    for o in construction.omitted:
        db.add(ProposalOmitted(proposal_id=prop.id, ticker=o.ticker, reason=o.reason))
    db.commit()
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, construction.summary)
    except Exception:
        logger.exception("No se pudieron crear las aprobaciones del modo real.")
    return {"eligible": len(selected), "positions": len(construction.positions),
            "proposed": len([i for i in items if i["action"] != "mantener"]),
            "issues": issues_recheck,
            "cost": _llm_usage(constructor=llm)}  # 1 llamada de construcción


def redeep(db: Session) -> dict:
    """Re-analiza a FONDO (V4-Pro) solo los nombres ya profundizados, con el MACRO ACTUAL.

    Reutiliza el prescore del universo (NO re-escanea los ~1.400) → barato y rápido. Se usa
    cuando se corrige un dato macro y hay que refrescar las notas sin repetir el escaneo entero.
    Re-puntúa limpio (sin inyectar la tesis previa, que se generó con el dato malo).
    """
    deep_rows = db.query(Score).filter(Score.report != "").all()
    if not deep_rows:
        raise ValueError("No hay análisis profundo previo; lanza un escaneo primero.")
    tickers = [r.ticker for r in deep_rows]
    held = {p.ticker: p for p in ledger.open_positions(db)}
    watch = set(watchlist_mod.tickers(db))

    deep_llm = get_llm(reasoning_effort=settings.deep_reasoning_effort)
    macro_block = macro_mod.bloque_macro(macro_mod.get_macro(db))   # macro recién calculado

    def _one(ticker: str):
        data, _err = fund_mod.gather(ticker, db=db)
        if data is None:
            return None
        return data, scorer_mod.score(deep_llm, data, macro_block)   # re-eval limpia, sin prior

    data_by_t: dict = {}
    results: dict = {}
    with ThreadPoolExecutor(max_workers=_DEEP_WORKERS) as ex:
        for out in ex.map(_one, tickers):
            if out is not None:
                data, res = out
                data_by_t[res.ticker] = data
                results[res.ticker] = res

    db.query(Score).delete()
    for t, r in results.items():
        d = data_by_t[t]
        score_row = Score(ticker=t, sector=d.sector, score=r.score, headline=r.headline,
                          report=r.report, price=d.price, market_cap=d.market_cap,
                          target_price=r.target_price, held=t in held, on_watchlist=t in watch,
                          under_acquisition=r.under_acquisition)
        db.add(score_row)
        db.flush()
        _guardar_news_used(db, score_row.id, d.news)
    db.commit()

    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in results}
    price_map = {t: data_by_t[t].price for t in results if data_by_t[t].price}
    score_map = {t: r.score for t, r in results.items()}
    target_map = {t: r.target_price for t, r in results.items()}
    issues_redeep: list[str] = []
    selected = portfolio.select_top(
        _aparta_opadas(list(results.values()), issues_redeep),
        mcap_map, settings.min_buy_score, settings.select_count)
    constructor_llm = None
    if not selected and not held:
        construction = constructor_mod.ConstructionResult(
            cash_pct=100.0, positions=[], summary="Sin candidatos tras re-análisis — 100% caja.")
    else:
        candidates_text = portfolio.candidates_text(
            selected, {t: d.sector for t, d in data_by_t.items()}, mcap_map)
        valid = {r.ticker for r in selected}
        constructor_llm = get_llm(reasoning_effort=settings.reasoning_effort)
        construction = constructor_mod.construct(
            constructor_llm, candidates_text, macro_block,
            settings.max_positions, settings.max_position_pct, valid, settings.min_positions)
        construction = portfolio.finalize_full_invest(
            construction, selected, settings.min_positions, settings.max_positions,
            settings.max_position_pct)
        _flag_constructor_backfill(construction, issues_redeep)

    items = portfolio.build_trades(db, construction, held, price_map, score_map, target_map)
    macro_line = construction.summary
    prop = Proposal(cash_target_pct=construction.cash_pct, macro_summary=macro_line)
    db.add(prop)
    db.flush()
    _guardar_trade_items(db, ProposalItem, "proposal_id", prop.id, items)
    db.commit()
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, macro_line)
    except Exception:
        logger.exception("No se pudieron crear las aprobaciones del modo real.")
    return {"redeep": len(results), "positions": len(construction.positions),
            "proposed": len([i for i in items if i["action"] != "mantener"]),
            "issues": issues_redeep,
            "cost": _llm_usage(profundo=deep_llm, constructor=constructor_llm)}
