"""Escaneo: lanzar/cancelar, progreso en vivo, informe persistido, embudo, outcomes, y las
dos re-pasadas baratas (recheck/redeep) que no vuelven a escanear el universo."""
from __future__ import annotations

import json
import re
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import pipeline, scan_audit, scan_config
from app.auth import auth_optional
from app.config import settings
from app.db import get_db
from app.models import Meta, utc_iso

public_router = APIRouter()   # sin token: lecturas y teaser de la portada
router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


class StageLLMOverride(BaseModel):
    """Config de una etapa para el modal de la simulación. Todo opcional: lo que no venga usa
    el default de `settings` (ver `scan_service._stage_cfg`)."""
    model: str | None = None
    reasoning_effort: Literal["none", "low", "high", "max"] | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)


class DemoRunOverrides(BaseModel):
    prescore: StageLLMOverride | None = None
    mid: StageLLMOverride | None = None
    deep: StageLLMOverride | None = None
    constructor: StageLLMOverride | None = None


@router.post("/demo/run")
def demo_run(sample_size: int | None = None, decide: bool = True,
            reutilizar_ultima_foto: bool = False,
            modo_universo: Literal["nasdaq", "global_topcap"] = "nasdaq",
            overrides: DemoRunOverrides | None = Body(None, embed=True),
            db: Session = Depends(get_db)) -> dict:
    # decide=False: escaneo de universo completo en producción real, con el modelo/coste
    # de verdad, que NO propone ni toca ninguna cartera — solo refresca ranking, watchlist,
    # memoria y traza. Es el botón "simulación" de Alpha. Los interruptores (capa media, macro
    # en Jev) valen igual aquí que en el mensual.
    # `overrides`: config por etapa del modal — cuerpo JSON opcional. Con `decide=True` y SIN
    # `overrides` en el cuerpo (el botón "Analizar y decidir"), se lee la config PERSISTIDA del
    # escaneo con decisión (`scan_config`), la misma que usa el cron mensual — así los dos
    # deciden con el mismo circuito. "Analizar mercado" (decide=False sin cuerpo) sigue con los
    # defaults de `settings`.
    # `embed=True`: el frontend manda `{"overrides": {...}}`. Sin esto se parseaba como un
    # DemoRunOverrides vacío sin dar error (todos sus campos son opcionales) — bug ya arreglado.
    # `reutilizar_ultima_foto`: checkbox de los dos modales — ver `scan_service.run_scan_and_store`.
    # `modo_universo`: NASDAQ de siempre o top market cap USD del universo global (ver
    # `scan_service.run_scan_and_store`) — elección nueva del modal, solo aquí (nunca el cron).
    if not settings.enable_llm or not settings.llm_api_key_present:
        raise HTTPException(503, "Configura ENABLE_LLM=true y la key del proveedor "
                                 f"({settings.llm_provider.upper()}_API_KEY).")
    llm_overrides = (overrides.model_dump(exclude_none=True) if overrides else None) or None
    if decide and llm_overrides is None:
        llm_overrides = scan_config.get_decide_overrides(db)
    started = pipeline.start(sample_size=sample_size, decide=decide,
                             llm_overrides=llm_overrides,
                             reutilizar_ultima_foto=reutilizar_ultima_foto,
                             modo_universo=modo_universo)
    return {"started": started, **pipeline.get_status()}


@router.get("/scan/decide-config")
def get_scan_decide_config(db: Session = Depends(get_db)) -> dict:
    """Override de LLM por etapa GUARDADO para el escaneo con decisión (cron mensual + botón
    "Analizar y decidir"). `overrides` vacío = ese escaneo usa los defaults de producción
    (`llm_defaults` de /config). El observatorio NO se toca aquí: su config viaja por el
    cuerpo de /demo/run."""
    return {"overrides": scan_config.get_decide_overrides(db) or {}}


@router.put("/scan/decide-config")
def put_scan_decide_config(overrides: DemoRunOverrides = Body(..., embed=True),
                           db: Session = Depends(get_db)) -> dict:
    """Fija la config por etapa del escaneo con decisión. Un cuerpo `{"overrides": {}}` (o con
    todas las etapas vacías) borra la clave y vuelve a los defaults de `settings`. Solo afecta
    a escaneos FUTUROS; no relanza nada."""
    guardado = scan_config.set_decide_overrides(db, overrides.model_dump(exclude_none=True))
    return {"overrides": guardado}


class InterruptorIn(BaseModel):
    enabled: bool


@router.get("/scan/mid-layer")
def get_scan_mid_layer(db: Session = Depends(get_db)) -> dict:
    """Interruptor de la capa media: vale para cron, "Analizar y decidir" y observatorio."""
    return {"enabled": scan_config.mid_layer_activa(db)}


@router.put("/scan/mid-layer")
def put_scan_mid_layer(body: InterruptorIn, db: Session = Depends(get_db)) -> dict:
    """Persistido hasta que se vuelva a cambiar; solo afecta a escaneos FUTUROS."""
    return {"enabled": scan_config.set_mid_layer(db, body.enabled)}


