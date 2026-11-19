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

from app import foto_service, scan_audit, scan_config, scan_progress
from app import portfolio_service as portfolio
from app.agents import scorer as scorer_mod
from app.config import settings
from app.llm import deepseek as deepseek_mod
from app.llm.jev import JevProvider
from app.llm.trace import LLMTrace
from app.models import (
    ScanRun,
    ScanRunFailure,
    ScanRunIssue,
    ScanRunJevItem,
    ScanRunMacroHeadline,
    ScanRunTiming,
)
from app.proceso_hijo import Cancelado
from app.scan_llm_stage import _prescore_llm, _sampling_kwargs, _stage_cfg
from app.scan_persist import (
    _guardar_cost_breakdown,
    _llm_usage,
)
from app.scan_state import _advance_scan_cursor, _scan_cursor
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


class ScanCancelado(Cancelado):
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


def _foto_de_los_datos(datos: list) -> int | None:
    """La foto de Alpha de la que sale al menos el 90 % de los datos del escaneo, o None si
    se capturó por su cuenta o mezclando fotos."""
    cuenta = Counter(d.foto_id for d in datos if getattr(d, "foto_id", None) is not None)
    if not cuenta:
        return None
    foto_id, n = cuenta.most_common(1)[0]
    return foto_id if n >= 0.9 * len(datos) else None


def muestra_de_decision(siempre: list[str], elegibles: list[str]) -> list[str]:
    """Incluye primero los garantizados y después los elegibles, sin duplicados."""
    return list(dict.fromkeys(siempre + elegibles))


def bloque_macro_prescore(db: Session, macro: dict, prescore_llm) -> tuple[str, bool | None]:
    """Bloque macro del prescore y el interruptor de contexto de Jev (None si no es Jev)."""
    jev_macro = scan_config.jev_macro_activa(db) if isinstance(prescore_llm, JevProvider) else None
    return macro_mod.bloque_macro(macro, con_contexto=jev_macro is not False), jev_macro


