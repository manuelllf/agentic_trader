"""Orquestación del escaneo (ranker fundamental híbrido, método whitepaper DeepSeek).

Embudo para ir rápido y barato sin perder profundidad donde importa:
  1. universo ENTERO del screener de NASDAQ (~3.000 tras suelo de liquidez en dólares y tope
     `universe_max_names`; sin suelo de capitalización) — las posiciones abiertas y los tickers
     de `always_deep_tickers` van siempre dentro
  2. outlook macro forward (1 llamada V4-Pro)
  3. PASO 1 — pre-score de todo el universo en paralelo, 1 llamada por nombre → ranking 1-100.
     Lo sirve `prescore_provider` (hoy Qwen), no el V4-Pro del resto del embudo
  3b. capa media (`mid_layer`): repuntúa los mejores de cada sector con V4-Pro — el carril
     "global" del corte a finalistas sale de esa segunda opinión en vez de la frontera ruidosa
     del pre-score barato
  4. PASO 2 — informe PROFUNDO (V4-Pro) + price target en los finalistas (`deep_finalists_cap`)
  5. el leaderboard persiste SOLO los analizados a fondo. La watchlist ya NO se alimenta: el
     paper no la tiene y dejó de dar acceso al profundo (ver donde se arma `always`)
  6. SELECCIÓN fiel al paper (código): top-N por score PROFUNDO, desempate por market cap →
     el constructor (V4-Pro) solo ASIGNA PESOS a los ya seleccionados (Exhibit 2E)
  7. traduce a trades con aritmética EXACTA (Decimal, nunca el LLM); SOLO si el escaneo DECIDE
     persiste la propuesta, ejecuta la sombra y propone a la real. Un escaneo con `decide=False`
     es OBSERVATORIO: aprende (ranking/memoria/traza) sin tocar libros

El único escaneo PROGRAMADO es el mensual, que siempre decide (ver `scheduler.py`). El
observatorio y la muestra rotatoria (`scan_sample_size`, `_CURSOR_KEY`) siguen existiendo para
los lanzamientos manuales de Sala Real; el cron semanal que los usaba se retiró.

El dinero lo calcula el código; el LLM solo decide los pesos. El coste se acumula del `usage`
que devuelve el proveedor y viaja en result["cost"]; el histórico real por escaneo vive en
`ScanRun.cost_usd`, que es donde hay que mirarlo en vez de fiarse de un número escrito aquí.

Este módulo solo ORQUESTA. La matemática de cartera (selección, pesos, diff a trades) vive en
`app.portfolio_service`; la ejecución del libro sombra, en `app.execution_service`.
"""

from __future__ import annotations

import json
import logging
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app import execution_service, scan_audit, scan_progress
from app import instruments as instruments_mod
from app import portfolio_service as portfolio
from app import watchlist as watchlist_mod
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.config import settings
from app.ledger import service as ledger
from app.llm import deepseek as deepseek_mod
from app.llm import get_llm
from app.llm.trace import LLMTrace
from app.models import (
    Meta,
    Proposal,
    ProposalItem,
    ProposalOmitted,
    ScanRun,
    ScanRunConstructionItem,
    ScanRunConstructionOmitted,
    ScanRunCostBreakdown,
    ScanRunFailure,
    ScanRunFinalist,
    ScanRunFinalistNews,
    ScanRunIssue,
    ScanRunSector,
    ScanRunTiming,
    Score,
    ScoreNews,
)
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod
from app.screener import universe as universe_mod
from app.screener import universe_global

logger = logging.getLogger(__name__)

# Concurrencia del prescore: mira `prescore_provider`, no `llm_provider` — mid/deep siguen en
# DeepSeek pase lo que pase aquí (ver `_prescore_llm`).
if settings.prescore_provider == "qwen" and settings.dashscope_api_key:
    _PRESCORE_WORKERS = 100  # QwenCloud: 15.000 RPM/cuenta documentado, sin medir en vivo aún.
elif settings.llm_provider == "deepseek":
    _PRESCORE_WORKERS = 500   # Flash, triaje individual (1 llamada/ticker, fiel al paper)
else:
    _PRESCORE_WORKERS = 10

if settings.llm_provider == "deepseek":
    _MID_WORKERS = 100        # Pro, capa media (~200 candidatos)
    _DEEP_WORKERS = 50        # Pro, profundo (hasta `deep_finalists_cap` finalistas)
else:
    _MID_WORKERS = _DEEP_WORKERS = 10
# Gather: 4 hilos vía yahoo_scraper (validado 100% limpio a 3.000/3.000 tickers reales, en
# local, 24-ago-2026). 6 hilos ya cae a ~85% (bloqueo de Yahoo); 4 es el techo con margen.
_GATHER_WORKERS = 4
# Pausa/hilo (0,4s): validada en vivo junto con _GATHER_WORKERS.
# Se aplica en fundamentals.gather(), no yahoo_scraper.py (módulo limpio, solo HTTP).
_GATHER_PACE_S = 0.4
# 180s cooldown tras última petición: no alcanza (Yahoo bloquea horas, no minutos).
# Red de seguridad para fallos parciales, no arreglo del bloqueo.
_GATHER_RETRY_COOLDOWN_S = 180.0
_CURSOR_KEY = "scan_cursor"   # offset persistido de la ventana rotatoria del semanal
_REPORT_KEY = "last_scan_report"   # informe del último escaneo (JSON en Meta; ver /scan/report)