@router.get("/scan/jev-macro")
def get_scan_jev_macro(db: Session = Depends(get_db)) -> dict:
    """Interruptor "Macro en Jev": el prescore ve datos + eventos + titulares o solo datos."""
    return {"enabled": scan_config.jev_macro_activa(db)}


@router.put("/scan/jev-macro")
def put_scan_jev_macro(body: InterruptorIn, db: Session = Depends(get_db)) -> dict:
    """Persistido hasta que se vuelva a cambiar; solo afecta a escaneos FUTUROS."""
    return {"enabled": scan_config.set_jev_macro(db, body.enabled)}


@router.post("/demo/cancel-observatorio")
def demo_cancel_observatorio() -> dict:
    """Cancela SOLO si lo que corre ahora mismo es un observatorio, nunca uno con decisión.
    Best-effort: para en el próximo punto de control; lo ya en vuelo termina solo."""
    return {"cancelled": pipeline.cancel(decide=False), **pipeline.get_status()}


@router.post("/demo/cancel-decision")
def demo_cancel_decision() -> dict:
    """Igual que `demo_cancel_observatorio` pero al revés: solo cancela uno con decisión."""
    return {"cancelled": pipeline.cancel(decide=True), **pipeline.get_status()}


@public_router.get("/demo/status")
def demo_status() -> dict:
    return pipeline.get_status()


@public_router.get("/scan/progress")
def scan_progress_status(authed: bool = Depends(auth_optional)) -> dict:
    """Progreso EN VIVO del escaneo que esté corriendo ahora mismo (manual o del cron) —
    en memoria, no persiste. DOBLE NIVEL: los contadores son agregados y salen siempre, pero
    `last_fail` puede llevar un ticker (ej. "ATKR: 401 Invalid Crumb") — se oculta sin sesión,
    mismo criterio que `changes`/`outlook` en /scan/report."""
    from app import scan_progress

    snap = scan_progress.snapshot()
    if not authed:
        snap["last_fail"] = None
    return snap


@public_router.get("/scan/report")
def scan_report(db: Session = Depends(get_db), authed: bool = Depends(auth_optional)) -> dict:
    """Informe del ÚLTIMO escaneo (cron o manual), persistido en la BD: modo, universo,
    contadores, coste e incidencias — o el error si reventó entero. A diferencia de
    /demo/status (estado en memoria del runner manual), esto sobrevive a reinicios y también
    lo escribe el cron.

    DOBLE NIVEL: cómo se comportó el sistema es público, pero `changes` nombra los tickers que
    entran y salen del ranking — eso es la cartera del método y solo se ve con sesión. Igual
    `jev_cartera` (nombres de la cartera de Jev) y `outlook`, que en escaneos viejos es texto
    libre del modelo y puede citar nombres.
    """
    row = db.get(Meta, "last_scan_report")
    if row is None:
        return {"report": None}
    try:
        report = json.loads(row.value)
    except ValueError:
        return {"report": None}
    if not authed:
        report = {**report, "changes": [], "outlook": None, "jev_cartera": []}
    return {"report": report}


@public_router.get("/scan/funnel")
def scan_funnel(limit: int = Query(8, ge=1, le=30), db: Session = Depends(get_db),
                authed: bool = Depends(auth_optional)) -> dict:
    """Embudo de los últimos escaneos desde la traza de auditoría: cuántos nombres sobreviven a
    cada etapa (pre-score → profundo → seleccionado → en cartera) y su reparto por sector.

    DOBLE NIVEL: los agregados describen el COMPORTAMIENTO del sistema y no identifican a nadie
    → públicos. El detalle nombre a nombre es el ranking con sus scores → solo con sesión, y
    solo del escaneo más reciente (ver `scan_audit.funnel`).
    """
    return {"scans": scan_audit.funnel(db, limit=limit, detail=authed)}


@public_router.get("/scan/outcomes")
def scan_outcomes_view(limit: int = Query(8, ge=1, le=30), db: Session = Depends(get_db),
                       authed: bool = Depends(auth_optional)) -> dict:
    """La traza LEÍDA: retorno a hoy de cada grupo de cada cohorte (cartera · seleccionados
    sin fondear · descartados del profundo · cartera de Jev · SPY), los pares score↔retorno y
    la frontera del corte. Es la respuesta a "¿lo que compró lo hizo mejor que lo que descartó?".

    DOBLE NIVEL: los agregados por grupo son comportamiento → públicos. Un ticker con su
    score y su retorno es un feed de señales → los nombres (en `pairs`, en la frontera y en la
    cartera de Jev) solo con sesión.
    """
    from app import scan_outcomes

    scans = scan_outcomes.outcomes(db, limit=limit)
    if not authed:
        scans = [{**s,
                  "pairs": [{k: v for k, v in p.items() if k != "ticker"} for p in s["pairs"]],
                  "corte": {lado: {k: v for k, v in datos.items() if k != "nombres"}
                            for lado, datos in s["corte"].items()},
                  "jev": []}
                 for s in scans]
    # La fila del libro real es agregado puro (retorno, S&P, nº posiciones): pública entera,
    # igual que /performance sin sesión.
    return {"scans": scans, "book": scan_outcomes.book_row(db)}