def run_scan_and_store(db: Session, sample_size: int | None = None,
                       decide: bool = True,
                       llm_overrides: dict | None = None,
                       reutilizar_ultima_foto: bool = False,
                       modo_universo: str = "nasdaq",
                       cancel_event: threading.Event | None = None,
                       solo_jev: bool = False) -> dict:
    """Escaneo en 2 pasos (pre-score rápido → profundo en finalistas). Persiste y resume.

    `solo_jev=True` es el escaneo mensual de hoy: foto, macro y las notas de Jev de todo el
    universo, la cartera mecánica de Lambda y su traza; sin capa media, profundo, constructor,
    propuesta, libro sombra, aprobaciones ni ranking de Alpha. Escribe lo mismo que lee la liga
    (`scan_runs`, `scan_audit` con las notas y `scan_run_jev_item`).

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
    prescore_cfg = _stage_cfg(llm_overrides, "prescore", settings.prescore_model,
                              settings.prescore_reasoning_effort,
                              settings.prescore_temperature)

    # Traza de llamadas (ver `app/llm/trace.py`): se acumula en memoria y se vuelca de una vez al
    # final, con el `ScanRun` ya escrito para poder referenciarlo.
    traza = LLMTrace()
    prescore_llm = _prescore_llm(prescore_cfg, bool((llm_overrides or {}).get("prescore")), traza)
    # sample_size explícito (pruebas) manda; si no, TODO el universo salvo que se desactive.
    if sample_size is not None:
        n = sample_size
    elif settings.scan_full_universe:
        n = None                                      # None = universo entero
    else:
        n = settings.scan_sample_size

    always: list[str] = []
    # yahoo_symbol por ticker, SOLO para `modo_universo="global_topcap"` -- NASDAQ cotiza pelado,
    # el gather no necesita el mapa (ver `_gather` más abajo).
    tecnicos: set[str] | None = None
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
        tecnicos = set(universo)
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
        if decide and n is None:
            sample = muestra_de_decision(always, universe_mod.tickers_elegibles(db))
        else:
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

    # Un escaneo de decisión sobre el universo entero puntúa una sola foto, y la jornada lee esa.
    foto_escaneo: tuple[int, bool] | None = None
    if decide and modo_universo == "nasdaq" and n is None and not reutilizar_ultima_foto:
        foto_escaneo = foto_service.foto_del_escaneo(db, sample, fund_mod._FOTO_TTL_H)

    def _gather(ticker: str):
        if foto_escaneo is not None:
            foto_id, nueva = foto_escaneo
            if nueva:
                data, err = fund_mod.gather(ticker, db=db, ttl_h=0, foto_id=foto_id)
            else:
                data, err = fund_mod.foto_reciente(db, ticker, foto_id=foto_id), None
                if data is None:
                    data, err = fund_mod.gather(ticker, db=db, ttl_h=ttl_h)
            return ticker, data, err
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

    try:
        scan_progress.set_stage("gather", total=len(sample), unit="tickers")
        logger.info("Escaneo: iniciando GATHER (%d nombres).", len(sample))
        t0 = time.monotonic()
        gathered = _run_gather(sample)
        t_ultimo_gather = time.monotonic()      # fin del gather Y arranque del reloj del cooldown
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

        failed = [t for t, d, _e in gathered if d is None]  # gather sin datos, tras el reintento
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
    except BaseException:
        if foto_escaneo is not None and foto_escaneo[1]:
            foto_service.cerrar_foto(db, foto_escaneo[0], False, 0)
        raise
    if foto_escaneo is not None and foto_escaneo[1]:
        foto_service.cerrar_foto(db, foto_escaneo[0], True, len(datos_ok))

    # 3) Macro sin LLM. DeepSeek ve siempre el bloque con contexto (E); Jev, según su interruptor.
    _revisar_cancelado(cancel_event)
    scan_progress.set_stage("macro")
    logger.info("Escaneo: iniciando MACRO.")
    t0 = time.monotonic()
    macro = macro_mod.get_macro(db)
    macro_block = macro_mod.bloque_macro(macro)
    es_jev = isinstance(prescore_llm, JevProvider)
    macro_block_pre, jev_macro = bloque_macro_prescore(db, macro, prescore_llm)
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
                issues.append("Eventos macro: sin titulares. Google News y la reserva de "
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
    siempre: set[str] = set()
    prescored_tecnico = (portfolio.de_filtro_tecnico(prescored, tecnicos, siempre)
                        if tecnicos is not None else prescored)
    prescored_lambda = portfolio.prescored_lambda(prescored, tecnicos)
    if tecnicos is not None:
        # Un recuento no es una incidencia: va al log, no a `issues`.
        logger.info("Jev puntuó %d nombres; %d entran al análisis (técnicos y garantizados).",
                    len(prescored), len(prescored_tecnico))
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
        issues.append(f"{len(pre_errors)} pre-score(s) fallidos: " +" · ".join(partes))

    # Cartera de Jev: sombra sin dinero, calculada en todo escaneo y sin llamadas.
    _revisar_cancelado(cancel_event)
    jev_cartera: list = []
    if es_jev:
        jev_cartera = portfolio.cartera_jev(prescored_lambda, set(), settings.jev_portfolio_n,
                                            settings.jev_max_por_industria)
        if len(jev_cartera) < settings.jev_portfolio_n:
            issues.append(f"Cartera Jev incompleta: {len(jev_cartera)} de "
                          f"{settings.jev_portfolio_n} nombres (industria desconocida u opadas).")

    # Traza de auditoría del embudo (diagnóstico; nunca debe tirar el escaneo).
    audit_at = None
    try:
        audit_at = scan_audit.record(
            db, prescored=prescored, failed=failed, pre_errors=pre_errors, decide=decide,
            tecnicos=tecnicos,
            jev_cartera={p.ticker for p, _d in jev_cartera} if es_jev else None)
    except Exception:
        logger.exception("No se pudo escribir la traza de auditoría (no aborta el escaneo).")

    cadence = "jev/full" if n is None else f"jev/muestra {n}"


    # La ventana rotatoria avanza AL FINAL, con el escaneo ya analizado, auditado y decidido: si
    # revienta a mitad, esta franja no se consume y le vuelve a tocar en la siguiente pasada.
    if n is not None:
        _advance_scan_cursor(db, n)

    timings["total"] = round(time.monotonic() - t_scan_inicio, 1)
    logger.info("Escaneo: TOTAL %.1fs. Por fase: %s", timings["total"],
               ", ".join(f"{fase}={dur}s" for fase, dur in timings.items() if fase != "total"))
    coste = _llm_usage(prescore=prescore_llm)
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
        "scanned": len(sample), "prescored": len(prescored),
        "confianza_prescore": confianza,
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
        # Fila HISTÓRICA del escaneo de Jev (la que lee `/scan/report`): sin profundo ni cartera.
        failures_detail = (
            [{"ticker": t, "etapa": "gather", "error": e, "raw": None} for t, e in gather_errors]
            + [{"ticker": p.ticker, "etapa": "prescore", "error": p.error, "raw": p.raw}
               for p, _d in pre_errors]
        )
        coste = result["cost"]
        run = ScanRun(
            cadence=cadence, decide=decide, refreshed=None,
            regime=macro.get("regime") or "",
            vix=macro.get("vix"), outlook=macro.get("datos") or "", jev_macro=jev_macro,
            universe_fuente=universo_info["fuente"], universe_at=universo_info["at"],
            universe_dias=universo_info["dias"], universe_size=universo_info["size"],
            universe_sobre_suelo=universo_info.get("sobre_suelo"),
            counter_scanned=len(sample), counter_prescored=len(prescored),
            counter_deep=0, counter_selected=0, counter_positions=0,
            cost_calls=coste["calls"], cost_prompt_tokens=coste["prompt_tokens"],
            cost_completion_tokens=coste["completion_tokens"],
            cost_cache_hit_tokens=coste["cache_hit_tokens"],
            cost_cache_miss_tokens=coste["cache_miss_tokens"], cost_peak_calls=coste["peak_calls"],
            cost_usd=coste["cost_usd"], cost_cache_hit_ratio=coste["cache_hit_ratio"],
            saldo_antes_usd=coste.get("saldo_antes_usd"),
            construction_cash_pct=100.0,
            construction_summary="Escaneo de Jev: sin cartera de Alpha.",
            macro_wiki_events=macro.get("wiki_events_text") or "",
            macro_wiki_scheduled=macro.get("wiki_scheduled_text") or "",
            foto_id=_foto_de_los_datos(datos_ok),
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
        for i, j in enumerate(result["jev_cartera"]):
            db.add(ScanRunJevItem(scan_run_id=run.id, posicion=i, ticker=j["ticker"],
                                  industry=(j["industry"] or "")[:64], score=j["score"],
                                  confidence=j["confidence"], weight_pct=j["weight_pct"]))
        for f in failures_detail:
            db.add(ScanRunFailure(scan_run_id=run.id, ticker=f["ticker"], etapa=f["etapa"],
                                  error=f["error"], raw=f["raw"]))
        db.commit()
        scan_run_id = run.id
    except Exception:
        logger.exception("No se pudo persistir ScanRun (no aborta el escaneo).")
        scan_run_id = None
    if scan_run_id is not None and audit_at is not None:
        try:
            scan_audit.enlazar(db, audit_at, scan_run_id)
        except Exception:
            logger.exception("No se pudo enlazar la auditoría con su escaneo (no aborta).")
    if decide and scan_run_id is not None:
        # Liga (backlog): designa sola la foto+escaneo de la próxima jornada sin foto -- sesión
        # y candado propios, nunca deben tocar ni frenar el escaneo de las salas.
        try:
            from app.liga.procesos import foto as liga_foto
            liga_foto.auto_desde_escaneo(scan_run_id)
        except Exception:
            logger.exception("No se pudo designar la foto automática de la liga (no aborta).")
    try:
        # Va fuera del try de arriba: si `ScanRun` falla, la traza se guarda igual (suelta, sin
        # escaneo al que colgarse) — es justo cuando más falta hace.
        logger.info("Traza LLM: %d llamadas guardadas.", traza.flush(db, scan_run_id))
    except Exception:
        logger.exception("No se pudo persistir la traza de llamadas (no aborta el escaneo).")
    scan_progress.set_stage("done")
    return result


