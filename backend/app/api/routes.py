"""Endpoints de la API.

Dos routers: `public_router` (sin token, lecturas/teaser de la portada) y `router`
(exige `require_auth` — se engancha en main.py) para todo lo que muta estado, revela las
picks del método (tickers, tesis, scores) o expone la Sala Real/personal. Ver el reparto
exacto donde se declara cada `@router`/`@public_router`.

Cinco endpoints son de DOBLE NIVEL vía `auth_optional` (nunca dan 401: sin sesión devuelven
agregados/datos anonimizados; con sesión, el detalle completo de siempre) — así la portada
pública puede presumir de rendimiento, y contar cómo funciona el embudo, sin regalar la cartera:
- GET  /ledger               → sin sesión: agregados + `positions: []`; con sesión: completo.
- GET  /performance          → sin sesión: posiciones anonimizadas (sin ticker); con sesión: todo.
- GET  /scan/report          → sin sesión: sin `changes` ni `outlook`; con sesión: completo.
- GET  /scan/funnel          → sin sesión: solo agregados por etapa/sector; con sesión: + detalle.
- GET  /scan/outcomes        → sin sesión: agregados por grupo; con sesión: + nombres.

La regla que separa las dos caras: **cómo se comporta el sistema es público; QUÉ nombres elige,
no.** Cuántos sobreviven a cada etapa y por sector es comportamiento; un ticker con su score es
un feed de señales.

- GET  /health                (público, en main.py)
- GET  /macro                → régimen macro (barato, determinista)               [público]
- GET  /overview              → teaser de la portada (sombra completo + real solo %) [público]
- POST /ledger/allocate      → asignar/retirar fondos                             [protegido]
- POST /demo/run             → lanza el escaneo (universo entero → scores → cartera 3-5) [protegido]
- POST /admin/universe-snapshot → relanza a mano la foto del universo (si el cron falló) [protegido]
- GET  /demo/status          → estado del escaneo                                  [público]
- GET  /scan/report          → informe persistido del último escaneo (incidencias) [doble nivel]
- GET  /scan/funnel          → embudo de los últimos escaneos por etapa y sector   [doble nivel]
- GET  /scan/outcomes        → la traza LEÍDA: retorno por grupo vs SPY, score↔retorno [doble nivel]
- GET  /scan/audit/{ticker}  → historia de un ticker a través de los escaneos      [protegido]
- GET  /scan/full            → recuperación completa de un escaneo (macro, finalistas,
                               cartera formada, omitted) — decida o no                [protegido]
- GET  /scores               → leaderboard (mejores scores del último escaneo)     [protegido]
- GET  /proposal             → cartera objetivo + trades del último escaneo        [protegido]
- GET  /watchlist            → nombres vigilados                                   [protegido]
- GET  /memory/search        → buscador sobre la memoria semántica (ticker o texto) [protegido]
"""

from __future__ import annotations

import json
import re
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import execution_service, pipeline, scan_audit
from app import watchlist as watchlist_mod
from app.auth import auth_optional
from app.config import settings
from app.db import get_db
from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import Meta, Proposal, Score, Watchlist
from app.schemas import ProposalOut, ScoreOut, WatchlistOut

public_router = APIRouter()   # sin token: lecturas y teaser de la portada
router = APIRouter()          # exige require_auth (dependencies=[...] en main.py)


class AllocateIn(BaseModel):
    # allow_inf_nan=False: un "1e999" en el JSON llega como Infinity y reventaría el Decimal
    # del libro con un 500; mejor 422 aquí. Bounds holgados (±$1.000M) — negativo = retirada.
    amount: float = Field(allow_inf_nan=False, gt=-1e9, lt=1e9)
    note: str = ""
    currency: str = "USD"   # "USD" = apunte directo · "EUR" = el broker convierte primero (real)


def _money(x: Decimal) -> str:
    return str(x)


@public_router.get("/config")
def config() -> dict:
    """Parámetros de cartera para el frontend (evita hardcodear el máximo de posiciones, etc.)."""
    return {
        "max_positions": settings.max_positions,
        "min_positions": settings.min_positions,
        "max_position_pct": settings.max_position_pct,
        "dry_run": settings.dry_run,
        "limit_buffer_pct": settings.limit_buffer_pct,
        "approval_expiry_days": settings.approval_expiry_days,
    }


