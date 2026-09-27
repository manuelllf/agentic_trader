"""Curva histórica — cierre diario del patrimonio por libro vs S&P 500, con dividendos.

Dos piezas:
- `record_snapshots`: trae a `precio_cierre` los cierres que falten (lo que ha estado en alguna
  cartera y el SPY), upserta el cierre de HOY y rellena los huecos desde el último snapshot
  reproduciendo el log inmutable (asignaciones + trades + dividendos cobrados) con esos
  cierres. Idempotente. Lo llama el job diario del scheduler y el arranque.
- `series`: la curva para el frontend, en índice base 100 PONDERADO POR TIEMPO: las
  aportaciones/retiradas del usuario no cuentan como rentabilidad (se descuentan del retorno
  de su día), así la comparación contra el S&P es honesta con flujos de por medio. El S&P es
  su rentabilidad total, con los dividendos igual que la cartera (netos en el libro real).

La réplica de caja usa el MISMO criterio cent-exacto que `ledger.available_cash` (cada trade
liquida redondeado a céntimos antes de sumar).
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import precios as precios_mod
from app.ledger import dividendos
from app.ledger.money import D, to_cents
from app.models import (
    BOOK_REAL,
    BOOK_SHADOW,
    Allocation,
    EquitySnapshot,
    MomentumEjecucion,
    MomentumSenal,
    Trade,
)

logger = logging.getLogger(__name__)
ZERO = Decimal("0")
_market_date = precios_mod.fecha_mercado


def _inicio_por_ticker(db: Session) -> dict[str, date]:
    """Primer día en cartera de cada ticker (libros de Alpha y posiciones de Omega); el SPY,
    desde el primero de todos."""
    inicio: dict[str, date] = {}
    filas = [*db.execute(select(Trade.ticker, func.min(Trade.created_at)).group_by(Trade.ticker)),
             *db.execute(select(MomentumSenal.ticker, func.min(MomentumEjecucion.ejecutada_at))
                         .join(MomentumSenal, MomentumSenal.id == MomentumEjecucion.senal_id)
                         .group_by(MomentumSenal.ticker))]
    for ticker, ts in filas:
        if ts is not None:
            d = _market_date(ts)
            inicio[ticker] = min(d, inicio.get(ticker, d))
    if inicio:
        inicio[precios_mod.REFERENCIA] = min(inicio.values())
    return inicio


def actualizar_precios(db: Session) -> int:
    """Pone `precio_cierre` al día para todo lo que ha estado en alguna cartera y el SPY."""
    try:
        return precios_mod.al_dia(db, _inicio_por_ticker(db))
    except Exception:
        db.rollback()
        logger.exception("No se pudieron traer los cierres a precio_cierre")
        return 0


def _close_on(closes: dict[date, float] | None, day: date) -> float | None:
    """Último cierre disponible <= day (ffill: cubre festivos parciales o datos que faltan)."""
    if not closes:
        return None
    prev = [d for d in closes if d <= day]
    return closes[max(prev)] if prev else None


def _equity_at_close(trades: list[Trade], allocs: list[Allocation],
                     closes: dict[str, dict[date, float]], day: date) -> Decimal:
    """Patrimonio del libro al cierre de `day`, reproduciendo el log hasta ese día."""
    cash = sum((a.amount for a in allocs if _market_date(a.created_at) <= day), ZERO)
    qty: dict[str, Decimal] = {}
    last_px: dict[str, Decimal] = {}
    for t in trades:
        if _market_date(t.created_at) > day:
            continue
        gross = to_cents(t.quantity * t.price)  # mismo criterio que ledger.available_cash
        if t.side == "buy":
            cash -= gross + t.fees
            qty[t.ticker] = qty.get(t.ticker, ZERO) + t.quantity
        else:
            cash += gross - t.fees
            qty[t.ticker] = qty.get(t.ticker, ZERO) - t.quantity
        last_px[t.ticker] = t.price
    value = ZERO
    for ticker, q in qty.items():
        if q <= ZERO:
            continue
        px = _close_on(closes.get(ticker), day)
        price = D(str(px)) if px is not None else last_px[ticker]  # sin datos: último cruce
        value += to_cents(q * price)
    return to_cents(cash) + value


def record_snapshots(db: Session, books: tuple[str, ...] = (BOOK_SHADOW, BOOK_REAL),
                     desde_cero: bool = False) -> int:
    """Upserta los cierres pendientes de cada libro. Devuelve cuántas filas se escribieron.
    `desde_cero` rehace la curva entera (tras cambiar cómo se calcula)."""
    actualizar_precios(db)
    written = 0
    for book in books:
        try:
            written += _record_book(db, book, desde_cero)
        except Exception:
            db.rollback()
            logger.exception("Snapshot de la curva falló (book=%s)", book)
    return written


def _record_book(db: Session, book: str, desde_cero: bool = False) -> int:
    trades = list(db.scalars(
        select(Trade).where(Trade.book == book).order_by(Trade.created_at)))
    if not trades:
        return 0  # la curva empieza con la primera compra (igual que /performance)
    start = _market_date(trades[0].created_at)
    # Desde el último snapshot INCLUSIVE: el día en curso se reescribe con el cierre definitivo.
    last = None if desde_cero else db.scalar(
        select(func.max(EquitySnapshot.day)).where(EquitySnapshot.book == book))
    from_day = max(start, last) if last else start

    tickers = sorted({t.ticker for t in trades})
    cierres = precios_mod.series(db, [*tickers, precios_mod.REFERENCIA], desde=start)
    dias = [c.dia for c in cierres.get(precios_mod.REFERENCIA, []) if c.dia >= from_day]
    if not dias:
        return 0  # sin cierres del SPY no hay días de bolsa que apuntar (se reintenta mañana)
    closes = {t: {c.dia: c.cierre for c in lista} for t, lista in cierres.items()}
    allocs = list(db.scalars(select(Allocation).where(Allocation.book == book)))
    cobros = dividendos.cobros(db, book, trades)

    n = 0
    for day in dias:
        equity = (_equity_at_close(trades, allocs, closes, day)
                  + sum((c.importe for c in cobros if c.dia <= day), ZERO))
        row = db.scalar(select(EquitySnapshot).where(
            EquitySnapshot.day == day, EquitySnapshot.book == book))
        if row is None:
            db.add(EquitySnapshot(day=day, book=book, equity=equity))
        else:
            row.equity = equity
        n += 1
    db.commit()
    return n


def _indice_sp(db: Session, book: str, desde: date, hasta: date) -> dict[date, float]:
    """Rentabilidad total del S&P (SPY) con los dividendos como los cobra este libro."""
    serie = precios_mod.serie(db, precios_mod.REFERENCIA, desde=desde, hasta=hasta)
    return precios_mod.indice(serie, float(dividendos.parte_cobrada(book)))


def series(db: Session, book: str) -> dict:
    """La curva para el frontend: índice base 100 (ponderado por tiempo) + índice del S&P.

    El retorno de cada día se calcula NETO de flujos — (equity_t − aportaciones_t) / equity_t−1 —
    y se encadena: meter o sacar dinero mueve el equity pero no la curva de rentabilidad.
    """
    rows = list(db.scalars(select(EquitySnapshot).where(EquitySnapshot.book == book)
                           .order_by(EquitySnapshot.day)))
    if not rows:
        return {"book": book, "series": []}
    alloc_days = [(_market_date(a.created_at), a.amount)
                  for a in db.scalars(select(Allocation).where(Allocation.book == book))]
    sp = _indice_sp(db, book, rows[0].day, rows[-1].day)

    out: list[dict] = []
    index = 100.0
    sp_base: float | None = None
    prev: EquitySnapshot | None = None
    for r in rows:
        if prev is not None and prev.equity > ZERO:
            # Flujos atribuidos a esta vela: todo lo aportado desde el snapshot anterior
            # (incluye fines de semana — el lunes descuenta lo del sábado).
            flows = sum((amt for d, amt in alloc_days if prev.day < d <= r.day), ZERO)
            index *= max(0.0, float((r.equity - flows) / prev.equity))
        nivel = sp.get(r.day)
        if sp_base is None and nivel:
            sp_base = nivel
        out.append({
            "date": r.day.isoformat(),
            "equity": str(r.equity),
            "index": round(index, 2),
            "spy_index": round(nivel / sp_base * 100, 2) if (nivel and sp_base) else None,
        })
        prev = r
    return {"book": book, "series": out}


def rentabilidad_total(db: Session, book: str, precios: dict[str, float], spy_now: float | None,
                       hoy: date | None = None) -> tuple[float | None, float | None]:
    """Cartera y S&P desde la primera compra, en % y ponderado por tiempo como la curva: los
    cierres hasta ayer encadenados y el tramo de hoy a precio vivo. (None, None) sin cierres.
    El patrimonio de hoy sale de `_equity_at_close` más los dividendos cobrados, igual que cada
    punto de la curva."""
    hoy = hoy or _market_date(datetime.now(UTC))
    rows = list(db.scalars(select(EquitySnapshot).where(
        EquitySnapshot.book == book, EquitySnapshot.day < hoy).order_by(EquitySnapshot.day)))
    serie = series(db, book)["series"][:len(rows)]
    if not rows or not serie or rows[-1].equity <= ZERO:
        return None, None
    ult, punto = rows[-1], serie[-1]
    allocs = list(db.scalars(select(Allocation).where(Allocation.book == book)))
    trades = list(db.scalars(select(Trade).where(Trade.book == book).order_by(Trade.created_at)))
    equity_now = (_equity_at_close(trades, allocs, {t: {hoy: px} for t, px in precios.items()},
                                   hoy)
                  + dividendos.total(db, book, trades, hasta=hoy))
    flows = sum((a.amount for a in allocs if _market_date(a.created_at) > ult.day), ZERO)
    index = punto["index"] * max(0.0, float((equity_now - flows) / ult.equity))
    cierre_ult = precios_mod.cierre_en(
        precios_mod.serie(db, precios_mod.REFERENCIA, hasta=ult.day), ult.day)
    spy = (punto["spy_index"] * spy_now / cierre_ult
           if (spy_now and cierre_ult and punto["spy_index"] is not None) else None)
    return round(index - 100, 2), (round(spy - 100, 2) if spy is not None else None)
