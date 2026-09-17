"""Alpha: cuenta IBKR real donde el agente propone y Manuel decide -- resumen de
cartera, aportar/retirar capital, y las aprobaciones pendientes/historicas."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import utc_iso

from .common import AllocateIn, money

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


def _approval_out(a) -> dict:  # noqa: ANN001
    return {
        "id": a.id,
        "created_at": utc_iso(a.created_at),
        "decided_at": utc_iso(a.decided_at),
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
    """Foto completa de Alpha: libro real vivo, rendimiento vs S&P, broker, pendientes."""
    import threading

    from app import approvals as approvals_mod
    from app import tracking
    from app.brokers import get_broker
    from app.db import SessionLocal
    from app.models import BOOK_REAL

    # Reconcilia órdenes límite 'working' en un hilo con su PROPIA sesión, sin bloquear la
    # respuesta -- medido en vivo, el sondeo a IBKR (con su ritmo de espera entre órdenes) podía
    # tardar varios segundos. El cron ya reconcilia cada 2 min aunque nadie tenga Alpha abierta
    # (ver `_reconcile_job`); esto solo adelanta esa foto sin hacer esperar al usuario por ella.
    def _reconcile_background() -> None:
        bg_db = SessionLocal()
        try:
            approvals_mod.reconcile_working(bg_db)
        except Exception:  # noqa: BLE001
            pass
        finally:
            bg_db.close()
    threading.Thread(target=_reconcile_background, daemon=True).start()

    prices = tracking.live_prices([p.ticker for p in ledger.open_positions(db, BOOK_REAL)])
    snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t), book=BOOK_REAL)
    wallet = ledger.cash_by_currency(db, BOOK_REAL)   # caja propia del agente, EUR y USD por separado
    eur_rate = tracking.live_prices(["EURUSD=X"]).get("EURUSD=X")
    # + el EUR propio del agente al cambio del momento, o el libro parecería más pobre de lo
    # que es solo por tener euros sin invertir.
    equity_usd = snap.equity + (wallet["EUR"] * D(str(eur_rate)) if eur_rate else Decimal("0"))
    return {
        "cash": {"eur": money(wallet["EUR"]), "usd": money(wallet["USD"])},
        "positions_value": money(snap.positions_value),
        "equity": money(to_cents(equity_usd)),
        "realized_pnl": money(snap.realized_pnl),
        "unrealized_pnl": money(snap.unrealized_pnl),
        "positions": [
            {"ticker": p["ticker"], "quantity": money(p["quantity"]),
             "avg_cost": money(p["avg_cost"]), "price": money(p["price"]),
             "value": money(p["value"])}
            for p in snap.positions
        ],
        "performance": tracking.performance(db, book=BOOK_REAL),
        "broker": get_broker().status(),
        "pending_count": len(approvals_mod.pending(db)),
    }


@router.post("/real/allocate")
def real_allocate(body: AllocateIn, db: Session = Depends(get_db)) -> dict:
    """Aportar/retirar capital del agente. Se apunta EN SU DIVISA, sin convertir — así funciona
    IBKR de verdad: el saldo se queda en euros o dólares tal cual entra, y es IBKR quien
    convierte SOLO en el momento de comprar si la caja USD no alcanza (ver
    `Broker.fx_conversions_for`), no nosotros al aportar."""
    from app.models import BOOK_REAL

    if body.currency == "EUR" and body.amount < 0:
        raise HTTPException(422, "Las retiradas se hacen en $ — el consolidado vive en dólares.")
    ledger.allocate(db, body.amount, body.note, book=BOOK_REAL, currency=body.currency)
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

