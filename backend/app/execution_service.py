"""Ejecución de la propuesta en el LIBRO SOMBRA (dinero simulado, cero riesgo).

Aislado del escaneo (`app.scan_service`): aquí solo se traduce la última propuesta ya persistida en
movimientos del libro sombra, con sizing cent-exacto y a precio VIVO. Idempotente y best-effort.

- `execute_proposal_item`: un item (botón Comprar/Vender de la Sala Sombra).
- `execute_proposal_all`: todos los accionables — ventas/recortes primero (liberan caja),
  compras/ampliaciones después. Lo llama el escaneo para auto-ejecutar el libro sombra.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import BOOK_SHADOW, Proposal


def _latest_proposal(db: Session) -> Proposal | None:
    return db.scalars(select(Proposal).order_by(Proposal.id.desc())).first()


def execute_proposal_item(db: Session, ticker: str) -> dict:
    """Ejecuta UN item de la última propuesta en el LIBRO SOMBRA (simulado, sin dinero real).

    Es el backend del botón «Comprar/Vender» de la Sala Sombra: dimensiona el tamaño al peso
    objetivo con el sizing cent-exacto compartido (nunca sobrepasa la caja) y lo registra a
    precio VIVO. Idempotente: reintentar una compra ya cubierta devuelve un error claro.
    """
    from app import tracking

    prop = _latest_proposal(db)
    if prop is None:
        raise LookupError("No hay ninguna propuesta que ejecutar.")
    item = next((it for it in (prop.items or []) if it.get("ticker") == ticker), None)
    if item is None:
        raise LookupError(f"{ticker} no está en la propuesta actual.")
    action = item.get("action")
    if action in (None, "", "mantener"):
        raise ValueError(f"{ticker}: «{action or 'sin acción'}» no es ejecutable.")

    prices = tracking.live_prices([ticker])
    price = (D(prices[ticker]) if ticker in prices
             else D(item["price"]) if item.get("price") else None)
    if price is None:
        raise ValueError(f"Sin precio de mercado para {ticker}.")

    qty, side = ledger.size_to_weight(
        db, BOOK_SHADOW, ticker, action, item.get("target_weight_pct") or 0.0, price,
        live_prices=tracking.live_prices)
    ref = f"shadow-prop{prop.id}"
    if side == "buy":
        ledger.record_buy(db, ticker, qty, price, ref, book=BOOK_SHADOW)
    else:
        ledger.record_sell(db, ticker, qty, price, ref, book=BOOK_SHADOW)

    verb = "Compra" if side == "buy" else "Venta"
    return {
        "ok": True, "ticker": ticker, "side": side,
        "quantity": str(qty), "price": str(to_cents(price)),
        "message": f"{verb} {qty} {ticker} @ ${to_cents(price)} (sombra).",
    }


_SELL_ACTIONS = {"vender", "recortar"}  # las que liberan caja; deben ir antes que las compras


def execute_proposal_all(db: Session) -> dict:
    """Ejecuta TODOS los items accionables de la última propuesta en el libro sombra.

    Orden EXPLÍCITO (no el de la propuesta, que depende del LLM): ventas/recortes primero para
    liberar caja, compras/ampliaciones después — así una compra nunca falla por falta de caja
    que una venta de la MISMA propuesta iba a liberar. Best-effort: los que no caben o ya están
    cubiertos se saltan y se reportan; no aborta el resto. Idempotente (ver `execute_proposal_item`
    y `size_to_weight`: reintentar un item ya al objetivo cae en `skipped`, no revienta).
    """
    prop = _latest_proposal(db)
    if prop is None:
        raise LookupError("No hay ninguna propuesta que ejecutar.")
    actionable = [it for it in (prop.items or []) if it.get("action") not in (None, "", "mantener")]
    actionable.sort(key=lambda it: 0 if it.get("action") in _SELL_ACTIONS else 1)
    done, skipped = [], []
    for it in actionable:
        try:
            res = execute_proposal_item(db, it["ticker"])
            done.append(res["message"])
        except Exception as exc:  # noqa: BLE001 — el motivo debe llegar al panel
            skipped.append(f"{it['ticker']}: {exc}")
    return {"ok": True, "executed": done, "skipped": skipped,
            "message": f"{len(done)} ejecutada(s), {len(skipped)} saltada(s)."}
