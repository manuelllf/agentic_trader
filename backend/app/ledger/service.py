"""Servicio del libro de capital — aritmética exacta en `Decimal`.

Reglas duras (el "sin fallos"):
- No se puede gastar más caja de la disponible (una compra que no cabe → error).
- No se puede vender más cantidad de la que se tiene.
- La caja se DERIVA del log inmutable (asignaciones + trades), no se guarda suelta.
- Todo trade lleva `order_ref` para atribuir solo lo del agente en la cuenta mezclada.

Dos libros paralelos e independientes (`book`):
- 'shadow': la cartera virtual de seguimiento (por defecto — las rutas viejas no cambian).
- 'real': el sleeve del agente en la cuenta IBKR del usuario (solo vía aprobaciones).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ledger.money import D, to_cents
from app.models import BOOK_SHADOW, Allocation, Position, Trade

ZERO = Decimal("0")


class InsufficientFunds(ValueError):
    pass


class InsufficientShares(ValueError):
    pass


def allocate(db: Session, amount, note: str = "", book: str = BOOK_SHADOW) -> Allocation:  # noqa: ANN001
    """Ingreso (+) o retiro (−) de capital del usuario al sleeve del agente."""
    row = Allocation(amount=to_cents(amount), note=note, book=book)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def available_cash(db: Session, book: str = BOOK_SHADOW) -> Decimal:
    """Caja disponible = Σ asignaciones − coste de compras + ingresos de ventas."""
    allocs = db.scalars(select(Allocation).where(Allocation.book == book)).all()
    cash = sum((a.amount for a in allocs), ZERO)
    for t in db.scalars(select(Trade).where(Trade.book == book)).all():
        # Cada trade LIQUIDA en céntimos enteros (como un bróker real): se redondea el bruto
        # ANTES de sumar, no la suma al final. Así la caja es cent-exacta y coincide siempre
        # con el chequeo de record_buy → nunca falla por un descuadre sub-céntimo.
        gross = to_cents(t.quantity * t.price)
        if t.side == "buy":
            cash -= gross + t.fees
        else:  # sell
            cash += gross - t.fees
    return to_cents(cash)


def reset_shadow_book(db: Session) -> dict:
    """DESTRUCTIVO — vacía el libro SOMBRA: borra posiciones, trades, curva y el ancla del
    benchmark SPY (se re-ancla en la próxima 1ª compra). CONSERVA el capital: las aportaciones
    quedan → toda la caja disponible = lo aportado. NO toca el libro real ni otros datos. Sirve
    para descartar la salida de un escaneo defectuoso; el próximo escaneo redespliega la caja.
    """
    from app.models import EquitySnapshot, Meta

    pos = db.query(Position).filter(Position.book == BOOK_SHADOW).delete(synchronize_session=False)
    trd = db.query(Trade).filter(Trade.book == BOOK_SHADOW).delete(synchronize_session=False)
    snap = (db.query(EquitySnapshot).filter(EquitySnapshot.book == BOOK_SHADOW)
            .delete(synchronize_session=False))
    db.query(Meta).filter(Meta.key.like(f"spy_ref:{BOOK_SHADOW}:%")).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": {"positions": pos, "trades": trd, "snapshots": snap},
            "cash_after": str(available_cash(db, BOOK_SHADOW))}


def open_positions(db: Session, book: str = BOOK_SHADOW) -> list[Position]:
    return list(db.scalars(select(Position).where(Position.book == book)).all())


def position_count(db: Session, book: str = BOOK_SHADOW) -> int:
    return len(open_positions(db, book))


def can_open_new(db: Session, ticker: str, max_positions: int, book: str = BOOK_SHADOW) -> bool:
    """True si se puede abrir una posición NUEVA (no supera el máximo de nombres)."""
    positions = open_positions(db, book)
    if any(p.ticker == ticker for p in positions):  # añadir a una existente siempre vale
        return True
    return len(positions) < max_positions


def _position(db: Session, ticker: str, book: str) -> Position | None:
    return db.scalar(
        select(Position).where(Position.ticker == ticker, Position.book == book)
    )


def record_buy(
    db: Session, ticker: str, quantity, price, order_ref: str, fees=ZERO,  # noqa: ANN001
    book: str = BOOK_SHADOW,
) -> Trade:
    qty, px, fee = D(quantity), D(price), to_cents(fees)
    # Coste liquidado en céntimos (idéntico criterio que available_cash) → comparación exacta.
    cost = to_cents(qty * px) + fee
    cash = available_cash(db, book)
    if cost > cash:
        raise InsufficientFunds(
            f"Compra {ticker} cuesta {cost} pero solo hay {cash} de caja."
        )

    trade = Trade(ticker=ticker, side="buy", quantity=qty, price=px, fees=fee,
                  order_ref=order_ref, book=book)
    db.add(trade)

    pos = _position(db, ticker, book)
    if pos is None:
        db.add(Position(ticker=ticker, quantity=qty, avg_cost=px, order_ref=order_ref, book=book))
    else:
        new_qty = pos.quantity + qty
        pos.avg_cost = (pos.quantity * pos.avg_cost + qty * px) / new_qty  # coste medio ponderado
        pos.quantity = new_qty
    db.commit()
    db.refresh(trade)
    return trade


def record_sell(
    db: Session, ticker: str, quantity, price, order_ref: str, fees=ZERO,  # noqa: ANN001
    book: str = BOOK_SHADOW,
) -> Trade:
    qty, px, fee = D(quantity), D(price), to_cents(fees)
    pos = _position(db, ticker, book)
    if pos is None or qty > pos.quantity:
        held = pos.quantity if pos else ZERO
        raise InsufficientShares(f"Vender {qty} de {ticker} pero solo se tienen {held}.")

    realized = to_cents(qty * (px - pos.avg_cost) - fee)
    trade = Trade(
        ticker=ticker, side="sell", quantity=qty, price=px, fees=fee,
        order_ref=order_ref, realized_pnl=realized, book=book,
    )
    db.add(trade)

    if qty == pos.quantity:
        db.delete(pos)  # posición cerrada
    else:
        pos.quantity -= qty  # el coste medio no cambia al vender parte
    db.commit()
    db.refresh(trade)
    return trade


@dataclass
class Snapshot:
    cash: Decimal
    positions_value: Decimal
    equity: Decimal
    realized_pnl: Decimal      # P&L cerrado (ventas ya hechas)
    unrealized_pnl: Decimal    # P&L abierto (posiciones vivas: precio actual − coste)
    positions: list[dict]


def snapshot(
    db: Session, price_lookup: Callable[[str], Decimal] | None = None,
    book: str = BOOK_SHADOW,
) -> Snapshot:
    """Foto del sleeve: caja, valor de posiciones (a precio actual o coste), equity, P&L."""
    cash = available_cash(db, book)
    positions = open_positions(db, book)
    pos_rows = []
    # Cada línea se redondea a céntimos (como la muestra un bróker) y se SUMAN los céntimos:
    # así caja + invertido = patrimonio SIEMPRE cuadra exacto, sin descuadres de doble redondeo.
    pos_value = ZERO
    cost_basis = ZERO
    for p in positions:
        raw = price_lookup(p.ticker) if price_lookup else None
        price = D(raw) if raw is not None else p.avg_cost  # cae al coste si no hay precio vivo
        val = to_cents(p.quantity * price)
        cost = to_cents(p.quantity * p.avg_cost)
        pos_value += val
        cost_basis += cost
        pos_rows.append({
            "ticker": p.ticker, "quantity": p.quantity, "avg_cost": p.avg_cost,
            "price": to_cents(price), "value": val,
        })
    realized = sum(
        (t.realized_pnl
         for t in db.scalars(select(Trade).where(Trade.book == book)).all()
         if t.realized_pnl is not None),
        ZERO,
    )
    return Snapshot(
        cash=cash,
        positions_value=pos_value,
        equity=cash + pos_value,
        realized_pnl=to_cents(realized),
        unrealized_pnl=pos_value - cost_basis,
        positions=pos_rows,
    )


# --- Sizing cent-exacto (compartido por Sala Sombra y Sala Real) --------------

_SHARES = Decimal("0.0001")  # IBKR soporta fraccionales: 4 decimales de acción


def _live_equity(db: Session, book: str, positions: list[Position], cash: Decimal) -> Decimal:
    """Patrimonio del libro a precio VIVO (caja + valor de posiciones). Cae al coste sin precio."""
    from app import tracking  # import perezoso: tracking importa este módulo

    prices = tracking.live_prices([p.ticker for p in positions])
    val = sum(
        (p.quantity * (D(prices[p.ticker]) if p.ticker in prices else p.avg_cost)
         for p in positions),
        ZERO,
    )
    return cash + val


def size_to_weight(
    db: Session, book: str, ticker: str, action: str, target_weight_pct, price,  # noqa: ANN001
    cash_reserved: Decimal = ZERO, shares_reserved: Decimal = ZERO,
) -> tuple[Decimal, str]:
    """(cantidad, lado) cent-exactos para llevar `ticker` a `target_weight_pct` en `book`.

    Reglas duras (el "sin fallos por céntimos"):
    - Compras: acciones = floor(peso·patrimonio / precio) a 4 decimales → el coste NUNCA supera
      el slice; y si aun así no cabe en la caja, se recorta a floor(caja / precio). Jamás falla.
    - Ventas: toda la posición. Recortes: hasta el delta (sin pasarse de lo que se tiene).
    El patrimonio se mide a precio vivo en el momento de ejecutar (no con datos del escaneo).

    Reservas (órdenes límite 'working' aún sin fill, solo libro real): `cash_reserved` resta de
    la caja gastable y `shares_reserved` (de ESTE ticker) de lo vendible → imposible el doble
    gasto o la doble venta mientras una orden anterior sigue viva en IBKR.
    """
    price = D(price)
    if price <= ZERO:
        raise InsufficientFunds(f"Precio inválido para {ticker}.")
    positions = open_positions(db, book)
    cash = available_cash(db, book)
    equity = _live_equity(db, book, positions, cash)
    if equity <= ZERO:
        raise InsufficientFunds("El libro no tiene capital. Asigna fondos primero.")
    spendable = max(ZERO, cash - to_cents(cash_reserved))

    cur = next((p for p in positions if p.ticker == ticker), None)
    cur_qty = cur.quantity if cur else ZERO
    sellable = max(ZERO, cur_qty - shares_reserved)

    if action == "vender":
        if cur_qty <= ZERO:
            raise InsufficientShares(f"No hay posición en {ticker} que vender.")
        if sellable <= ZERO:
            raise InsufficientShares(
                f"{ticker}: ya hay una venta en curso por esas acciones (orden trabajando)."
            )
        return sellable, "sell"

    tgt_qty = (equity * D(target_weight_pct) / 100 / price).quantize(_SHARES, rounding=ROUND_DOWN)
    delta = tgt_qty - cur_qty

    if action in ("comprar", "ampliar"):
        if delta <= ZERO:
            raise InsufficientFunds(
                f"{ticker}: la posición ya cubre el peso objetivo ({target_weight_pct}%)."
            )
        if to_cents(delta * price) > spendable:  # recorta a la caja LIBRE (no comprometida)
            delta = (spendable / price).quantize(_SHARES, rounding=ROUND_DOWN)
            if delta <= ZERO:
                raise InsufficientFunds(
                    f"Caja insuficiente para comprar {ticker}"
                    + (" (hay caja comprometida en órdenes trabajando)." if cash_reserved > ZERO
                       else ".")
                )
        return delta, "buy"

    if action == "recortar":
        if -delta <= ZERO or cur_qty <= ZERO:
            raise InsufficientShares(f"{ticker}: nada que recortar.")
        cut = min(-delta, sellable)
        if cut <= ZERO:
            raise InsufficientShares(
                f"{ticker}: ya hay una venta en curso por esas acciones (orden trabajando)."
            )
        return cut, "sell"

    raise ValueError(f"Acción desconocida: {action}")