@public_router.get("/macro")
def macro() -> dict:
    from app.screener.macro import get_macro_regime

    return get_macro_regime()


@router.get("/fx")
def fx_eurusd() -> dict:
    """Cambio EUR→USD INDICATIVO para la frontera de aportaciones (el libro vive en USD; el FX
    real lo hace IBKR al suyo). yfinance `EURUSD=X`, cacheado 60s en tracking.live_prices."""
    from datetime import UTC, datetime

    from app import tracking

    rate = tracking.live_prices(["EURUSD=X"]).get("EURUSD=X")
    return {"pair": "EURUSD", "rate": rate,
            "asof": datetime.now(UTC).isoformat() if rate else None}


# ---- Libro de capital -------------------------------------------------------

def ledger_snapshot(db: Session) -> dict:
    """Foto COMPLETA del sleeve sombra (función interna, no es ruta): la usan los endpoints
    protegidos que necesitan el detalle siempre entero (allocate, ejecutar propuesta...)."""
    from app import tracking
    prices = tracking.live_prices([p.ticker for p in ledger.open_positions(db)])
    snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t))  # valor a precio VIVO
    return {
        "cash": _money(snap.cash),
        "positions_value": _money(snap.positions_value),
        "equity": _money(snap.equity),
        "realized_pnl": _money(snap.realized_pnl),
        "unrealized_pnl": _money(snap.unrealized_pnl),
        "positions": [
            {"ticker": p["ticker"], "quantity": _money(p["quantity"]),
             "avg_cost": _money(p["avg_cost"]), "value": _money(p["value"])}
            for p in snap.positions
        ],
    }


@public_router.get("/ledger")
def ledger_view(db: Session = Depends(get_db), authed: bool = Depends(auth_optional)) -> dict:
    """Doble nivel: los agregados (caja, equity, P&L...) se ven siempre — son cifras ficticias
    de un sleeve virtual —, pero la identidad de la cartera (qué tickers, con qué peso) es del
    método y solo se revela con sesión: sin token, `positions` va vacío."""
    out = ledger_snapshot(db)
    if not authed:
        out = {**out, "positions": []}
    return out


@router.post("/ledger/allocate")
def ledger_allocate(body: AllocateIn, db: Session = Depends(get_db)) -> dict:
    ledger.allocate(db, body.amount, body.note)
    return ledger_snapshot(db)


def _anonymize_positions(rows: list[dict]) -> list[dict]:
    """Quita la identidad de cada posición (ticker, cantidad, coste...) dejando solo el P&L
    relativo, para que el rendimiento se pueda presumir sin regalar la cartera del método."""
    return [
        {"label": f"Posición {i}", "unrealized_pnl": r["unrealized_pnl"], "unrealized_pct": r["pnl_pct"]}
        for i, r in enumerate(rows, start=1)
    ]


@public_router.get("/performance")
def performance(db: Session = Depends(get_db), authed: bool = Depends(auth_optional)) -> dict:
    """Seguimiento gratis: rentabilidad de la cartera (precio vivo) vs S&P 500 desde la entrada.
    Doble nivel: los agregados (rentabilidad, alpha...) se ven siempre; el detalle por posición
    solo con sesión — sin token llega anonimizado (sin ticker ni cantidades)."""
    from app import tracking
    perf = tracking.performance(db)
    if not authed:
        perf = {**perf, "positions": _anonymize_positions(perf["positions"])}
    return perf


@public_router.get("/history")
def history_series(
    book: str = "shadow", db: Session = Depends(get_db), authed: bool = Depends(auth_optional),
) -> dict:
    """Curva histórica (cierres diarios, índice base 100 vs S&P 500). Doble nivel: la sombra es
    pública entera (cifras de un sleeve virtual); la real sin sesión pierde el equity — quedan
    fechas y % (lo mismo que ya presume la portada), nunca importes."""
    from app import history as history_mod
    from app.models import BOOK_REAL, BOOK_SHADOW

    if book not in (BOOK_SHADOW, BOOK_REAL):
        raise HTTPException(status_code=422, detail="book debe ser 'shadow' o 'real'.")
    out = history_mod.series(db, book)
    if book == BOOK_REAL and not authed:
        out["series"] = [{k: v for k, v in p.items() if k != "equity"} for p in out["series"]]
    return out


