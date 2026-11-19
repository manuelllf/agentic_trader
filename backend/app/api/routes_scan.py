"""Escaneo: lanzar/cancelar, progreso en vivo, informe persistido, embudo, outcomes, y las
dos re-pasadas baratas (recheck/redeep) que no vuelven a escanear el universo."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import pipeline, scan_config, scan_state
from app.auth import auth_optional
from app.config import settings
from app.db import get_db
from app.models import utc_iso
from app.i18n import translate

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
            solo_jev: bool = True,
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
        raise HTTPException(503, translate('api_provider_not_configured', provider=settings.llm_provider.upper()))
    if not solo_jev:
        # El único escaneo que queda es el de las notas de Jev: el de decisión se retiró.
        raise HTTPException(400, "Solo existe el escaneo de las notas de Jev.")
    if decide and modo_universo != "nasdaq":
        # La foto que la liga designa sale siempre de NASDAQ: el universo global es para pruebas.
        raise HTTPException(400, "El universo global solo vale para escaneos de prueba.")
    llm_overrides = (overrides.model_dump(exclude_none=True) if overrides else None) or None
    if decide and llm_overrides is None:
        llm_overrides = scan_config.get_decide_overrides(db)
    # `solo_jev`: el escaneo de las notas de Jev (el de cada mes, lanzado a mano o de prueba).
    started = pipeline.start(sample_size=sample_size, decide=decide,
                             llm_overrides=llm_overrides,
                             reutilizar_ultima_foto=reutilizar_ultima_foto,
                             modo_universo=modo_universo, solo_jev=solo_jev)
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


@router.get("/scan/jev-macro")
def get_scan_jev_macro(db: Session = Depends(get_db)) -> dict:
    """Interruptor "Macro en Jev": el prescore ve datos + eventos + titulares o solo datos."""
    return {"enabled": scan_config.jev_macro_activa(db)}


@router.put("/scan/jev-macro")
def put_scan_jev_macro(body: InterruptorIn, db: Session = Depends(get_db)) -> dict:
    """Persistido hasta que se vuelva a cambiar; solo afecta a escaneos FUTUROS."""
    return {"enabled": scan_config.set_jev_macro(db, body.enabled)}


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
    """Informe del ÚLTIMO escaneo (cron o manual), leído de `scan_runs`: modo, universo,
    contadores, coste e incidencias — o el error si reventó entero. A diferencia de
    /demo/status (estado en memoria del runner manual), esto sobrevive a reinicios y también
    lo escribe el cron.

    DOBLE NIVEL: cómo se comportó el sistema es público, pero `changes` nombra los tickers que
    entran y salen del ranking — eso es la cartera del método y solo se ve con sesión. Igual
    `jev_cartera` (nombres de la cartera de Jev) y `outlook`, que en escaneos viejos es texto
    libre del modelo y puede citar nombres.
    """
    report = scan_state.informe(db)
    if report is None:
        return {"report": None}
    if not authed:
        report = {**report, "changes": [], "outlook": None, "jev_cartera": []}
    return {"report": report}




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
    """Detalle completo del escaneo de Jev: el bloque macro que vio la nota (calendario, eventos y
    titulares) además del resumen. `at` = `scan_at` ISO de un escaneo concreto; sin él, el último.
    Protegido: el titular de cada fuente va con el escaneo, igual que el resto del informe."""
    from datetime import datetime

    from app.models import ScanRun, ScanRunMacroHeadline

    q = db.query(ScanRun).filter(ScanRun.error.is_(None))   # uno reventado no tiene qué mostrar
    row = (q.filter(ScanRun.scan_at == datetime.fromisoformat(at)).first() if at
           else q.order_by(ScanRun.scan_at.desc()).first())
    if row is None:
        return {"scan": None}
    titulares = (db.query(ScanRunMacroHeadline).filter_by(scan_run_id=row.id)
                 .order_by(ScanRunMacroHeadline.fuente, ScanRunMacroHeadline.posicion).all())
    return {"scan": {
        "at": utc_iso(row.scan_at), "cadence": row.cadence, "decide": row.decide,
        "regime": row.regime, "vix": row.vix, "outlook": row.outlook,
        "macro_calendario": row.macro_wiki_scheduled, "macro_eventos": row.macro_wiki_events,
        "macro_titulares": [{"fuente": t.fuente, "texto": t.texto} for t in titulares],
    }}


@router.get("/scan/audit/{ticker}")
def scan_ticker_history(ticker: str, db: Session = Depends(get_db)) -> dict:
    """Historia de UN ticker a través de los escaneos (¿es estable el criterio?). Nombre con
    sus scores → protegido entero, sin cara pública."""
    from app import scan_outcomes

    return {"ticker": ticker.upper(), "scans": scan_outcomes.ticker_history(db, ticker)}


