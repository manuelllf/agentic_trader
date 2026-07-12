"""Curva histórica — cierre diario del patrimonio por libro vs S&P 500 (gratis, solo yfinance).

Dos piezas:
- `record_snapshots`: upserta el cierre de HOY y rellena los huecos desde el último snapshot
  reproduciendo el log inmutable (asignaciones + trades) con cierres históricos. Idempotente:
  correrlo dos veces deja lo mismo. Lo llama el job diario del scheduler y el arranque.
- `series`: la curva para el frontend, en índice base 100 PONDERADO POR TIEMPO: las
  aportaciones/retiradas del usuario no cuentan como rentabilidad (se descuentan del retorno
  de su día), así la comparación contra el S&P es honesta con flujos de por medio.

La réplica de caja usa el MISMO criterio cent-exacto que `ledger.available_cash` (cada trade
liquida redondeado a céntimos antes de sumar).
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.ledger.money import D, to_cents
from app.models import BOOK_REAL, BOOK_SHADOW, Allocation, EquitySnapshot, Trade

logger = logging.getLogger(__name__)
ZERO = Decimal("0")


def _market_date(ts: datetime) -> date:
    """Fecha de mercado de un timestamp de la BD (UTC naive) en la zona de la bolsa."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(ZoneInfo(settings.scan_timezone)).date()


def _daily_closes(tickers: list[str], start: date) -> dict[str, dict[date, float]]:
    """Cierres diarios por ticker desde `start` (incluye el día en curso si el mercado abrió)."""
    import yfinance as yf

    out: dict[str, dict[date, float]] = {}
    try:
        df = yf.download(tickers, start=start, interval="1d", auto_adjust=True,
                         group_by="ticker", threads=True, progress=False)
        multi = getattr(df.columns, "nlevels", 1) > 1
        for t in tickers:
            try:
                s = (df[t]["Close"] if multi else df["Close"]).dropna()
                out[t] = {idx.date(): float(v) for idx, v in s.items()}
            except Exception:
                pass
    except Exception:
        logger.exception("yfinance no devolvió cierres históricos")
    return out


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


def record_snapshots(db: Session, books: tuple[str, ...] = (BOOK_SHADOW, BOOK_REAL)) -> int:
    """Upserta los cierres pendientes de cada libro. Devuelve cuántas filas se escribieron."""
    written = 0
    for book in books:
        try:
            written += _record_book(db, book)
        except Exception:
            logger.exception("Snapshot de la curva falló (book=%s)", book)
    return written


def _record_book(db: Session, book: str) -> int:
    trades = list(db.scalars(
        select(Trade).where(Trade.book == book).order_by(Trade.created_at)))
    if not trades:
        return 0  # la curva empieza con la primera compra (igual que /performance)
    start = _market_date(trades[0].created_at)
    # Desde el último snapshot INCLUSIVE: el día en curso se reescribe con el cierre definitivo.
    last = db.scalar(select(func.max(EquitySnapshot.day))
                     .where(EquitySnapshot.book == book))
    from_day = max(start, last) if last else start

    tickers = sorted({t.ticker for t in trades})
    closes = _daily_closes([*tickers, "SPY"], start)
    spy = closes.get("SPY")
    if not spy:
        return 0  # sin benchmark no hay días de mercado que apuntar (se reintenta mañana)
    allocs = list(db.scalars(select(Allocation).where(Allocation.book == book)))

    n = 0
    for day in sorted(d for d in spy if from_day <= d):
        equity = _equity_at_close(trades, allocs, closes, day)
        row = db.scalar(select(EquitySnapshot).where(
            EquitySnapshot.day == day, EquitySnapshot.book == book))
        if row is None:
            db.add(EquitySnapshot(day=day, book=book, equity=equity, spy_close=spy.get(day)))
        else:
            row.equity = equity
            row.spy_close = spy.get(day)
        n += 1
    db.commit()
    return n


def series(db: Session, book: str) -> dict:
    """La curva para el frontend: índice base 100 (ponderado por tiempo) + índice del S&P.

    El retorno de cada día se calcula NETO de flujos — (equity_t − aportaciones_t) / equity_t−1 —
    y se encadena: meter o sacar dinero mueve el equity pero no la curva de rentabilidad.
    """
    rows = list(db.scalars(select(EquitySnapshot).where(EquitySnapshot.book == book)
                           .order_by(EquitySnapshot.day)))
    alloc_days = [(_market_date(a.created_at), a.amount)
                  for a in db.scalars(select(Allocation).where(Allocation.book == book))]

    out: list[dict] = []
    index = 100.0
    spy_base: float | None = None
    prev: EquitySnapshot | None = None
    for r in rows:
        if prev is not None and prev.equity > ZERO:
            # Flujos atribuidos a esta vela: todo lo aportado desde el snapshot anterior
            # (incluye fines de semana — el lunes descuenta lo del sábado).
            flows = sum((amt for d, amt in alloc_days if prev.day < d <= r.day), ZERO)
            index *= max(0.0, float((r.equity - flows) / prev.equity))
        if spy_base is None and r.spy_close:
            spy_base = r.spy_close
        spy_index = round(r.spy_close / spy_base * 100, 2) if (r.spy_close and spy_base) else None
        out.append({
            "date": r.day.isoformat(),
            "equity": str(r.equity),
            "index": round(index, 2),
            "spy_index": spy_index,
        })
        prev = r
    return {"book": book, "series": out}