def _write_scan_report(db: Session, *, mode: str | None, result: dict | None,
                       issues: list[str], error: str | None = None,
                       changes: list[str] | None = None) -> None:
    """Persiste informe de último escaneo en Meta (fuente de verdad de la web)."""
    r = result or {}
    report = {
        "at": datetime.now(UTC).isoformat(),
        "mode": mode, "error": error, "issues": issues, "changes": changes or [],
        "universe": r.get("universe"),
        "scanned": r.get("scanned"), "prescored": r.get("prescored"), "deep": r.get("deep"),
        # Refreshed: solo observatorio (decisión reemplaza ranking entero, no refresca).
        "refreshed": r.get("refreshed"),
        "cost": r.get("cost"),
        # Outlook de este escaneo (antes observatorio lo descartaba; ahora siempre visible).
        "outlook": r.get("outlook"),
    }
    db.merge(Meta(key=_REPORT_KEY, value=json.dumps(report, ensure_ascii=False)))
    db.commit()


def write_scan_failure(db: Session, exc: Exception) -> None:
    """Marca escaneo fallido en Meta (sin esto, cron caído pasa invisible en web)."""
    db.rollback()   # la sesión puede venir sucia del fallo a mitad
    _write_scan_report(db, mode=None, result=None, issues=[], error=str(exc))


def _scan_cursor(db: Session) -> int:
    """Offset actual de la ventana rotatoria (0 si aún no existe o está corrupto)."""
    row = db.get(Meta, _CURSOR_KEY)
    try:
        return int(row.value) if row else 0
    except (TypeError, ValueError):
        return 0


def _advance_scan_cursor(db: Session, step: int) -> None:
    """Avanza el offset `step` posiciones para que el próximo semanal teja el siguiente tramo."""
    row = db.get(Meta, _CURSOR_KEY)
    if row:
        row.value = str(_scan_cursor(db) + step)
    else:
        db.add(Meta(key=_CURSOR_KEY, value=str(step)))
    db.commit()


def _memory_store():
    """Singleton de memoria vectorial; None si faltan deps o falla (es una mejora, no requisito)."""
    try:
        from app import memory
        return memory.get_store()
    except Exception:
        logger.warning("Memoria vectorial no disponible — se omite.")
        return None


def _llm_usage(**etapas) -> dict:
    """Suma el uso (llamadas/tokens/coste) de varias etapas nombradas. Tolera `None`/FakeLLM
    sin `usage` (capa media desactivada, tests).

    `by_model` desglosa por modelo (Flash del prescore vs V4-Pro del resto) y `by_stage` por
    ETAPA — necesario aparte porque macro/profundo/constructor comparten el mismo modelo (V4-Pro)
    desde que se dejó OpenRouter: sin `by_stage`, `by_model["deepseek-v4-pro"]` mezclaría las
    tres y ScanRun.cost dejaría de decir en qué paso se fue el dinero, justo lo que `by_model`
    existe para evitar.

    `cache_hit/miss_tokens` y `peak_calls` vienen del proveedor: un escaneo caro puede serlo por
    mal aprovechamiento de la caché (el tramo miss cuesta 30x el de hit) o por haber caído en
    horario peak (el doble), y sin el desglose las dos causas son indistinguibles del total.
    """
    campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
              "cache_miss_tokens", "peak_calls", "cost_usd")
    total = dict.fromkeys(campos, 0)
    total.update(by_model={}, by_stage={})
    for etapa, llm in etapas.items():
        u = getattr(llm, "usage", None)
        if not isinstance(u, dict):
            continue
        for k in campos:
            total[k] += u.get(k, 0)
        for modelo, stats in (u.get("by_model") or {}).items():
            acc = total["by_model"].setdefault(modelo, dict.fromkeys(campos, 0))
            for k in campos:
                acc[k] += stats.get(k, 0)
        total["by_stage"][etapa] = {k: u.get(k, 0) for k in campos}
    prompt_facturado = total["cache_hit_tokens"] + total["cache_miss_tokens"]
    total["cache_hit_ratio"] = (
        round(total["cache_hit_tokens"] / prompt_facturado, 4) if prompt_facturado else None
    )
    total["cost_usd"] = round(total["cost_usd"], 4)
    return total


def _sector(data_by_t: dict, ticker: str) -> str:
    """Sector de un ticker (o 'UCITS' si es un instrumento del allowlist, que no se puntúa)."""
    d = data_by_t.get(ticker)
    return d.sector if d else "UCITS"


def _guardar_news_used(db: Session, score_id: int, news: list[str] | None) -> None:
    """Congela `NameData.news` como filas de `ScoreNews` — nunca como JSON. `None` = el gather no
    trajo noticias (no se distingue de "trajo cero"; ningún lector lo necesitaba).

    Borra las filas previas de este `score_id` antes de insertar: en un observatorio la fila de
    `Score` se REUTILIZA (no se recrea, ver `run_scan_and_store`), así que sin este borrado las
    noticias de escaneos anteriores se irían acumulando debajo de las nuevas en vez de reflejar
    solo lo que entró al prompt en ESTE escaneo."""
    db.query(ScoreNews).filter(ScoreNews.score_id == score_id).delete()
    for i, texto in enumerate(news or []):
        db.add(ScoreNews(score_id=score_id, posicion=i, texto=texto))