@public_router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    """Teaser público de la portada: sombra completa (viene de /performance) + real SOLO el
    % de P&L no realizado (nunca importes, tickers ni nº de posiciones — eso es privado)."""
    from app import tracking
    from app.models import BOOK_REAL

    perf = tracking.performance(db)
    shadow = {
        "return_pct": perf["portfolio_return_pct"] if perf["positions"] else None,
        "spy_pct": perf["spy_return_pct"],
        "alpha_pct": perf["alpha_pct"],
        "since": perf["since"],
        "positions": len(perf["positions"]),
    }

    real_pct: float | None = None
    real_positions = ledger.open_positions(db, BOOK_REAL)
    if real_positions:
        prices = tracking.live_prices([p.ticker for p in real_positions])
        snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t), book=BOOK_REAL)
        cost_basis = snap.positions_value - snap.unrealized_pnl  # Decimal, cent-exacto
        if cost_basis > 0:
            real_pct = float((snap.unrealized_pnl / cost_basis * 100).quantize(Decimal("0.01")))

    return {"shadow": shadow, "real": {"unrealized_pct": real_pct}}


# ---- Escaneo ----------------------------------------------------------------

@router.post("/demo/run")
def demo_run(sample_size: int | None = None, decide: bool = True,
            force_mid_layer: bool = False) -> dict:
    # decide=False: escaneo de universo completo en producción real, con el modelo/coste
    # de verdad, que NO propone ni toca ninguna cartera — solo refresca ranking, watchlist,
    # memoria y traza. force_mid_layer=True lo hace el circuito EXACTO de un mensual (capa
    # media incluida) sin tocar el cron semanal. Es el botón "simulación" de Sala Real.
    if not settings.enable_llm or not settings.llm_api_key_present:
        raise HTTPException(503, "Configura ENABLE_LLM=true y la key del proveedor "
                                 f"({settings.llm_provider.upper()}_API_KEY).")
    started = pipeline.start(sample_size=sample_size, decide=decide,
                             force_mid_layer=force_mid_layer)
    return {"started": started, **pipeline.get_status()}


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
    entran y salen del ranking — eso es la cartera del método y solo se ve con sesión. `outlook`
    (la tesis macro del escaneo) va por el mismo lado: es texto libre del modelo y puede citar
    nombres, así que no se regala a puerta abierta aunque acabe publicado en una tarjeta.
    """
    row = db.get(Meta, "last_scan_report")
    if row is None:
        return {"report": None}
    try:
        report = json.loads(row.value)
    except ValueError:
        return {"report": None}
    if not authed:
        report = {**report, "changes": [], "outlook": None}
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
    sin fondear · descartados del profundo · SPY), los pares score↔retorno y la frontera del
    corte. Es la respuesta a "¿lo que compró lo hizo mejor que lo que descartó?".

    DOBLE NIVEL: los agregados por grupo son comportamiento → públicos. Un ticker con su
    score y su retorno es un feed de señales → los nombres (en `pairs` y en la frontera)
    solo con sesión.
    """
    from app import scan_outcomes

    scans = scan_outcomes.outcomes(db, limit=limit)
    if not authed:
        scans = [{**s,
                  "pairs": [{k: v for k, v in p.items() if k != "ticker"} for p in s["pairs"]],
                  "corte": {lado: {k: v for k, v in datos.items() if k != "nombres"}
                            for lado, datos in s["corte"].items()}}
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
        "at": row.scan_at.isoformat(), "cadence": row.cadence, "decide": row.decide,
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
    except Exception:  # noqa: BLE001 — deps opcionales (fastembed/sqlite-vec) pueden faltar
        store = None
    if store is None:
        return {"mode": "vacio", "items": [], "error": "memoria vectorial no disponible"}

    q = q.strip()
    if _TICKER_LIKE.match(q):
        try:
            hist = store.history_for(q.upper(), limit=limit)
        except Exception as exc:  # noqa: BLE001 — fichero ausente/corrupto: se avisa, no se
            # disfraza de búsqueda semántica. Bug real reproducido en producción: `history_for`
            # reventaba por hilos (ver store._connect) y este `except` lo tragaba en silencio,
            # cayendo al modo semántico sin avisar — parecía que la memoria "olvidaba" nombres.
            return {"mode": "vacio", "items": [], "error": str(exc)}
        if hist:
            return {"mode": "ticker", "items": [_memory_out(m) for m in hist]}

    try:
        results = store.search(q, k=limit)
    except Exception as exc:  # noqa: BLE001 — típicamente fastembed/sqlite-vec no instalados
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


# ---- Mantenimiento: volcado de base de datos (local → nube) -----------------

class SeedIn(BaseModel):
    version: int | None = None
    tables: dict[str, list[dict]]


@router.post("/admin/seed")
def admin_seed(body: SeedIn, db: Session = Depends(get_db)) -> dict:
    """DESTRUCTIVO: reemplaza TODA la base de datos por el snapshot subido (mismo esquema).

    Protegido por token (require_auth) y transaccional sobre la conexión de la sesión: si algo
    falla, rollback y la DB queda intacta. Migra de un tirón la imagen local a la nube.
    """
    from app import dbdump
    try:
        out = dbdump.import_all(db.connection(), body.model_dump())
        db.commit()
        return out
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        db.rollback()
        raise


_SEED_MEMORY_MAX_BYTES = 100 * 1024 * 1024   # el fichero real ronda pocos MB; esto es anti-DoS


@router.post("/admin/seed-memory")
def admin_seed_memory(body: bytes = Body(...)) -> dict:
    """Sube el fichero de memoria vectorial (agent_memory.db) TAL CUAL y lo escribe en la ruta
    configurada (en Railway, el volumen). Copia literal del SQLite con sus vectores — NO re-embebe.
    """
    import pathlib

    from app import memory
    if not body:
        raise HTTPException(422, "Fichero de memoria vacío.")
    if len(body) > _SEED_MEMORY_MAX_BYTES:
        raise HTTPException(413, "Fichero de memoria demasiado grande (tope 100 MB).")
    memory.reset_store()                        # cierra la conexión si estaba abierta (evita lock)
    path = pathlib.Path(settings.memory_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return {"ok": True, "bytes": len(body), "path": str(path)}


@router.post("/admin/reset-shadow")
def admin_reset_shadow(db: Session = Depends(get_db)) -> dict:
    """DESTRUCTIVO — SOLO libro SOMBRA (escaparate). Vacía holdings/operaciones/curva del sombra
    conservando el capital (queda en caja); NO toca el libro real ni la cartera personal. Para
    descartar la salida de un escaneo defectuoso. Protegido por token."""
    return ledger.reset_shadow_book(db)


@router.post("/admin/universe-snapshot")
def admin_universe_snapshot(db: Session = Depends(get_db)) -> dict:
    """Relanza a mano la foto del universo (la misma toma de datos que corre el job de las
    16:30 ET): si una noche NASDAQ no respondió y el cron se quedó sin foto, el dueño la repite
    desde la web antes del escaneo del martes, sin esperar a los reintentos automáticos.

    La fuente externa (NASDAQ) falla de mil maneras (timeouts, 200 con cuerpo vacío...) y eso
    NO es un error del backend: se atrapa aquí y viaja como `{"ok": false, "error": ...}` con
    200, no como un 500.
    """
    from app.screener import universe as universe_mod

    try:
        info = universe_mod.refresh_snapshot_and_report(db)
        return {"ok": True, **info}
    except Exception as exc:  # noqa: BLE001 — el motivo legible es lo que necesita el panel
        return {"ok": False, "error": str(exc)}


@router.get("/admin/memory-status")
def admin_memory_status() -> dict:
    """Diagnóstico read-only de la memoria vectorial: ruta, nº de recuerdos y si las deps están
    instaladas. NO carga el modelo de embeddings — solo abre el fichero y cuenta. Confirma que el
    volcado llegó al volumen sin esperar a ver un `recall` en los logs del próximo escaneo."""
    from app import memory

    return memory.status()


# ---- Lecturas ---------------------------------------------------------------

@router.get("/scores", response_model=list[ScoreOut])
def scores(limit: int = Query(60, ge=1, le=200), db: Session = Depends(get_db)) -> list[Score]:
    # Solo los ANALIZADOS A FONDO (tienen informe). Los pre-cribados de Flash son triaje interno.
    stmt = (select(Score).where(Score.report != "")
            .order_by(Score.score.desc()).limit(limit))
    return list(db.scalars(stmt).all())


@router.get("/proposal", response_model=ProposalOut | None)
def proposal(db: Session = Depends(get_db)) -> Proposal | None:
    stmt = select(Proposal).order_by(Proposal.created_at.desc()).limit(1)
    return db.scalars(stmt).first()


@router.post("/proposal/execute/{ticker}")
def proposal_execute_item(ticker: str, db: Session = Depends(get_db)) -> dict:
    """Ejecuta el item de la propuesta actual (botón Comprar/Vender de la Sala Sombra)."""
    try:
        res = execution_service.execute_proposal_item(db, ticker.upper())
    except (LookupError, ValueError, ledger.InsufficientFunds, ledger.InsufficientShares) as e:
        raise HTTPException(400, str(e))
    return {**res, "ledger": ledger_snapshot(db)}


@router.post("/proposal/execute")
def proposal_execute_all(db: Session = Depends(get_db)) -> dict:
    """Ejecuta de golpe todos los items accionables de la propuesta en el libro sombra."""
    try:
        res = execution_service.execute_proposal_all(db)
    except LookupError as e:
        raise HTTPException(400, str(e))
    return {**res, "ledger": ledger_snapshot(db)}


@router.get("/watchlist", response_model=list[WatchlistOut])
def watchlist(db: Session = Depends(get_db)) -> list[Watchlist]:
    stmt = select(Watchlist).order_by(Watchlist.score.desc())
    return list(db.scalars(stmt).all())


# ---- Sala Real (cuenta IBKR · el agente propone, el usuario decide) ---------

def _approval_out(a) -> dict:  # noqa: ANN001
    return {
        "id": a.id,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
        "status": a.status,
        "ticker": a.ticker, "sector": a.sector, "action": a.action,
        "target_weight_pct": a.target_weight_pct, "score": a.score,
        "est_price": str(a.est_price) if a.est_price is not None else None,
        "target_price": a.target_price, "upside_pct": a.upside_pct,
        "thesis": a.thesis, "edge": a.edge, "risk": a.risk,
        "macro_summary": a.macro_summary,
        "requested_quantity": str(a.requested_quantity) if a.requested_quantity is not None else None,
        "quantity": str(a.quantity) if a.quantity is not None else None,
        "fill_price": str(a.fill_price) if a.fill_price is not None else None,
        "result_msg": a.result_msg, "order_ref": a.order_ref,
        "broker_order_id": a.broker_order_id,
    }


@router.get("/real")
def real_summary(db: Session = Depends(get_db)) -> dict:
    """Foto completa de la Sala Real: libro real vivo, rendimiento vs S&P, broker, pendientes."""
    from app import approvals as approvals_mod
    from app import tracking
    from app.brokers import get_broker
    from app.models import BOOK_REAL

    # Reconcilia órdenes límite 'working' (fills que hayan entrado en IBKR). Best-effort.
    try:
        approvals_mod.reconcile_working(db)
    except Exception:  # noqa: BLE001
        pass
    prices = tracking.live_prices([p.ticker for p in ledger.open_positions(db, BOOK_REAL)])
    snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t), book=BOOK_REAL)
    return {
        "cash": _money(snap.cash),
        "positions_value": _money(snap.positions_value),
        "equity": _money(snap.equity),
        "realized_pnl": _money(snap.realized_pnl),
        "unrealized_pnl": _money(snap.unrealized_pnl),
        "positions": [
            {"ticker": p["ticker"], "quantity": _money(p["quantity"]),
             "avg_cost": _money(p["avg_cost"]), "price": _money(p["price"]),
             "value": _money(p["value"])}
            for p in snap.positions
        ],
        "performance": tracking.performance(db, book=BOOK_REAL),
        "broker": get_broker().status(),
        "pending_count": len(approvals_mod.pending(db)),
    }


