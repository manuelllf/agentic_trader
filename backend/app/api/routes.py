"""Endpoints de la API.

Dos routers: `public_router` (sin token, lecturas/teaser de la portada) y `router`
(exige `require_auth` — se engancha en main.py) para todo lo que muta estado, revela las
picks del método (tickers, tesis, scores) o expone la Sala Real/personal. Ver el reparto
exacto donde se declara cada `@router`/`@public_router`.

Dos endpoints son de DOBLE NIVEL vía `auth_optional` (nunca dan 401: sin sesión devuelven
agregados/datos anonimizados; con sesión, el detalle completo de siempre) — así la portada
pública puede presumir de rendimiento sin regalar la cartera:
- GET  /ledger               → sin sesión: agregados + `positions: []`; con sesión: completo.
- GET  /performance          → sin sesión: posiciones anonimizadas (sin ticker); con sesión: completo.

- GET  /health                (público, en main.py)
- GET  /macro                → régimen macro (barato, determinista)               [público]
- GET  /overview              → teaser de la portada (sombra completo + real solo %) [público]
- POST /ledger/allocate      → asignar/retirar fondos                             [protegido]
- POST /demo/run             → lanza el escaneo (universo entero → scores → cartera 3-5) [protegido]
- GET  /demo/status          → estado del escaneo                                  [público]
- GET  /scores               → leaderboard (mejores scores del último escaneo)     [protegido]
- GET  /proposal             → cartera objetivo + trades del último escaneo        [protegido]
- GET  /watchlist            → nombres vigilados                                   [protegido]
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import execution_service
from app import pipeline
from app import watchlist as watchlist_mod
from app.auth import auth_optional
from app.config import settings
from app.db import get_db
from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import Proposal, Score, Watchlist
from app.schemas import ProposalOut, ScoreOut, WatchlistOut

public_router = APIRouter()   # sin token: lecturas y teaser de la portada
router = APIRouter()          # exige require_auth (dependencies=[...] en main.py)


class AllocateIn(BaseModel):
    amount: float
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
def demo_run(sample_size: int | None = None) -> dict:
    if not settings.enable_llm or not settings.openrouter_api_key:
        raise HTTPException(503, "Configura ENABLE_LLM=true y OPENROUTER_API_KEY.")
    started = pipeline.start(sample_size=sample_size)
    return {"started": started, **pipeline.get_status()}


@public_router.get("/demo/status")
def demo_status() -> dict:
    return pipeline.get_status()


@router.post("/recheck")
def recheck(db: Session = Depends(get_db)) -> dict:
    """Re-comprobación del top: re-construye la cartera sobre los ya analizados a fondo,
    con el suelo actual, SIN re-escanear el universo (instantáneo)."""
    if not settings.enable_llm or not settings.openrouter_api_key:
        raise HTTPException(503, "Configura ENABLE_LLM=true y OPENROUTER_API_KEY.")
    from app.scan_service import recheck as _recheck
    try:
        return _recheck(db)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/redeep")
def redeep(db: Session = Depends(get_db)) -> dict:
    """Re-analiza a fondo (V4-Pro) los nombres ya profundizados con el macro ACTUAL, sin
    re-escanear el universo. Para refrescar tras corregir un dato macro. Barato (~$0.03-0.05)."""
    if not settings.enable_llm or not settings.openrouter_api_key:
        raise HTTPException(503, "Configura ENABLE_LLM=true y OPENROUTER_API_KEY.")
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


@router.post("/admin/seed-memory")
def admin_seed_memory(body: bytes = Body(...)) -> dict:
    """Sube el fichero de memoria vectorial (agent_memory.db) TAL CUAL y lo escribe en la ruta
    configurada (en Railway, el volumen). Copia literal del SQLite con sus vectores — NO re-embebe.
    """
    import pathlib

    from app import memory
    if not body:
        raise HTTPException(422, "Fichero de memoria vacío.")
    memory.reset_store()                        # cierra la conexión si estaba abierta (evita lock)
    path = pathlib.Path(settings.memory_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return {"ok": True, "bytes": len(body), "path": str(path)}


@router.get("/admin/memory-status")
def admin_memory_status() -> dict:
    """Diagnóstico read-only de la memoria vectorial: ruta, nº de recuerdos y si las deps están
    instaladas. NO carga el modelo de embeddings — solo abre el fichero y cuenta. Confirma que el
    volcado llegó al volumen sin esperar a ver un `recall` en los logs del próximo escaneo."""
    from app import memory

    return memory.status()


# ---- Lecturas ---------------------------------------------------------------

@router.get("/scores", response_model=list[ScoreOut])
def scores(limit: int = 30, db: Session = Depends(get_db)) -> list[Score]:
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
