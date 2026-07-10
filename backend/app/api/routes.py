"""Endpoints de la API.

- GET  /health
- GET  /macro                → régimen macro (barato, determinista)
- GET  /ledger               → foto del sleeve (caja, posiciones, equity)
- POST /ledger/allocate      → asignar/retirar fondos
- POST /demo/run             → lanza el escaneo (muestra 250 → scores → cartera ≤4)
- GET  /demo/status          → estado del escaneo
- GET  /scores               → leaderboard (mejores scores del último escaneo)
- GET  /proposal             → cartera objetivo + trades del último escaneo
- GET  /watchlist            → nombres vigilados
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import pipeline
from app import service as scan_service
from app import watchlist as watchlist_mod
from app.config import settings
from app.db import get_db
from app.ledger import service as ledger
from app.models import Proposal, Score, Watchlist
from app.schemas import ProposalOut, ScoreOut, WatchlistOut

router = APIRouter()


class AllocateIn(BaseModel):
    amount: float
    note: str = ""


def _money(x: Decimal) -> str:
    return str(x)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config")
def config() -> dict:
    """Parámetros de cartera para el frontend (evita hardcodear el máximo de posiciones, etc.)."""
    return {
        "max_positions": settings.max_positions,
        "min_positions": settings.min_positions,
        "max_position_pct": settings.max_position_pct,
        "dry_run": settings.dry_run,
        "limit_buffer_pct": settings.limit_buffer_pct,
    }


@router.get("/macro")
def macro() -> dict:
    from app.screener.macro import get_macro_regime

    return get_macro_regime()


# ---- Libro de capital -------------------------------------------------------

@router.get("/ledger")
def ledger_snapshot(db: Session = Depends(get_db)) -> dict:
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


@router.post("/ledger/allocate")
def ledger_allocate(body: AllocateIn, db: Session = Depends(get_db)) -> dict:
    ledger.allocate(db, body.amount, body.note)
    return ledger_snapshot(db)


@router.get("/performance")
def performance(db: Session = Depends(get_db)) -> dict:
    """Seguimiento gratis: rentabilidad de la cartera (precio vivo) vs S&P 500 desde la entrada."""
    from app import tracking
    return tracking.performance(db)


# ---- Escaneo ----------------------------------------------------------------

@router.post("/demo/run")
def demo_run(sample_size: int | None = None) -> dict:
    if not settings.enable_llm or not settings.openrouter_api_key:
        raise HTTPException(503, "Configura ENABLE_LLM=true y OPENROUTER_API_KEY.")
    started = pipeline.start(sample_size=sample_size)
    return {"started": started, **pipeline.get_status()}


@router.get("/demo/status")
def demo_status() -> dict:
    return pipeline.get_status()


@router.post("/recheck")
def recheck(db: Session = Depends(get_db)) -> dict:
    """Re-comprobación del top: re-construye la cartera sobre los ya analizados a fondo,
    con el suelo actual, SIN re-escanear el universo (instantáneo)."""
    if not settings.enable_llm or not settings.openrouter_api_key:
        raise HTTPException(503, "Configura ENABLE_LLM=true y OPENROUTER_API_KEY.")
    from app.service import recheck as _recheck
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
    from app.service import redeep as _redeep
    try:
        return _redeep(db)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


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
        res = scan_service.execute_proposal_item(db, ticker.upper())
    except (LookupError, ValueError, ledger.InsufficientFunds, ledger.InsufficientShares) as e:
        raise HTTPException(400, str(e))
    return {**res, "ledger": ledger_snapshot(db)}


@router.post("/proposal/execute")
def proposal_execute_all(db: Session = Depends(get_db)) -> dict:
    """Ejecuta de golpe todos los items accionables de la propuesta en el libro sombra."""
    try:
        res = scan_service.execute_proposal_all(db)
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
    from app.models import BOOK_REAL

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