@router.post("/real/allocate")
def real_allocate(body: AllocateIn, db: Session = Depends(get_db)) -> dict:
    """Aportar/retirar capital del agente. En $, apunte directo (dólares que ya existen).
    En €, el broker CONVIERTE primero (límite ±buffer; simulado en dry-run) y se apunta la
    imagen final que devuelva — jamás una estimación, jamás nada si la conversión no ejecutó."""
    from app.models import BOOK_REAL

    if body.currency.upper() == "EUR":
        from app.brokers import get_broker

        if body.amount <= 0:
            raise HTTPException(422, "Las retiradas se hacen en $ — el libro vive en dólares.")
        res = get_broker().convert_currency(D(str(body.amount)))
        if (not res.ok or res.status != "filled"
                or res.fill_price is None or res.filled_quantity is None):
            raise HTTPException(409, f"No se apunta nada. {res.message}")
        usd = to_cents(res.filled_quantity * res.fill_price)
        note = (f"aportación {body.amount} EUR → ${usd} @ {res.fill_price}"
                + (" (sim)" if res.simulated else "")
                + (f" · {body.note}" if body.note else ""))
        ledger.allocate(db, float(usd), note, book=BOOK_REAL)
        out = real_summary(db)
        out["allocated"] = {"currency": "EUR", "eur": body.amount, "usd": str(usd),
                            "rate": str(res.fill_price), "simulated": res.simulated}
        return out

    ledger.allocate(db, body.amount, body.note, book=BOOK_REAL)
    return real_summary(db)


