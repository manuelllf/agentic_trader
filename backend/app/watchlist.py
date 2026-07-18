"""Watchlist relacional — memoria de scores altos entre escaneos (sus mejores van al profundo).

Reglas (config): entra si score >= `watchlist_entry_score`; sale si al re-analizarla cae por
debajo de `watchlist_evict_score`, o si lleva > `watchlist_stale_days` sin volver a puntuar
alto; tope `watchlist_max` (si se supera, caen las de menor score). Es la capa "lo que VIGILO"
del estado del agente (junto al ledger "lo que POSEO" y la memoria vectorial "lo que APRENDÍ").
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Watchlist


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    """SQLite devuelve datetimes naive; los normalizamos a UTC para comparar."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def tickers(db: Session) -> list[str]:
    return [w.ticker for w in db.scalars(select(Watchlist)).all()]


def top(db: Session, n: int) -> list[str]:
    """Los `n` tickers de la watchlist con mayor score."""
    stmt = select(Watchlist).order_by(Watchlist.score.desc()).limit(n)
    return [w.ticker for w in db.scalars(stmt).all()]


def thesis_for(db: Session, ticker: str) -> str | None:
    w = db.scalar(select(Watchlist).where(Watchlist.ticker == ticker))
    return w.thesis if w else None


def drop(db: Session, tickers: set[str]) -> None:
    """Saca de la watchlist los tickers dados (p.ej. los que ya son POSICIÓN)."""
    if not tickers:
        return
    for w in db.scalars(select(Watchlist).where(Watchlist.ticker.in_(tickers))).all():
        db.delete(w)
    db.commit()


def update(db: Session, scored: list[tuple[str, int, str]]) -> None:
    """Aplica los scores de un escaneo a la watchlist. `scored` = [(ticker, score, thesis)]."""
    entry = settings.watchlist_entry_score
    evict = settings.watchlist_evict_score
    now = _now()
    existing = {w.ticker: w for w in db.scalars(select(Watchlist)).all()}

    for ticker, score, thesis in scored:
        w = existing.get(ticker)
        if w is not None:
            if score < evict:                      # re-analizada y flojeó → fuera
                db.delete(w)
                existing.pop(ticker, None)
                continue
            w.score = score
            w.last_seen = now
            if thesis:
                w.thesis = thesis
            if score >= entry:
                w.last_high = now
        elif score >= entry:                       # nueva que puntúa alto → entra
            w = Watchlist(ticker=ticker, score=score, thesis=thesis or "",
                          first_seen=now, last_seen=now, last_high=now)
            db.add(w)
            existing[ticker] = w

    db.flush()  # asigna PK a las nuevas para poder borrarlas si caducan o sobran

    # Caducidad: no ha vuelto a puntuar alto en N días.
    stale_before = now - timedelta(days=settings.watchlist_stale_days)
    for w in list(existing.values()):
        if _aware(w.last_high) < stale_before:
            db.delete(w)
            existing.pop(w.ticker, None)

    # Tope de tamaño: si sobra, caen las de menor score (protege la exploración random).
    if len(existing) > settings.watchlist_max:
        extra = sorted(existing.values(), key=lambda x: x.score, reverse=True)[settings.watchlist_max:]
        for w in extra:
            db.delete(w)

    db.commit()