def _guardar_trade_items(db: Session, model_cls: type, fk_field: str, fk_id: int,
                         items: list[dict]) -> None:
    """Filas hermanas de `_TradeItemColumns` (`ProposalItem`/`ScanRunConstructionItem`), mismo
    shape que la salida de `portfolio_service.build_trades` — `posicion` conserva su orden."""
    for i, it in enumerate(items):
        db.add(model_cls(**{fk_field: fk_id}, posicion=i, ticker=it["ticker"], action=it["action"],
                          score=it.get("score"),
                          target_weight_pct=it.get("target_weight_pct") or 0.0,
                          price=it.get("price"), target_price=it.get("target_price"),
                          upside_pct=it.get("upside_pct"), target_value=it.get("target_value", "0"),
                          target_shares=it.get("target_shares") or 0.0,
                          delta_shares=it.get("delta_shares") or 0.0,
                          thesis=it.get("thesis", ""), edge=it.get("edge", ""),
                          risk=it.get("risk", "")))


def _guardar_cost_breakdown(db: Session, scan_run_id: int, cost: dict) -> None:
    campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
              "cache_miss_tokens", "peak_calls", "cost_usd")
    for dimension, bucket in (("model", cost.get("by_model") or {}),
                              ("stage", cost.get("by_stage") or {})):
        for clave, stats in bucket.items():
            db.add(ScanRunCostBreakdown(scan_run_id=scan_run_id, dimension=dimension, clave=clave,
                                        **{k: stats.get(k, 0) for k in campos}))


def _lista(ts: list[str], n: int = 10) -> str:
    """Lista de tickers legible y acotada: 'A, B, C y 4 más'."""
    return ", ".join(ts[:n]) + (f" y {len(ts) - n} más" if len(ts) > n else "")


# Guardarraíl de operación corporativa en código: el prompt ya prohíbe mezclar enterprise value
# con precio por acción y aun así falló una vez. Sin acentos porque el informe se normaliza antes.
_CORP_DEAL_TERMS = ("adquisicion", "adquirir", "opa", "oferta en efectivo", "fusion",
                    "merger", "takeover", "absorcion")


def _sin_acentos(texto: str) -> str:
    """Quita acentos/diacríticos para que la búsqueda de términos no dependa de cómo los escriba
    el modelo (el informe viene en español, con o sin tildes según el caso)."""
    return "".join(c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c))


def _aparta_opadas(rows: list, issues: list[str]) -> list:
    """Quita de la selección las empresas que el informe declara OPADAS (`under_acquisition`).

    Con una oferta en efectivo sobre la mesa el precio queda clavado a ella: lo que queda por
    ganar es el hueco hasta el cierre (caso real: ATKR cotizaba a 93,69 con oferta de 95 — un 1,4%)
    a cambio de un riesgo binario de que la operación se caiga. No es la asimetría que busca la
    estrategia, y el modelo le ponía 85 sobre 100 porque lee "incertidumbre eliminada" como algo
    bueno. La fila del Score se queda con su nota y su informe: se aparta de la cartera, no se
    borra de la traza.

    `under_acquisition` a None NO es un "no": es que el modelo se saltó el campo (pasa en ~1 de
    cada 10 respuestas de los modelos rápidos). Se avisa en vez de asumir, porque asumir el "no"
    desactivaría el guardarraíl justo cuando falla. Sirve igual para `ScoreResult` que para filas
    `Score` — ambas exponen `.ticker` y `.under_acquisition`.
    """
    opadas = [r.ticker for r in rows if getattr(r, "under_acquisition", None) is True]
    if opadas:
        issues.append("Fuera de la selección por oferta de adquisición en curso (lo declara el "
                      "propio informe): " + _lista(opadas))
    sin_respuesta = [r.ticker for r in rows if getattr(r, "under_acquisition", None) is None]
    if sin_respuesta:
        issues.append("Sin respuesta al campo de oferta de adquisición (no aparta a nadie): "
                      + _lista(sin_respuesta))
    return [r for r in rows if getattr(r, "under_acquisition", None) is not True]


def _flag_constructor_backfill(construction, issues: list[str]) -> None:
    """Avisa si la cartera final no es (del todo) convicción del LLM, sino relleno por score.

    Antes `positions: 5` salía igual con el constructor sano o caído 3/3 — la única pista era
    el summary, enterrado en un modal que nadie abre a tiempo. Ahora sale en `issues`.
    """
    if construction.summary == constructor_mod.FALLBACK_SUMMARY:
        issues.append("Constructor caído (3 intentos fallidos): la cartera se rellenó "
                      "automáticamente por score, sin tesis del LLM.")
        return
    n = portfolio.backfill_count(construction)
    if n:
        issues.append(f"El constructor solo fondeó {len(construction.positions) - n} de "
                      f"{len(construction.positions)} posiciones; el resto se rellenó por score.")