@router.get("/approvals")
def approvals_list(db: Session = Depends(get_db)) -> dict:
    from app import approvals as approvals_mod

    return {
        "pending": [_approval_out(a) for a in approvals_mod.pending(db)],
        "history": [_approval_out(a) for a in approvals_mod.history(db)],
    }


@router.post("/approvals/{approval_id}/approve")
def approval_approve(approval_id: int, db: Session = Depends(get_db)) -> dict:
    """SÍ → ejecuta en la cuenta real (o simula en dry-run) y registra en el libro real."""
    from app import approvals as approvals_mod

    try:
        return _approval_out(approvals_mod.approve(db, approval_id))
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/approvals/reconcile")
def approvals_reconcile(db: Session = Depends(get_db)) -> dict:
    """Sondea IBKR y registra los fills de las órdenes límite que estaban 'working'."""
    from app import approvals as approvals_mod

    changed = approvals_mod.reconcile_working(db)
    return {"reconciled": changed}


@router.post("/approvals/{approval_id}/reject")
def approval_reject(approval_id: int, db: Session = Depends(get_db)) -> dict:
    """NO → descarta la propuesta sin efecto alguno."""
    from app import approvals as approvals_mod

    try:
        return _approval_out(approvals_mod.reject(db, approval_id))
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


