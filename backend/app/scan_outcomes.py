"""Audit trace reader: compares returns by funnel group (cartera/seleccionados/descartados/SPY).

Offline evaluation; never sent back to model."""

from __future__ import annotations

import logging
import time
from statistics import median

import yfinance as yf
from sqlalchemy import select

from app import scan_audit
from app.models import ScanAudit, _utcnow, utc_iso

logger = logging.getLogger(__name__)

CORTE_N = 10  # Cut boundary: N worst admitted vs N best rejected.

_SPY_TTL = 900
_spy_cache: tuple[float, object] | None = None


def _spy_closes():
    """Daily SPY closes (6mo) cached; one series for all cohorts."""
    global _spy_cache
    now = time.time()
    if _spy_cache and now - _spy_cache[0] < _SPY_TTL:
        return _spy_cache[1]
    try:
        s = yf.Ticker("SPY").history(period="6mo", interval="1d",
                                     auto_adjust=True)["Close"].dropna()
        s.index = s.index.tz_localize(None)
    except Exception:
        logger.warning("SPY no disponible para la lectura de outcomes.")
        return None
    _spy_cache = (now, s)
    return s


def _spy_ret_since(day) -> float | None:  # noqa: ANN001
    """% del SPY desde el cierre del día del escaneo hasta el último cierre."""
    s = _spy_closes()
    if s is None or not len(s):
        return None
    base = s.loc[:str(day)]
    if not len(base):
        return None
    return round((float(s.iloc[-1]) / float(base.iloc[-1]) - 1) * 100, 2)


def _stats(rets: list[float]) -> dict:
    if not rets:
        return {"n": 0, "avg": None, "median": None}
    return {"n": len(rets), "avg": round(sum(rets) / len(rets), 2),
            "median": round(median(rets), 2)}


def outcomes(db, limit: int = 8) -> list[dict]:  # noqa: ANN001
    """Cohorts with returns (newest first); names always included.

    Route determines visibility (public aggregate vs signals with session)."""
    from app.tracking import live_prices

    fechas = scan_audit.scan_dates(db, limit)
    if not fechas:
        return []

    # Deep rows + cut boundary (best rejected pre-scores) per cohort; small queries.
    deep_rows = list(db.execute(
        select(ScanAudit).where(ScanAudit.scan_at.in_(fechas),
                                ScanAudit.reached_deep.is_(True))).scalars())
    fuera_by_scan: dict = {}
    for at in fechas:
        fuera_by_scan[at] = list(db.execute(
            select(ScanAudit)
            .where(ScanAudit.scan_at == at, ScanAudit.reached_deep.is_(False),
                   ScanAudit.prescore.is_not(None), ScanAudit.price.is_not(None))
            .order_by(ScanAudit.prescore.desc()).limit(CORTE_N)).scalars())

    tickers = ({r.ticker for r in deep_rows}
               | {r.ticker for rs in fuera_by_scan.values() for r in rs})
    precios = live_prices(sorted(tickers))

    def _ret(r: ScanAudit) -> float | None:
        px = precios.get(r.ticker)
        if not px or not r.price:
            return None
        return round((px / r.price - 1) * 100, 2)

    # DB stores UTC naive; subtract naive from naive.
    hoy = _utcnow().replace(tzinfo=None)
    salida: list[dict] = []
    for at in fechas:
        cohorte = [r for r in deep_rows if r.scan_at == at]
        # Unreadable deep not a criterion reject; exclude from groups.
        validos = [r for r in cohorte if r.stage != "deep_error"]

        def _grupo(rows: list) -> dict:
            return _stats([x for x in (_ret(r) for r in rows) if x is not None])

        cartera = [r for r in validos if r.funded]
        selec = [r for r in validos if r.selected and not r.funded]
        descartados = [r for r in validos if not r.selected]

        # funded travels even without session; portfolio membership is public behavior (holdings count).
        pares = [{"ticker": r.ticker, "score": r.deep_score, "ret": _ret(r),
                  "funded": bool(r.funded)}
                 for r in validos if r.deep_score is not None and _ret(r) is not None]

        # Cut boundary (same metric both sides: prescore); N best rejected vs N worst admitted.
        dentro = sorted((r for r in validos if r.prescore is not None),
                        key=lambda r: r.prescore)[:CORTE_N]
        fuera = fuera_by_scan.get(at, [])

        def _lado(rows: list) -> dict:
            return {**_grupo(rows),
                    "nombres": [{"ticker": r.ticker, "prescore": r.prescore, "ret": _ret(r)}
                                for r in rows]}

        salida.append({
            "at": utc_iso(at),
            # From trace flag, not inferred; construction also recorded in observatories. NULL = observatory.
            "mode": "decisión" if any(r.decide for r in cohorte) else "observatorio",
            "days": max(0, (hoy - at.replace(tzinfo=None)).days),
            "groups": {
                "cartera": _grupo(cartera),
                "seleccionados": _grupo(selec),
                "descartados": _grupo(descartados),
                "spy": _spy_ret_since(at.date()),
            },
            "pairs": pares,
            "corte": {"fuera": _lado(fuera), "dentro": _lado(dentro)},
        })
    return salida


def book_row(db) -> dict | None:  # noqa: ANN001
    """Real book row: shadow book at current market price (not equal weight).

    Trace doesn't cover initial purchase decision; ledger provides actual costs."""
    try:
        from app.tracking import performance

        perf = performance(db)
        if not perf.get("positions"):
            return None
        return {
            "since": perf.get("since"),
            "ret": perf.get("portfolio_return_pct"),
            "spy": perf.get("spy_return_pct"),
            "n": len(perf["positions"]),
        }
    except Exception:
        logger.warning("Fila del libro real no disponible para outcomes.")
        return None


def ticker_history(db, ticker: str, limit: int = 26) -> list[dict]:  # noqa: ANN001
    """Ticker history across scans (newest first); session-only detail."""
    stmt = (select(ScanAudit).where(ScanAudit.ticker == ticker.upper())
            .order_by(ScanAudit.scan_at.desc()).limit(limit))
    return [
        {"at": utc_iso(r.scan_at), "stage": r.stage, "prescore": r.prescore,
         "deep_score": r.deep_score, "price": r.price, "weight_pct": r.weight_pct}
        for r in db.execute(stmt).scalars()
    ]