def _flag_corporate_deal_targets(
    deep: dict, data_by_t: dict, issues: list[str],
) -> tuple[dict, set]:
    """Corrige en sitio `r.target_price` cuando el informe habla de una operación corporativa en
    efectivo Y el objetivo del modelo supera el máximo del consenso en más de un 5%: ahí el
    target_price del código pasa a ser el consenso, no el número (probablemente mal calculado)
    del LLM. Sin `target_high` no se hace nada (no se inventa un techo). Devuelve
    (target_raw, target_flagged) para que el caller los guarde en `Score`.

    Sin efecto hoy: ya no se le pide target_price al profundo, siempre es None. Se queda
    intacta por si algún día vuelve a pedirse."""
    target_raw: dict[str, float] = {}
    target_flagged: set[str] = set()
    for ticker, r in deep.items():
        data = data_by_t[ticker]
        if r.target_price is None or not data.target_high:
            continue
        if r.target_price <= data.target_high * 1.05:
            continue
        texto = _sin_acentos((r.report or "").lower())
        if not any(term in texto for term in _CORP_DEAL_TERMS):
            continue
        target_raw[ticker] = r.target_price
        target_flagged.add(ticker)
        issues.append(
            f"{ticker}: el informe menciona una operación corporativa en efectivo y puso el "
            f"objetivo en {r.target_price:.2f} frente al máximo del consenso de analistas "
            f"({data.target_high:.2f}); se usa el consenso como objetivo efectivo.")
        r.target_price = data.target_high
    return target_raw, target_flagged


def _flag_consensus_echo(deep: dict, data_by_t: dict) -> tuple[dict, set]:
    """Detecta cuándo `target_price` coincide (<0,5%) con el consenso MEDIO de analistas
    (publicado a 12-18 meses, no al mes que se le pide) — indicio de que el modelo copió el
    número en vez de razonar el horizonte corto. A diferencia de `_flag_corporate_deal_targets`,
    NO toca `target_price`: es puro telemetría para medir si el prompt mejora con el tiempo.
    Devuelve (target_consensus_mean, target_echoed_consensus) para que el caller los guarde en
    `Score`.

    Sin efecto hoy: ya no se le pide target_price al profundo, siempre es None."""
    target_consensus_mean: dict[str, float] = {}
    echoed: set[str] = set()
    for ticker, r in deep.items():
        mean = data_by_t[ticker].target_mean
        if r.target_price is None or not mean:
            continue
        if abs(r.target_price - mean) / mean < 0.005:
            echoed.add(ticker)
            target_consensus_mean[ticker] = mean
    return target_consensus_mean, echoed


def _log_funnel(cadence: str, sample: list, prescored: list, failed: list, finalists: list,
                data_by_t: dict, selected: list, construction, instr_prices: dict) -> None:
    """Traza legible del embudo en los logs (Railway/consola): permite ver de un vistazo que el
    corte ya no colapsa en un sector, y si algo va raro saber en qué paso. Best-effort."""
    try:
        def top(counter: Counter, k: int = 6) -> str:
            return ", ".join(f"{s}:{n}" for s, n in counter.most_common(k)) or "n/d"

        fin_sectors = Counter(_sector(data_by_t, t) for t in finalists)
        logger.info("── EMBUDO (%s) ──────────────────────────────", cadence)
        logger.info("  muestra=%d · pre-scoreados=%d · sin datos=%d · finalistas=%d en %d sectores",
                    len(sample), len(prescored), len(failed), len(finalists), len(fin_sectors))
        logger.info("  pre-score por sector: %s", top(Counter(d.sector for _p, d in prescored)))
        logger.info("  finalistas por sector: %s", top(fin_sectors))
        # Confianza del prescore AGREGADA: el aviso por llamada inundaba (>350 líneas/escaneo) y
        # Railway descarta líneas a ese volumen — en el escaneo grande solo sobrevivió el 1%.
        confs = sorted(p.confidence for p, _d in prescored if p.confidence is not None)
        if confs:
            def cuantil(q: float) -> float:
                return confs[min(len(confs) - 1, int(len(confs) * q))]
            bajos = sum(1 for c in confs if c < scorer_mod._LOW_CONFIDENCE)
            logger.info("  confianza prescore (n=%d): min=%.4f p25=%.4f mediana=%.4f max=%.4f · "
                        "por debajo de %.2f: %d (%.0f%%)", len(confs), confs[0], cuantil(0.25),
                        cuantil(0.50), confs[-1], scorer_mod._LOW_CONFIDENCE, bajos,
                        bajos / len(confs) * 100)
        sel = ", ".join(f"{r.ticker}[{_sector(data_by_t, r.ticker)}]={r.score}" for r in selected)
        logger.info("  seleccionados (top-%d): %s", len(selected), sel or "ninguno")
        # Orden en que el constructor los vio (barajado): sin esto no se distingue "eligió por
        # convicción" de "se quedó con los primeros de la lista".
        logger.info("  orden mostrado al constructor: %s",
                    ", ".join(r.ticker for r in portfolio.orden_presentacion(selected)) or "n/d")
        cartera = ", ".join(f"{p.ticker} {p.weight_pct:.0f}%[{_sector(data_by_t, p.ticker)}]"
                            for p in construction.positions) or "vacía"
        logger.info("  CARTERA: %s", cartera)
        # La métrica que se está vigilando: ¿fondeó justo el top-N por score, o de verdad eligió?
        fondeados = {p.ticker for p in construction.positions}
        if fondeados and selected:
            top_n = {r.ticker for r in selected[:len(fondeados)]}
            logger.info("  ¿cartera == top-%d por score? %s", len(fondeados),
                        "SÍ — colapsó al ranking" if fondeados == top_n else "no")
        if instr_prices:
            usados = [p.ticker for p in construction.positions if p.ticker in instr_prices]
            logger.info("  UCITS disponibles=%d · usados=%s", len(instr_prices), usados or "—")
        logger.info("──────────────────────────────────────────────")
    except Exception:
        logger.exception("No se pudo emitir la traza del embudo (no aborta el escaneo).")