@router.get("/scan/full")
def scan_full(at: str | None = None, db: Session = Depends(get_db)) -> dict:
    """Recuperación completa de UN escaneo (mensual decidido o semanal observatorio): tesis
    macro, finalistas con su score/target, cartera formada con pesos y omitted. Vive entero en
    `ScanRun` (una fila por escaneo, nunca se pisa) — protegido entero: revela tickers y tesis,
    igual que `/scores` o `/proposal`.

    `at` = `scan_at` ISO de un escaneo concreto (ver `/scan/funnel` para las fechas); sin él,
    el más reciente.
    """
    from datetime import datetime

    from app.models import ScanRun

    q = db.query(ScanRun)
    row = (q.filter(ScanRun.scan_at == datetime.fromisoformat(at)).first() if at
           else q.order_by(ScanRun.scan_at.desc()).first())
    if row is None:
        return {"scan": None}
    return {"scan": {
        "at": utc_iso(row.scan_at), "cadence": row.cadence, "decide": row.decide,
        "regime": row.regime, "vix": row.vix, "outlook": row.outlook,
        "universe": row.universe, "counters": row.counters, "cost": row.cost,
        "issues": row.issues, "finalists": row.finalists, "construction": row.construction,
    }}


@router.get("/scan/audit/{ticker}")
def scan_ticker_history(ticker: str, db: Session = Depends(get_db)) -> dict:
    """Historia de UN ticker a través de los escaneos (¿es estable el criterio?). Nombre con
    sus scores → protegido entero, sin cara pública."""
    from app import scan_outcomes

    return {"ticker": ticker.upper(), "scans": scan_outcomes.ticker_history(db, ticker)}


_TICKER_LIKE = re.compile(r"^[A-Za-z0-9]{1,6}$")


def _memory_out(m) -> dict:  # noqa: ANN001 — `Memory` es un dataclass de app.memory.store
    out = {"ticker": m.ticker, "kind": m.kind, "text": m.text, "created_at": m.created_at}
    if m.distance is not None:
        out["distance"] = m.distance
    if m.n_tesis is not None:
        out["n_tesis"] = m.n_tesis
    return out


@router.get("/memory/search")
def memory_search(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=100)) -> dict:
    """Buscador sobre la memoria semántica: ticker exacto (historia cronológica) o texto libre
    (parecido semántico). Protegido entero, igual que `/scan/audit/{ticker}`: devuelve nombres
    con su tesis, y la regla de esta API es que el COMPORTAMIENTO es público pero QUÉ nombres
    elige el método no lo es. La memoria es telemetría que se lee — nunca vuelve a un prompt.
    """
    from app import memory

    try:
        store = memory.get_store()
    except Exception:  # noqa: BLE001 — fastembed puede faltar, o DATABASE_URL no ser Postgres
        store = None
    if store is None:
        return {"mode": "vacio", "items": [], "error": "memoria vectorial no disponible"}

    q = q.strip()
    if _TICKER_LIKE.match(q):
        try:
            hist = store.history_for(q.upper(), limit=limit)
        except Exception as exc:  # noqa: BLE001 — BD caída/inalcanzable: se avisa, no se disfraza
            # de búsqueda semántica. Bug real reproducido en producción con el store antiguo
            # (SQLite): un fallo aquí se tragaba en silencio y caía al modo semántico sin avisar
            # — parecía que la memoria "olvidaba" nombres.
            return {"mode": "vacio", "items": [], "error": str(exc)}
        if hist:
            return {"mode": "ticker", "items": [_memory_out(m) for m in hist]}

    try:
        results = store.search(q, k=limit)
    except Exception as exc:  # noqa: BLE001 — típicamente fastembed no instalado o BD inalcanzable
        return {"mode": "vacio", "items": [], "error": str(exc)}
    return {"mode": "semantic", "items": [_memory_out(m) for m in results]}


@router.post("/recheck")
def recheck(db: Session = Depends(get_db)) -> dict:
    """Re-comprobación del top: re-construye la cartera sobre los ya analizados a fondo,
    con el suelo actual, SIN re-escanear el universo (instantáneo)."""
    if not settings.enable_llm or not settings.llm_api_key_present:
        raise HTTPException(503, "Configura ENABLE_LLM=true y la key del proveedor "
                                 f"({settings.llm_provider.upper()}_API_KEY).")
    from app.scan_service import recheck as _recheck
    try:
        return _recheck(db)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/redeep")
def redeep(db: Session = Depends(get_db)) -> dict:
    """Re-analiza a fondo (V4-Pro) los nombres ya profundizados con el macro ACTUAL, sin
    re-escanear el universo. Para refrescar tras corregir un dato macro. Barato (~$0.03-0.05)."""
    if not settings.enable_llm or not settings.llm_api_key_present:
        raise HTTPException(503, "Configura ENABLE_LLM=true y la key del proveedor "
                                 f"({settings.llm_provider.upper()}_API_KEY).")
    from app.scan_service import redeep as _redeep
    try:
        return _redeep(db)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
