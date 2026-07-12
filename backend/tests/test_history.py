"""Curva histórica: replay del libro a cierres diarios, índice TWR (los flujos no cuentan
como rentabilidad) y doble nivel del endpoint /history (real sin sesión pierde el equity)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import (
    history,
    models,  # noqa: F401  (registra las tablas)
)
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_REAL, Allocation, EquitySnapshot, Trade

D6, D7, D8 = date(2026, 7, 6), date(2026, 7, 7), date(2026, 7, 8)

# Cierres deterministas: AAA sube 50→55→60; SPY 500→505→500 (para el índice del benchmark).
CLOSES = {
    "AAA": {D6: 50.0, D7: 55.0, D8: 60.0},
    "SPY": {D6: 500.0, D7: 505.0, D8: 500.0},
}


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _backdate(db, day: date) -> None:
    """Mueve todo lo recién escrito a las 15:00 UTC de `day` (11:00 ET, mismo día de mercado)."""
    ts = datetime(day.year, day.month, day.day, 15, 0, tzinfo=UTC)
    for row in db.query(Trade).all() + db.query(Allocation).all():
        if row.created_at.replace(tzinfo=UTC) > ts:
            row.created_at = ts
    db.commit()


def _seed_book(db, monkeypatch) -> None:
    monkeypatch.setattr(history, "_daily_closes", lambda tickers, start: CLOSES)
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 50, "seed")   # caja 500 + 10 acciones
    _backdate(db, D6)


def test_record_replays_ledger_at_daily_closes(db, monkeypatch) -> None:
    _seed_book(db, monkeypatch)

    n = history.record_snapshots(db, books=("shadow",))

    assert n == 3
    rows = db.query(EquitySnapshot).order_by(EquitySnapshot.day).all()
    assert [str(r.equity) for r in rows] == ["1000.00", "1050.00", "1100.00"]
    assert [r.spy_close for r in rows] == [500.0, 505.0, 500.0]


def test_record_is_idempotent_and_heals_gaps(db, monkeypatch) -> None:
    """Correr dos veces no duplica; y si faltan días (backend caído), el siguiente run los crea."""
    _seed_book(db, monkeypatch)
    history.record_snapshots(db, books=("shadow",))
    history.record_snapshots(db, books=("shadow",))
    assert db.query(EquitySnapshot).count() == 3

    # Simula el hueco: se borran los dos últimos días y el siguiente run los reconstruye.
    for r in db.query(EquitySnapshot).filter(EquitySnapshot.day > D6).all():
        db.delete(r)
    db.commit()
    history.record_snapshots(db, books=("shadow",))
    assert db.query(EquitySnapshot).count() == 3


def test_series_index_ignores_flows(db, monkeypatch) -> None:
    """El índice es TWR: una aportación a mitad de curva mueve el equity pero NO la rentabilidad."""
    _seed_book(db, monkeypatch)
    ledger.allocate(db, 500)          # aportación el día 8 (tras +5% del día 7)
    _backdate(db, D8)

    history.record_snapshots(db, books=("shadow",))
    out = history.series(db, "shadow")

    pts = out["series"]
    assert [p["index"] for p in pts] == [100.0, 105.0, 110.0]   # +10% real, la aportación no suma
    assert pts[-1]["equity"] == "1600.00"                        # 1100 + 500 aportados
    assert [p["spy_index"] for p in pts] == [100.0, 101.0, 100.0]


def test_no_trades_no_curve(db, monkeypatch) -> None:
    """Sin primera compra no hay curva (aunque haya caja asignada), igual que /performance."""
    monkeypatch.setattr(history, "_daily_closes", lambda tickers, start: CLOSES)
    ledger.allocate(db, 1000, book=BOOK_REAL)
    assert history.record_snapshots(db, books=(BOOK_REAL,)) == 0
    assert history.series(db, BOOK_REAL)["series"] == []