DEFAULT_TEMPERATURE = 1.0
DEFAULT_TOP_P = 0.95
# Se mandan en TODAS las etapas, tengan o no razonamiento activo — decisión explícita: aunque
# api-docs.deepseek.com/guides/thinking_mode diga que el modo razonamiento ignora
# `temperature`/`top_p`, no cuesta nada mandarlos igual (el campo se ignora, no rompe la
# llamada) y así el comportamiento no depende de qué reasoning tenga cada etapa hoy — si mañana
# alguna pasa a "none", ya lleva puestos los mismos valores que el resto sin tocar nada aquí.


def _stage_cfg(overrides: dict | None, stage: str, default_model: str,
              default_reasoning: str | None,
              default_temperature: float = DEFAULT_TEMPERATURE) -> dict:
    """Config efectiva de una etapa: lo que mande `overrides[stage]` gana, si no el default de
    `settings` (modelo/reasoning) o `DEFAULT_TEMPERATURE`/`DEFAULT_TOP_P` (muestreo)."""
    o = (overrides or {}).get(stage) or {}
    return {
        "model": o.get("model") or default_model,
        "reasoning_effort": o.get("reasoning_effort", default_reasoning),
        "temperature": o.get("temperature", default_temperature),
        "top_p": o.get("top_p", DEFAULT_TOP_P),
    }


def _llm_for(cfg: dict, stage: str = "", recorder=None):  # noqa: ANN001
    """`get_llm()` con el `model` de la config, PERO solo como argumento posicional cuando hay
    uno de verdad (override, o default de etapa como `prescore_model`/`mid_model`) — igual que
    las llamadas de antes de este refactor. Sin esto, macro/deep/constructor (que antes NO
    pasaban `model` en absoluto, cayendo al default interno de `get_llm()`) pasarían a llamarlo
    siempre con un positional (aunque fuera `None`), cambiando la ARIDAD de la llamada — de lo
    que dependen los fakes de test que distinguen la etapa mirando `*args` (ver
    `test_cadence.py::test_profundo_no_parseable_...`)."""
    if cfg["model"]:
        return get_llm(cfg["model"], reasoning_effort=cfg["reasoning_effort"],
                       stage=stage, recorder=recorder)
    return get_llm(reasoning_effort=cfg["reasoning_effort"], stage=stage, recorder=recorder)


def _prescore_llm(cfg: dict, tiene_override: bool, recorder=None):  # noqa: ANN001
    """Como `_llm_for`, pero SOLO para el prescore: sin override manda `prescore_provider`; con
    override (modal), el modelo que eligió el usuario decide Qwen o DeepSeek (ver `config.py`)."""
    quiere_qwen = (
        cfg["model"] == settings.qwen_model if tiene_override
        else settings.prescore_provider == "qwen"
    )
    if quiere_qwen and settings.dashscope_api_key:
        return get_llm(cfg["model"], reasoning_effort=cfg["reasoning_effort"], stage="prescore",
                       recorder=recorder, provider="qwen")
    return _llm_for(cfg, "prescore", recorder)


def _sampling_kwargs(cfg: dict) -> dict:
    """`temperature`/`top_p` de la config efectiva (override o `DEFAULT_TEMPERATURE`/
    `DEFAULT_TOP_P`, ver `_stage_cfg`) — nunca None, así que siempre van al `llm.chat()` de la
    etapa, tenga o no razonamiento activo."""
    kw = {}
    if cfg.get("temperature") is not None:
        kw["temperature"] = cfg["temperature"]
    if cfg.get("top_p") is not None:
        kw["top_p"] = cfg["top_p"]
    return kw


