"""Seguimiento de la cartera sombra — GRATIS (solo yfinance, cero LLM).

Valora las posiciones a precio EN VIVO y las compara con el S&P 500 desde la fecha de
entrada, para ver si el agente bate al índice durante la semana de shadow.
"""

from __future__ import annotations

import time
from decimal import Decimal

import yfinance as yf
from sqlalchemy.orm import Session

from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import BOOK_SHADOW, Trade

ZERO = Decimal("0")
_TTL = 60
_cache: tuple[float, dict] | None = None


def live_prices(tickers: list[str]) -> dict[str, float]:
    """Último precio de cada ticker (cacheado 60s para no martillear yfinance en cada poll)."""
    global _cache
    tickers = [t for t in tickers if t]
    if not tickers:
        return {}
    now = time.time()
    if _cache and now - _cache[0] < _TTL and set(tickers) <= set(_cache[1]):
        return _cache[1]
    out: dict[str, float] = {}
    try:
        df = yf.download(tickers, period="5d", interval="1d", auto_adjust=True,
                         group_by="ticker", threads=True, progress=False)
        multi = getattr(df.columns, "nlevels", 1) > 1
        for t in tickers:
            try:
                s = (df[t]["Close"] if multi else df["Close"]).dropna()
                if len(s):
                    out[t] = float(s.iloc[-1])
            except Exception:
                pass
    except Exception:
        pass
    _cache = (now, out)
    return out


def _spy_price_at(ts) -> float | None:  # noqa: ANN001
    """Precio del SPY en el minuto `ts` (velas 1m; yfinance solo conserva ~7 días).

    Se usa UNA vez por libro — justo tras la primera compra — y el valor se persiste en Meta,
    así que la ventana de 7 días nunca nos limita."""
    from datetime import timedelta, timezone as tz

    try:
        day = ts.date()
        s = yf.Ticker("SPY").history(
            start=day, end=day + timedelta(days=1), interval="1m")["Close"].dropna()
        if s.empty:
            return None
        target = ts.replace(tzinfo=tz.utc) if ts.tzinfo is None else ts  # BD guarda UTC naive
        idx = s.index.tz_convert("UTC")
        after = s[idx >= target]
        return float(after.iloc[0] if len(after) else s.iloc[-1])
    except Exception:
        return None


def _spy_last() -> float | None:
    try:
        s = yf.Ticker("SPY").history(period="5d")["Close"].dropna()
        return float(s.iloc[-1]) if len(s) else None
    except Exception:
        return None


def _spy_reference(db: Session, book: str, first: Trade) -> float | None:
    """Precio de REFERENCIA del SPY para el benchmark: el del minuto de la primera compra.

    Se captura una vez y se PERSISTE (tabla Meta) clavado a esa primera compra: así cartera y
    S&P miden desde el MISMO instante (no cartera-desde-intradía vs SPY-desde-cierre, que
    sesgaba el alpha). Si el minuto exacto ya no está disponible, cae al cierre de ese día.
    Un reset del libro (nueva primera compra) genera una clave nueva."""
    from app.models import Meta

    key = f"spy_ref:{book}:{first.id}"
    row = db.get(Meta, key)
    if row is not None:
        try:
            return float(row.value)
        except ValueError:
            pass
    px = _spy_price_at(first.created_at)
    if px is None:  # fallback: cierre del día de entrada (vela diaria)
        try:
            s = yf.Ticker("SPY").history(start=first.created_at.date())["Close"].dropna()
            px = float(s.iloc[0]) if len(s) else None
        except Exception:
            px = None
    if px is not None:
        db.merge(Meta(key=key, value=str(px)))
        db.commit()
    return px


def performance(db: Session, book: str = BOOK_SHADOW) -> dict:
    """Rentabilidad de la cartera (a precio vivo) vs S&P 500 desde la primera compra."""
    positions = ledger.open_positions(db, book)
    prices = live_prices([p.ticker for p in positions])
    # P&L realizado por ticker (ventas ya hechas) → para el detalle por acción.
    realized_by_t: dict[str, Decimal] = {}
    for t in db.query(Trade).filter(Trade.book == book).all():
        if t.realized_pnl is not None:
            realized_by_t[t.ticker] = realized_by_t.get(t.ticker, ZERO) + t.realized_pnl
    cost = ZERO
    value = ZERO
    rows = []
    for p in positions:
        px = D(prices[p.ticker]) if p.ticker in prices else p.avg_cost
        c = to_cents(p.quantity * p.avg_cost)   # coste base (céntimos)
        v = to_cents(p.quantity * px)           # valor de mercado (céntimos)
        cost += c
        value += v
        rows.append({
            "ticker": p.ticker, "quantity": str(p.quantity),
            "avg_cost": str(p.avg_cost), "price": str(to_cents(px)),
            "value": str(v), "cost_basis": str(c),
            "unrealized_pnl": str(v - c),
            "realized_pnl": str(to_cents(realized_by_t.get(p.ticker, ZERO))),
            "pnl_pct": round(float(px / p.avg_cost - 1) * 100, 2) if p.avg_cost else 0.0,
        })
    port_ret = round(float(value / cost - 1) * 100, 2) if cost else 0.0
    first = (db.query(Trade).filter(Trade.book == book)
             .order_by(Trade.created_at).first())
    # Benchmark simétrico: SPY desde el MISMO minuto de la primera compra (ref persistida).
    spy_ref = _spy_reference(db, book, first) if first else None
    spy_last = _spy_last() if spy_ref else None
    spy_ret = (round((spy_last / spy_ref - 1) * 100, 2)
               if (spy_ref and spy_last) else None)
    alpha = round(port_ret - spy_ret, 2) if spy_ret is not None else None
    return {
        "since": first.created_at.date().isoformat() if first else None,
        "cost_basis": str(to_cents(cost)),
        "market_value": str(to_cents(value)),
        "portfolio_return_pct": port_ret,
        "spy_return_pct": spy_ret,
        "spy_ref": round(spy_ref, 2) if spy_ref else None,   # precio SPY en la entrada
        "spy_last": round(spy_last, 2) if spy_last else None,  # último SPY
        "alpha_pct": alpha,
        "positions": rows,
    }
