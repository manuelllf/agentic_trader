"""Cartera PERSONAL del usuario en IBKR — snapshot read-only e INTOCABLE para el agente.

Separación de tres capas en la misma cuenta IBKR:
- Libro 'shadow': cartera virtual de seguimiento (no existe en IBKR).
- Libro 'real': SOLO lo que el agente ha ejecutado vía aprobaciones (su única fuente de verdad
  para dimensionar y vender — nunca lee el portfolio bruto de IBKR).
- personal_positions (esta tabla): recibo de lo que era del USUARIO al sincronizar. Informativa:
  alimenta el mini-tracker de la Sala Real y deja constancia explícita de qué no es del agente.

Si el agente compra un ticker que el usuario ya tiene (p.ej. más ASTS), en IBKR se suman,
pero aquí siguen separados: lo del agente está en su libro; lo personal, en este snapshot.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.brokers import ibkr_web
from app.ledger.money import D, to_cents
from app.models import PersonalPosition

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


def sync_from_ibkr(db: Session) -> int:
    """Reemplaza el snapshot con las posiciones actuales de IBKR (lectura, nunca órdenes).

    Requiere credenciales OAuth activas. El snapshot es la cuenta COMPLETA tal y como está;
    si el agente ya tiene posiciones propias, seguirán distinguibles porque lo suyo vive en
    su libro 'real' (este snapshot no se usa para operar).
    """
    if not ibkr_web.credentials_present():
        raise RuntimeError("Sin credenciales IBKR configuradas: no se puede sincronizar.")
    broker = ibkr_web.IbkrWebBroker()
    rows = broker.raw_positions()

    db.execute(delete(PersonalPosition))
    n = 0
    for p in rows:
        qty = p.get("position")
        if qty in (None, 0, 0.0):
            continue
        desc = str(p.get("contractDesc") or "").strip()
        db.add(PersonalPosition(
            ticker=(desc.split()[0] if desc else str(p.get("conid", "?")))[:48],
            description=desc,
            asset_class=str(p.get("assetClass") or "STK")[:8],
            currency=str(p.get("currency") or "USD")[:8],
            quantity=D(str(qty)),
            avg_cost=_dec(p.get("avgCost")),
            mkt_price=_dec(p.get("mktPrice")),
            mkt_value=_dec(p.get("mktValue")),
            unrealized_pnl=_dec(p.get("unrealizedPnl")),
        ))
        n += 1
    db.commit()
    return n


def summary(db: Session) -> dict:
    """Mini-tracker: snapshot + precio vivo (solo acciones; opciones quedan al valor del sync)."""
    from app import tracking

    rows = list(db.scalars(select(PersonalPosition).order_by(PersonalPosition.ticker)).all())
    stock_tickers = [r.ticker for r in rows if r.asset_class == "STK"]
    prices = tracking.live_prices(stock_tickers) if stock_tickers else {}

    out, total_value, total_pnl = [], ZERO, ZERO
    for r in rows:
        live = prices.get(r.ticker) if r.asset_class == "STK" else None
        if r.asset_class == "STK":
            price = D(str(live)) if live is not None else r.mkt_price
            value = to_cents(r.quantity * price) if price is not None else r.mkt_value
            pnl = (to_cents(value - r.quantity * r.avg_cost)
                   if (value is not None and r.avg_cost is not None) else r.unrealized_pnl)
        else:
            # Opciones/derivados: qty×precio NO es el valor (multiplicador ×100). Se usan los
            # valores de IBKR del sync tal cual; nada de recalcular.
            price, value, pnl = r.mkt_price, r.mkt_value, r.unrealized_pnl
        if value is not None:
            total_value += value
        if pnl is not None:
            total_pnl += pnl
        out.append({
            "ticker": r.ticker, "description": r.description, "asset_class": r.asset_class,
            "currency": r.currency, "quantity": str(r.quantity),
            "avg_cost": str(r.avg_cost) if r.avg_cost is not None else None,
            "price": str(to_cents(price)) if price is not None else None,
            "value": str(value) if value is not None else None,
            "unrealized_pnl": str(pnl) if pnl is not None else None,
            "live": live is not None,
        })
    synced = rows[0].synced_at.isoformat() if rows else None
    return {"synced_at": synced, "total_value": str(to_cents(total_value)),
            "total_unrealized_pnl": str(to_cents(total_pnl)), "positions": out}


def _dec(v) -> Decimal | None:  # noqa: ANN001
    if v in (None, ""):
        return None
    try:
        return D(str(v))
    except (ValueError, ArithmeticError):
        return None