# ---- Cartera personal (IBKR, intocable para el agente) -----------------------

@router.get("/personal")
def personal_summary(db: Session = Depends(get_db)) -> dict:
    """Mini-tracker de la cartera personal del usuario (snapshot + precios vivos)."""
    from app import personal

    return personal.summary(db)


@router.post("/personal/sync")
def personal_sync(db: Session = Depends(get_db)) -> dict:
    """Refresca el snapshot desde IBKR (READ-ONLY: jamás envía órdenes)."""
    from app import personal

    try:
        n = personal.sync_from_ibkr(db)
    except Exception as exc:  # noqa: BLE001 — motivo legible en el panel
        raise HTTPException(502, f"No se pudo sincronizar con IBKR: {exc}")
    return {"synced": n, **personal.summary(db)}


# ---- Web Push ----------------------------------------------------------------

class PushSubscribeIn(BaseModel):
    endpoint: str
    keys: dict


@router.get("/push/key")
def push_key() -> dict:
    from app import push

    return {"key": push.vapid_public_key()}


@router.post("/push/subscribe")
def push_subscribe(body: PushSubscribeIn, db: Session = Depends(get_db)) -> dict:
    from app import push

    try:
        push.subscribe(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@router.post("/push/unsubscribe")
def push_unsubscribe(body: PushSubscribeIn, db: Session = Depends(get_db)) -> dict:
    from app import push

    push.unsubscribe(db, body.endpoint)
    return {"ok": True}


@router.post("/push/test")
def push_test(db: Session = Depends(get_db)) -> dict:
    """Notificación de prueba para verificar el canal de alertas end-to-end."""
    from app import push

    sent = push.send_to_all(db, "Agentic Trader — Sala Real",
                            "Canal de alertas operativo. Así llegarán las propuestas.", "/real")
    return {"sent": sent}
