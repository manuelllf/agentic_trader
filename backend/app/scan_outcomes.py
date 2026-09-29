"""Audit trace reader: compares returns by funnel group (cartera/seleccionados/descartados/SPY).

Rentabilidad total, con dividendos, para todos los grupos y el SPY: cierres ajustados de una
misma serie, desde el cierre del día del escaneo. Son carteras hipotéticas, no dinero: dividendos
brutos, y no se guardan en `precio_cierre` (serían cientos de tickers que no están en ninguna
cartera).

Offline evaluation; never sent back to model."""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta
from statistics import median

from sqlalchemy import select

from app import scan_audit
from app.llm.jev import PREGUNTAS
from app.models import ScanAudit, _utcnow, utc_iso
from app.precios import REFERENCIA, fecha_mercado

logger = logging.getLogger(__name__)

CORTE_N = 10  # Cut boundary: N worst admitted vs N best rejected.

_TTL = 900
_cache: dict = {}
_lock = threading.Lock()


def _cierres_ajustados(tickers: list[str], desde: date) -> dict[str, list[tuple[date, float]]]:
    """Cierres ajustados (dividendos reinvertidos) desde `desde`, cacheados 15 min: entre dos
    puntos de la misma serie, la rentabilidad es la total. El último punto es el precio de hoy
    si la bolsa está abierta."""
    import yfinance as yf

    clave = (tuple(sorted(tickers)), desde)
    # Con el candado, dos visitas a la vez no descargan cientos de tickers por duplicado: la
    # segunda espera y encuentra la caché ya puesta.
    with _lock:
        ahora = time.time()
        if clave in _cache and ahora - _cache[clave][0] < _TTL:
            return _cache[clave][1]
        try:
            df = yf.download(sorted(tickers), start=desde, interval="1d", auto_adjust=True,
                             group_by="ticker", threads=True, progress=False, timeout=10)
        except Exception:
            logger.warning("Yahoo no devolvió cierres para la lectura de outcomes.")
            return {}
        multi = getattr(df.columns, "nlevels", 1) > 1
        out: dict[str, list[tuple[date, float]]] = {}
        for t in tickers:
            try:
                s = (df[t]["Close"] if multi else df["Close"]).dropna()
            except Exception:
                continue
            if len(s):
                out[t] = [(i.date(), float(v)) for i, v in s.items()]
        _cache.clear()                 # una sola entrada: la de los escaneos que se miran ahora
        _cache[clave] = (ahora, out)
        return out


def _ret_desde(serie: list[tuple[date, float]] | None, dia: date) -> float | None:
    """% desde el cierre de `dia` (o el último anterior) hasta el último punto de la serie."""
    if not serie:
        return None
    base = [v for d, v in serie if d <= dia]
    if not base or not base[-1]:
        return None
    return round((serie[-1][1] / base[-1] - 1) * 100, 2)


def _stats(rets: list[float]) -> dict:
    if not rets:
        return {"n": 0, "avg": None, "median": None}
    return {"n": len(rets), "avg": round(sum(rets) / len(rets), 2),
            "median": round(median(rets), 2)}


def _posicion_jev(r: ScanAudit, ret: float | None) -> dict:
    """Nota, confianza y las 4 preguntas de vuelta a su escala (nivel 0-9, confianza 0-1)."""
    dims = {k: (getattr(r, f"jev_{k}"), getattr(r, f"jev_{k}_conf")) for k in PREGUNTAS}
    confs = [c / 1000 for _n, c in dims.values() if c is not None]
    return {
        "ticker": r.ticker, "sector": r.sector, "prescore": r.prescore, "ret": ret,
        "confidence": round(sum(confs) / len(confs), 3) if confs else None,
        "dimensiones": {k: [n / 100, None if c is None else c / 1000]
                        for k, (n, c) in dims.items() if n is not None},
    }


def outcomes(db, limit: int = 8) -> list[dict]:  # noqa: ANN001
    """Cohorts with returns (newest first); names always included.

    Route determines visibility (public aggregate vs signals with session)."""
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
    # Cartera de Jev: sombra sin dinero, puede incluir nombres que no llegaron al profundo.
    jev_rows = list(db.execute(
        select(ScanAudit).where(ScanAudit.scan_at.in_(fechas),
                                ScanAudit.jev_funded.is_(True))).scalars())

    tickers = ({r.ticker for r in deep_rows}
               | {r.ticker for rs in fuera_by_scan.values() for r in rs}
               | {r.ticker for r in jev_rows} | {REFERENCIA})
    desde = min(fecha_mercado(at) for at in fechas) - timedelta(days=7)
    series = _cierres_ajustados(sorted(tickers), desde)

    def _ret(r: ScanAudit) -> float | None:
        return _ret_desde(series.get(r.ticker), fecha_mercado(r.scan_at))

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

        jev = sorted((r for r in jev_rows if r.scan_at == at), key=lambda r: -(r.prescore or 0))

        salida.append({
            "at": utc_iso(at),
            # From trace flag, not inferred; construction also recorded in observatories. NULL = observatory.
            "mode": "decisión" if any(r.decide for r in cohorte) else "observatorio",
            "days": max(0, (hoy - at.replace(tzinfo=None)).days),
            "groups": {
                "cartera": _grupo(cartera),
                "seleccionados": _grupo(selec),
                "descartados": _grupo(descartados),
                # Equiponderada (20% cada una): la media simple ES su rentabilidad bruta.
                "jev": _grupo(jev),
                "spy": _ret_desde(series.get(REFERENCIA), fecha_mercado(at)),
            },
            "pairs": pares,
            "corte": {"fuera": _lado(fuera), "dentro": _lado(dentro)},
            "jev": [_posicion_jev(r, _ret(r)) for r in jev],
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
