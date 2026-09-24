"""Seguimiento de la cartera sombra — GRATIS (solo yfinance, cero LLM).

Valora las posiciones a precio EN VIVO y las compara con el S&P 500 desde la fecha de
entrada, para ver si el agente bate al índice durante la semana de shadow.
"""

from __future__ import annotations

import logging
import threading
import time
from decimal import Decimal

import yfinance as yf
from sqlalchemy.orm import Session

from app.ledger import service as ledger
from app.ledger.money import D, to_cents
from app.models import BOOK_SHADOW, Trade

logger = logging.getLogger(__name__)
ZERO = Decimal("0")
_TTL = 60
_TIMEOUT_S = 6   # sin tope, un Yahoo lento colgaba la petición hasta el timeout del frontend
# Caché POR TICKER: con una sola ranura, cada endpoint (cartera, EURUSD, outcomes) pisaba la del
# anterior y casi nunca acertaba.
_precios: dict[str, tuple[float, float]] = {}
_lock = threading.Lock()


def live_prices(tickers: list[str]) -> dict[str, float]:
    """Último precio de cada ticker, cacheado 60s por ticker; solo descarga los que faltan."""
    tickers = [t for t in dict.fromkeys(tickers) if t]
    if not tickers:
        return {}
    now = time.time()
    with _lock:
        faltan = [t for t in tickers if t not in _precios or now - _precios[t][0] >= _TTL]
    if faltan:
        nuevos: dict[str, float] = {}
        try:
            df = yf.download(faltan, period="5d", interval="1d", auto_adjust=True,
                             group_by="ticker", threads=True, progress=False,
                             timeout=_TIMEOUT_S)
            multi = getattr(df.columns, "nlevels", 1) > 1
            for t in faltan:
                try:
                    s = (df[t]["Close"] if multi else df["Close"]).dropna()
                    if len(s):
                        nuevos[t] = float(s.iloc[-1])
                except Exception:
                    pass
        except Exception:
            logger.warning("yfinance no devolvió precios para %d tickers", len(faltan))
        with _lock:
            for t, px in nuevos.items():
                _precios[t] = (now, px)
    with _lock:
        # Un precio caducado es mejor que ninguno si Yahoo falla ahora.
        return {t: _precios[t][1] for t in tickers if t in _precios}


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
    return live_prices(["SPY"]).get("SPY")   # misma caché: antes descargaba en cada petición


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
    open_ret = round(float(value / cost - 1) * 100, 2) if cost else 0.0
    first = (db.query(Trade).filter(Trade.book == book)
             .order_by(Trade.created_at).first())
    # Benchmark simétrico: SPY desde el MISMO minuto de la primera compra (ref persistida).
    spy_ref = _spy_reference(db, book, first) if first else None
    spy_last = _spy_last() if spy_ref else None
    spy_ret = (round((spy_last / spy_ref - 1) * 100, 2)
               if (spy_ref and spy_last) else None)
    # La cifra principal es la de toda la vida del libro (la curva), no la de las posiciones que
    # quedan abiertas tras la última rotación; esa va aparte como `open_return_pct`.
    from app import history as history_mod
    # Sin posiciones el libro está cerrado (el real quedó en céntimos de restos): no hay curva viva.
    total, spy_total = (history_mod.rentabilidad_total(db, book, prices, spy_last)
                        if first and positions else (None, None))
    port_ret = total if total is not None else open_ret
    if total is not None and spy_total is not None:
        spy_ret = spy_total
    alpha = round(port_ret - spy_ret, 2) if spy_ret is not None else None
    return {
        "since": first.created_at.date().isoformat() if first else None,
        "cost_basis": str(to_cents(cost)),
        "market_value": str(to_cents(value)),
        "portfolio_return_pct": port_ret,
        "open_return_pct": open_ret,
        "spy_return_pct": spy_ret,
        "spy_ref": round(spy_ref, 2) if spy_ref else None,   # precio SPY en la entrada
        "spy_last": round(spy_last, 2) if spy_last else None,  # último SPY
        "alpha_pct": alpha,
        "positions": rows,
    }
