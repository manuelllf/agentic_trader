"""Precios de cierre canónicos (`public.precio_cierre`, B8) y las cuentas que salen de ellos.

Una fila por ticker y día de bolsa con el cierre tal como se negoció, el dividendo con fecha ex
ese día y el factor de split que entra en vigor ese día. Nada ajustado: una serie ajustada hacia
atrás cambia con cada dividendo nuevo, y guardarla es guardar algo que caduca. La rentabilidad
total (con dividendos) se calcula al leer.

Solo se guardan los tickers de alguna cartera (libros de Alpha, posiciones de Omega, liga) y el
SPY, nunca el universo entero.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

FUENTE = "yfinance"
REFERENCIA = "SPY"
_TZ_BOLSA = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class Cierre:
    dia: date
    cierre: float
    dividendo: float = 0.0
    split: float = 1.0


def fecha_mercado(ts: datetime) -> date:
    """Día de bolsa (Nueva York) de un instante de la BD (UTC, a veces sin zona en SQLite)."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(_TZ_BOLSA).date()


def deshacer_ajuste(filas: list[tuple[date, float, float, float]]) -> list[Cierre]:
    """(día, cierre, dividendo, split) de Yahoo → cierres tal como se negociaron.

    Yahoo divide el cierre y el dividendo de cada día por los splits posteriores. Se deshace con
    los splits del propio rango, que llega siempre hasta hoy; el split se apunta el día en que
    entra en vigor (0 en Yahoo = no hubo)."""
    factor = 1.0
    out: list[Cierre] = []
    for dia, cierre, dividendo, split in sorted(filas, reverse=True):
        out.append(Cierre(dia, cierre * factor, (dividendo or 0.0) * factor, split or 1.0))
        if split and split != 1.0:
            factor *= split
    return sorted(out, key=lambda c: c.dia)


def descargar(tickers: list[str], desde: date) -> dict[str, list[Cierre]]:
    """Cierres, dividendos y splits de Yahoo desde `desde` hasta hoy, en bruto."""
    import math

    import yfinance as yf

    tickers = list(dict.fromkeys(t for t in tickers if t))
    if not tickers:
        return {}
    try:
        df = yf.download(tickers, start=desde, interval="1d", auto_adjust=False, actions=True,
                         group_by="ticker", threads=True, progress=False, timeout=10)
    except Exception:
        logger.exception("Yahoo no devolvió cierres para %d tickers", len(tickers))
        return {}
    multi = getattr(df.columns, "nlevels", 1) > 1
    out: dict[str, list[Cierre]] = {}
    for t in tickers:
        try:
            sub = df[t] if multi else df
        except KeyError:
            continue
        filas = []
        for idx, r in sub.iterrows():
            cierre = float(r.get("Close", float("nan")))
            if math.isnan(cierre) or cierre <= 0:
                continue
            div = float(r.get("Dividends", 0) or 0)
            split = float(r.get("Stock Splits", 0) or 0)
            filas.append((idx.date(), cierre, 0.0 if math.isnan(div) else div,
                          0.0 if math.isnan(split) else split))
        if filas:
            out[t] = deshacer_ajuste(filas)
    return out


def guardar(db: Session, ticker: str, cierres: list[Cierre], fuente: str = FUENTE) -> int:
    """Upsert por (ticker, día): el día en curso se reescribe con el cierre definitivo."""
    from app.models import PrecioCierre

    if not cierres:
        return 0
    filas = [{"ticker": ticker, "dia": c.dia, "cierre": round(c.cierre, 4),
              "dividendo": round(c.dividendo, 6), "split": round(c.split, 6), "fuente": fuente}
             for c in cierres]
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(PrecioCierre).values(filas)
    stmt = stmt.on_conflict_do_update(
        index_elements=["ticker", "dia"],
        set_={k: stmt.excluded[k] for k in ("cierre", "dividendo", "split", "fuente")})
    db.execute(stmt)
    db.commit()
    return len(filas)


def al_dia(db: Session, inicio: dict[str, date]) -> int:
    """Trae de cada ticker lo que falte: desde su último día guardado (que se reescribe, por si
    era un cierre a medias) o, si es nuevo, desde su `inicio` (su primer día en cartera)."""
    from app.models import PrecioCierre

    if not inicio:
        return 0
    ultimos = dict(db.execute(
        select(PrecioCierre.ticker, func.max(PrecioCierre.dia))
        .where(PrecioCierre.ticker.in_(sorted(inicio))).group_by(PrecioCierre.ticker)).all())
    por_desde: dict[date, list[str]] = defaultdict(list)
    for t, desde in inicio.items():
        por_desde[ultimos.get(t) or desde].append(t)
    n = 0
    for desde, grupo in sorted(por_desde.items()):
        for t, cierres in descargar(grupo, desde).items():
            n += guardar(db, t, cierres)
    return n


def series(db: Session, tickers: list[str], desde: date | None = None,
           hasta: date | None = None) -> dict[str, list[Cierre]]:
    """Lo guardado de cada ticker, ordenado por día."""
    from app.models import PrecioCierre

    q = select(PrecioCierre).where(PrecioCierre.ticker.in_(sorted(set(tickers))))
    if desde is not None:
        q = q.where(PrecioCierre.dia >= desde)
    if hasta is not None:
        q = q.where(PrecioCierre.dia <= hasta)
    out: dict[str, list[Cierre]] = defaultdict(list)
    for p in db.scalars(q.order_by(PrecioCierre.ticker, PrecioCierre.dia)):
        out[p.ticker].append(Cierre(p.dia, float(p.cierre), float(p.dividendo), float(p.split)))
    return dict(out)


def serie(db: Session, ticker: str, desde: date | None = None,
          hasta: date | None = None) -> list[Cierre]:
    return series(db, [ticker], desde, hasta).get(ticker, [])


def indice(cierres: list[Cierre], dividendos: float = 1.0) -> dict[date, float]:
    """Nivel acumulado (1 el primer día) reinvirtiendo los dividendos: cada día rinde
    (cierre + dividendo × `dividendos`) × split / cierre anterior. `dividendos` es 1 en bruto,
    0,85 neto de la retención de EE. UU. y 0 para ver solo el precio."""
    nivel, previo = 1.0, None
    out: dict[date, float] = {}
    for c in cierres:
        if previo is not None:
            nivel *= (c.cierre + c.dividendo * dividendos) * c.split / previo
        out[c.dia] = nivel
        previo = c.cierre
    return out


def cierre_en(cierres: list[Cierre], dia: date) -> float | None:
    """Último cierre guardado a fecha `dia` (cubre festivos y días que falten)."""
    previos = [c.cierre for c in cierres if c.dia <= dia]
    return previos[-1] if previos else None