def run_scan_and_store(db: Session, sample_size: int | None = None,
                       decide: bool = True, force_mid_layer: bool = False,
                       llm_overrides: dict | None = None,
                       reutilizar_ultima_foto: bool = False,
                       modo_universo: str = "nasdaq") -> dict:
    """Escaneo en 2 pasos (pre-score rápido → profundo en finalistas). Persiste y resume.

    `decide=False` → escaneo OBSERVATORIO (usado hoy por la "simulación" manual de Sala Real,
    banco de pruebas de configuración): puntúa el universo y refresca ranking, watchlist,
    memoria vectorial y auditoría — el conocimiento — pero NO pisa la propuesta vigente, NO toca
    el libro sombra y NO crea aprobaciones para la real. El cron programado (`scheduler.py`) es
    mensual único y siempre decide — la señal del scorer es a un mes, así cada elección vive su
    mes y la curva mide la selección, no ruido semanal del LLM.

    `llm_overrides`: {"macro"|"prescore"|"mid"|"deep"|"constructor": {"model", "reasoning_effort",
    "temperature", "top_p"}} — SOLO para el botón "simulación" de Sala Real (banco de pruebas de
    configuración con coste/modelo reales, sin tocar ninguna cartera). El cron y "Analizar
    mercado" no mandan nada, así que se comportan exactamente como antes (defaults de `settings`).

    `reutilizar_ultima_foto`: checkbox de los dos modales de Sala Real. Por defecto el gather
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
    # OJO con el default de "model" en macro/deep/constructor: se deja en `None` (no en
    # `settings.llm_model` explícito) a propósito — sin override, `get_llm(None, ...)` cae
    # DENTRO de `get_llm()` al mismo `settings.llm_model`, pero pasarlo aquí ya resuelto lo
    # volvía indistinguible de `settings.mid_model` (mismo string, "deepseek-v4-pro") para
    # cualquier caller que decida QUÉ etapa es mirando el modelo pasado a `get_llm()` (los tests
    # de la capa media, ver `_stub_llms` en `test_capa_media_y_opa.py`).
    macro_cfg = _stage_cfg(llm_overrides, "macro", None, settings.macro_reasoning_effort)
    deep_cfg = _stage_cfg(llm_overrides, "deep", None, settings.deep_reasoning_effort)
    prescore_cfg = _stage_cfg(llm_overrides, "prescore", settings.prescore_model,
                              settings.prescore_reasoning_effort,
                              settings.prescore_temperature)
    mid_cfg = _stage_cfg(llm_overrides, "mid", settings.mid_model, settings.mid_reasoning_effort)
    constructor_cfg = _stage_cfg(llm_overrides, "constructor", None, settings.reasoning_effort)

    # Instancia PROPIA para el macro (antes compartía `deep_llm`): sin esto, su única llamada se
    # mezclaba con las del profundo en `by_model` (ambos V4-Pro) y el desglose de coste por
    # etapa de `_llm_usage` no podía separarlas.
    # Traza de llamadas (ver `app/llm/trace.py`): se acumula en memoria y se vuelca de una vez al
    # final, con el `ScanRun` ya escrito para poder referenciarlo.
    traza = LLMTrace()
    macro_llm = _llm_for(macro_cfg, "macro", traza)
    deep_llm = _llm_for(deep_cfg, "deep", traza)
    prescore_llm = _prescore_llm(prescore_cfg, bool((llm_overrides or {}).get("prescore")), traza)
    # Capa media (opcional): repuntúa los mejores de cada sector con un modelo mejor que Flash
    # antes del corte a finalistas. Se crea aquí (como los otros dos) para que su coste entre en
    # `_llm_usage` aunque no llegue a usarse ninguna vez si `mid_layer` está desactivado.
    mid_llm = _llm_for(mid_cfg, "mid", traza) if settings.mid_layer else None
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

    # 2) Gather ANTES que el macro: si Yahoo está caído entero, mejor descubrirlo aquí (gratis)
    # que después de haber pagado la llamada de macro (V4-Pro, reasoning alto, la más cara del
    # embudo por llamada única).
    # _GATHER_WORKERS/PACE_S: validados en vivo (2 hilos, 0,4s pausa) para yahoo_scraper.
    fund_mod._GATHER_PACE_S = _GATHER_PACE_S
    ttl_h = float("inf") if reutilizar_ultima_foto else fund_mod._FOTO_TTL_H

    def _gather(ticker: str):
        data, err = fund_mod.gather(ticker, db=db, ttl_h=ttl_h,
                                    yahoo_symbol=simbolos_global.get(ticker),
                                    es_dataset=modo_universo == "global_topcap")
        return ticker, data, err

    def _run_gather(tickers: list[str]) -> list[tuple[str, object, str | None]]:
        """Consume ex.map uno a uno para marcar progreso por nombre sin acumular en lista."""
        out: list[tuple[str, object, str | None]] = []
        categorias: Counter[str] = Counter()
        with ThreadPoolExecutor(max_workers=_GATHER_WORKERS) as ex:
            for t, d, e in ex.map(_gather, tickers):
                out.append((t, d, e))
                razon = f"{t}: {e}" if d is None and e else None
                scan_progress.tick(ok=d is not None, reason=razon)
                if d is None and e:
                    categorias[fund_mod.categoria_fallo(e)] += 1
                if len(out) % 250 == 0:
                    snap = scan_progress.snapshot()
                    logger.info("gather %d/%d: %d ok, %d fallidos",
                               len(out), len(tickers), snap["ok"], snap["fail"])
        if categorias:
            logger.info("Gather terminado, fallos por tipo: %s",
                        ", ".join(f"{k}={v}" for k, v in categorias.most_common()))
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
            time.sleep(espera)
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
        # Cero nombres útiles tras gather + reintento: Yahoo no está disponible (o el universo
        # está roto). Abortar AQUÍ, antes del macro, es justo el ahorro que motiva este orden —
        # sin datos que puntuar, pagar la llamada más cara del embudo no compra nada.
        raise RuntimeError(
            f"Gather sin ningún dato útil: los {len(sample)} nombres fallaron (Yahoo caído o "
            "universo roto). El escaneo se aborta antes del macro, sin gastar en él."
        )

    # 3) Outlook macro forward (V4-Pro, 1 llamada) — ya con la certeza de que hay datos que
    # puntuar con él.
    scan_progress.set_stage("macro")
    logger.info("Escaneo: iniciando MACRO (modelo=%s, reasoning=%s).",
               macro_cfg["model"] or settings.llm_model, macro_cfg["reasoning_effort"])
    t0 = time.monotonic()
    macro = macro_mod.get_macro_outlook(macro_llm, db, **_sampling_kwargs(macro_cfg))
    macro_block = macro_mod.outlook_prompt_block(macro)
    timings["macro"] = round(time.monotonic() - t0, 1)
    logger.info("Escaneo: MACRO completado en %.1fs.", timings["macro"])

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
    if not macro.get("outlook"):
        issues.append("Outlook macro del LLM caído — se usó solo el régimen determinista.")

    # C.4: mediana de P/E por sector calculada sobre ESTE universo, con el mismo campo con el
    # que se puntúa. Nunca de una fuente externa — mezclar metodologías daba el doble de
    # diferencia en financieras. Va como dato pegado al P/E, sin instrucción.
    medianas = (fund_mod.medianas_pe_por_sector(datos_ok)
                if settings.sector_median_in_prompt else {})

    # 4) PASO 1 — prescore rápido (Flash) en lotes. Agrupa sobrecarga fija de llamadas.
    # Reintento lote (hasta 2 extra) vive en scorer.prescore_batch(), no aquí.
    _prescore_kw = _sampling_kwargs(prescore_cfg)

    def _pre_uno(d):
        p = scorer_mod.prescore_one(prescore_llm, d, macro_block, medianas=medianas,
                                    **_prescore_kw)
        for _ in range(2):   # mismo criterio que capa media/profundo: DOS reintentos, no uno
            if not p.error:
                break
            p = scorer_mod.prescore_one(prescore_llm, d, macro_block, medianas=medianas,
                                        **_prescore_kw)
        scan_progress.tick(ok=not p.error, reason=f"{p.ticker}: {p.error}" if p.error else None)
        return [(p, d)]

    def _pre_lote(lote: list):
        notas = scorer_mod.prescore_batch(prescore_llm, lote, macro_block, **_prescore_kw)
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

    scan_progress.set_stage("prescore", total=len(tareas), unit=unidad)
    logger.info("Escaneo: iniciando PRESCORE (%d %s, %d nombres, modelo=%s, reasoning=%s).",
               len(tareas), unidad, len(datos_ok),
               prescore_cfg["model"], prescore_cfg["reasoning_effort"])
    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=_PRESCORE_WORKERS) as ex:
        por_lote = list(ex.map(correr, tareas))
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

    # Capa media: top-N/sector repuntuados (segunda opinión, modelo mejor).
    # Solo en decisiones (no semanal observatorio); force_mid_layer para simulación.
    mid_scores: dict[str, float] | None = None
    if settings.mid_layer and (decide or force_mid_layer):
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
            p = scorer_mod.mid_prescore(mid_llm, data_by_t[ticker], macro_block,
                                        medianas=medianas, **_mid_kw)
            for _ in range(2):   # mismo criterio que el prescore: DOS reintentos, no uno
                if not p.error:
                    break
                p = scorer_mod.mid_prescore(mid_llm, data_by_t[ticker], macro_block,
                                            medianas=medianas, **_mid_kw)
            scan_progress.tick(ok=not p.error, reason=f"{ticker}: {p.error}" if p.error else None)
            return p

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
        r = scorer_mod.score(deep_llm, data_by_t[ticker], macro_block, medianas=medianas,
                             **_deep_kw)
        for _ in range(2):   # mismo criterio que el prescore: DOS reintentos, no uno
            if not r.error:
                break
            r = scorer_mod.score(deep_llm, data_by_t[ticker], macro_block, medianas=medianas,
                                 **_deep_kw)
        return r

    scan_progress.set_stage("deep", total=len(finalists), unit="finalistas")
    logger.info("Escaneo: iniciando DEEP (%d finalistas, modelo=%s, reasoning=%s).",
               len(finalists), deep_cfg["model"] or settings.llm_model, deep_cfg["reasoning_effort"])
    t0 = time.monotonic()
    analizados: dict[str, scorer_mod.ScoreResult] = {}
    with ThreadPoolExecutor(max_workers=_DEEP_WORKERS) as ex:
        for res in ex.map(_deep, finalists):
            analizados[res.ticker] = res
            # Score 0 = fallo parseo (profundo puntúa 1-100).
            scan_progress.tick(ok=res.score > 0,
                               reason=f"{res.ticker}: {res.error}" if res.error else None)
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

    # Guardarraíl de operación corporativa: corrige `target_price` EN SITIO antes de que nada
    # aguas abajo (mapa de objetivos, upside, selección) lo use. Ver docstring de la función.
    target_raw, target_flagged = _flag_corporate_deal_targets(deep, data_by_t, issues)
    # Guardarraíl de eco de consenso: se calcula DESPUÉS del de arriba, sobre el target_price ya
    # corregido si aplicó — solo telemetría, no cambia nada aguas abajo.
    target_consensus_mean, target_echoed = _flag_consensus_echo(deep, data_by_t)

    price_map = {d.ticker: d.price for _p, d in prescored if d.price}
    instr_prices = instruments_mod.prices()        # {} si el allowlist UCITS está vacío
    price_map.update(instr_prices)
    mcap_map = {t: (data_by_t[t].market_cap or 0.0) for t in deep}
    # score_map: profundo para finalistas, pre-score para resto (watchlist/display), ambos 2 decimales.
    score_map = {p.ticker: (deep[p.ticker].score if p.ticker in deep else round(p.score, 2))
                 for p, _d in prescored}
    target_map = {t: r.target_price for t, r in deep.items()}

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
                target_raw=target_raw.get(ticker), target_flagged=ticker in target_flagged,
                target_consensus_mean=target_consensus_mean.get(ticker),
                target_echoed_consensus=ticker in target_echoed,
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
            row.target_raw = target_raw.get(ticker)
            row.target_flagged = ticker in target_flagged
            row.target_consensus_mean = target_consensus_mean.get(ticker)
            row.target_echoed_consensus = ticker in target_echoed
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
    macro_line = macro.get("outlook", "") or construction.summary

    # Traza de auditoría del embudo (diagnóstico; nunca debe tirar el escaneo).
    try:
        scan_audit.record(db, prescored=prescored, failed=failed, finalists=finalists,
                          deep=deep, selected=selected, construction=construction,
                          pre_errors=pre_errors, deep_errors=deep_caidos, decide=decide,
                          lanes=lanes, mid_scores=mid_scores)
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
            issues.append(f"No se pudieron crear las aprobaciones de la sala real: {exc}")
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
    coste = _llm_usage(macro=macro_llm, prescore=prescore_llm, mid=mid_llm,
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
        "outlook": macro.get("outlook") or "",
        # Duración por fase, segundos (ver `timings` arriba) — clave ausente = fase no corrió.
        "timings": timings,
    }
    try:   # el informe jamás debe tirar un escaneo ya completado
        _write_scan_report(db, mode=modo, result=result, issues=issues, changes=changes)
    except Exception:
        logger.exception("No se pudo persistir el informe del escaneo.")
    try:
        # Fila HISTÓRICA (nunca se pisa): la inclinación sectorial del macro hasta ahora se
        # calculaba, movía el escaneo entero y se tiraba — aquí queda fijada para comprobar
        # después si acertó. `by_model` va dentro de `cost` (ya lo trae `_llm_usage`).
        # `finalists`/`construction`: recuperación completa del escaneo, decida o no —
        # `Proposal` solo existe cuando decide=True, así que sin esto la cartera hipotética de
        # un observatorio (y su tesis) se perdía en cuanto terminaba el proceso.
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
                "target_raw": target_raw.get(t), "target_flagged": t in target_flagged,
                "target_consensus_mean": target_consensus_mean.get(t),
                "target_echoed_consensus": t in target_echoed,
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
            cadence=cadence, decide=decide, regime=macro.get("regime") or "",
            vix=macro.get("vix"), outlook=macro.get("outlook") or "",
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
        )
        db.add(run)
        db.flush()   # necesita el id para todas las filas hermanas de abajo
        for sector in macro.get("favored_sectors") or []:
            db.add(ScanRunSector(scan_run_id=run.id, stance="favored", sector=sector))
        for sector in macro.get("avoided_sectors") or []:
            db.add(ScanRunSector(scan_run_id=run.id, stance="avoided", sector=sector))
        _guardar_cost_breakdown(db, run.id, coste)
        for fase, segundos in timings.items():
            db.add(ScanRunTiming(scan_run_id=run.id, fase=fase, segundos=segundos))
        for i, texto in enumerate(issues):
            db.add(ScanRunIssue(scan_run_id=run.id, posicion=i, texto=texto))
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
    last = db.query(Proposal).order_by(Proposal.created_at.desc()).first()
    macro_block = (last.macro_summary if last else "") or "n/d"

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
    prop = Proposal(cash_target_pct=construction.cash_pct, macro_summary=macro_block)
    db.add(prop)
    db.flush()
    _guardar_trade_items(db, ProposalItem, "proposal_id", prop.id, items)
    for o in construction.omitted:
        db.add(ProposalOmitted(proposal_id=prop.id, ticker=o.ticker, reason=o.reason))
    db.commit()
    try:
        from app import approvals as approvals_mod
        approvals_mod.create_from_items(db, items, macro_block)
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
    macro = macro_mod.get_macro_outlook(deep_llm, db)         # macro recién calculado
    macro_block = macro_mod.outlook_prompt_block(macro)

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
    macro_line = macro.get("outlook", "") or construction.summary
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
            "cost": _llm_usage(macro_profundo=deep_llm, constructor=constructor_llm)}
