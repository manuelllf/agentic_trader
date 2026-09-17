"""Piezas compartidas entre varios routers de /api: formateo de dinero, el snapshot del
libro (sombra por defecto) y el body de aportar/retirar capital."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ledger import service as ledger


class AllocateIn(BaseModel):
    # allow_inf_nan=False: un "1e999" en el JSON llega como Infinity y reventaría el Decimal
    # del libro con un 500; mejor 422 aquí. Bounds holgados (±$1.000M) — negativo = retirada.
    amount: float = Field(allow_inf_nan=False, gt=-1e9, lt=1e9)
    note: str = ""
    # Literal, no str libre: una divisa mal escrita se apuntaría en una caja invisible que
    # nadie cuenta — mejor un 422 claro que una aportación real que desaparece.
    currency: Literal["USD", "EUR"] = "USD"


def money(x: Decimal) -> str:
    return str(x)


def ledger_snapshot(db: Session) -> dict:
    """Foto COMPLETA del sleeve sombra (función interna, no es ruta): la usan los endpoints
    protegidos que necesitan el detalle siempre entero (allocate, ejecutar propuesta...)."""
    from app import tracking
    prices = tracking.live_prices([p.ticker for p in ledger.open_positions(db)])
    snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t))  # valor a precio VIVO
    return {
        "cash": money(snap.cash),
        "positions_value": money(snap.positions_value),
        "equity": money(snap.equity),
        "realized_pnl": money(snap.realized_pnl),
        "unrealized_pnl": money(snap.unrealized_pnl),
        "positions": [
            {"ticker": p["ticker"], "quantity": money(p["quantity"]),
             "avg_cost": money(p["avg_cost"]), "value": money(p["value"])}
            for p in snap.positions
        ],
    }
