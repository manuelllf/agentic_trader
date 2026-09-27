"""Curva histórica: replay del libro a cierres diarios, índice TWR (los flujos no cuentan
como rentabilidad) y doble nivel del endpoint /history (real sin sesión pierde el equity)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import (
    history,
    models,  # noqa: F401  (registra las tablas)
    precios,
)
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_REAL, Allocation, EquitySnapshot, PrecioCierre, Trade
from app.precios import Cierre

D6, D7, D8 = date(2026, 7, 6), date(2026, 7, 7), date(2026, 7, 8)

# Cierres deterministas: AAA sube 50→55→60; SPY 500→505→500 (para el índice del benchmark).
CLOSES = {
    "AAA": {D6: 50.0, D7: 55.0, D8: 60.0},
    "SPY": {D6: 500.0, D7: 505.0, D8: 500.0},
}


def _descarga(dividendos: dict[str, dict[date, float]] | None = None):  # noqa: ANN202
    """Sustituto de Yahoo: los cierres de `CLOSES` con los dividendos que se pidan."""
    def descargar(tickers, desde):  # noqa: ANN001, ANN202
        divs = dividendos or {}
        return {t: [Cierre(d, px, divs.get(t, {}).get(d, 0.0))
                    for d, px in sorted(CLOSES[t].items()) if d >= desde]
                for t in tickers if t in CLOSES}
    return descargar


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


def _seed_book(db, monkeypatch, book: str = "shadow", dividendos=None) -> None:  # noqa: ANN001
    monkeypatch.setattr(precios, "descargar", _descarga(dividendos))
    ledger.allocate(db, 1000, book=book)
    ledger.record_buy(db, "AAA", 10, 50, "seed", book=book)   # caja 500 + 10 acciones
    _backdate(db, D6)


def test_record_replays_ledger_at_daily_closes(db, monkeypatch) -> None:
    _seed_book(db, monkeypatch)

    n = history.record_snapshots(db, books=("shadow",))

    assert n == 3
    rows = db.query(EquitySnapshot).order_by(EquitySnapshot.day).all()
    assert [str(r.equity) for r in rows] == ["1000.00", "1050.00", "1100.00"]
    spy = db.query(PrecioCierre).filter_by(ticker="SPY").order_by(PrecioCierre.dia).all()
    assert [float(p.cierre) for p in spy] == [500.0, 505.0, 500.0]   # el S&P vive en precio_cierre


def test_los_dividendos_entran_en_la_caja_y_en_la_curva(db, monkeypatch) -> None:
    """AAA paga 1 $ con fecha ex el día 8: el sombra tenía 10 acciones al cierre del 7 y cobra
    10 $ brutos. El S&P también cuenta el suyo (2 $ el día 8)."""
    _seed_book(db, monkeypatch, dividendos={"AAA": {D8: 1.0}, "SPY": {D8: 2.0}})

    history.record_snapshots(db, books=("shadow",))

    rows = db.query(EquitySnapshot).order_by(EquitySnapshot.day).all()
    assert [str(r.equity) for r in rows] == ["1000.00", "1050.00", "1110.00"]
    assert ledger.available_cash(db) == Decimal("510.00")
    pts = history.series(db, "shadow")["series"]
    assert pts[-1]["index"] == 111.0
    assert pts[-1]["spy_index"] == 100.4                     # (500 + 2) / 500


def test_el_libro_real_cobra_neto_de_retencion(db, monkeypatch) -> None:
    """Dinero de verdad: el 15 % de retención de EE. UU. no llega nunca a la caja."""
    _seed_book(db, monkeypatch, book=BOOK_REAL, dividendos={"AAA": {D8: 1.0}, "SPY": {D8: 2.0}})

    history.record_snapshots(db, books=(BOOK_REAL,))

    assert ledger.available_cash(db, BOOK_REAL) == Decimal("508.50")
    pts = history.series(db, BOOK_REAL)["series"]
    assert pts[-1]["equity"] == "1108.50"
    assert pts[-1]["spy_index"] == 100.34                    # (500 + 2 × 0,85) / 500


def test_comprar_el_dia_ex_no_cobra(db, monkeypatch) -> None:
    """Cobra quien tenía la acción al cierre anterior a la fecha ex, no quien compra ese día."""
    monkeypatch.setattr(precios, "descargar", _descarga({"AAA": {D6: 1.0}}))
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "AAA", 10, 50, "seed")
    _backdate(db, D6)                                          # compra el mismo día ex

    history.record_snapshots(db, books=("shadow",))

    assert ledger.available_cash(db) == Decimal("500.00")


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


def test_rentabilidad_total_encadena_la_curva_y_el_tramo_vivo(db, monkeypatch) -> None:
    """Cierres hasta ayer (+10%) × hoy a precio vivo (1100 → 1210 = +10%) = +21%; una
    aportación de hoy no cuenta como rentabilidad. S&P: 100 × 510/500 = +2%."""
    _seed_book(db, monkeypatch)
    history.record_snapshots(db, books=("shadow",))
    d9 = date(2026, 7, 9)
    ledger.allocate(db, 300)
    _backdate(db, d9)

    # Hoy: caja 500 + 300 aportados + 10 AAA a 71 = 1510.
    ret, spy = history.rentabilidad_total(db, "shadow", {"AAA": 71.0}, 510.0, hoy=d9)

    assert (ret, spy) == (21.0, 2.0)


def test_rentabilidad_total_no_cuenta_el_cierre_de_hoy(db, monkeypatch) -> None:
    """El snapshot del día en curso se reescribe al cierre: el tramo vivo sale del de ayer."""
    _seed_book(db, monkeypatch)
    history.record_snapshots(db, books=("shadow",))

    ret, _ = history.rentabilidad_total(db, "shadow", {"AAA": 60.0}, 500.0, hoy=D8)

    assert ret == 10.0     # 105 (cierre del 7) × 1100/1050


def test_rentabilidad_total_sin_cierres_es_none(db) -> None:
    assert history.rentabilidad_total(db, "shadow", {}, 500.0) == (None, None)


def test_no_trades_no_curve(db, monkeypatch) -> None:
    """Sin primera compra no hay curva (aunque haya caja asignada), igual que /performance."""
    monkeypatch.setattr(precios, "descargar", _descarga())
    ledger.allocate(db, 1000, book=BOOK_REAL)
    assert history.record_snapshots(db, books=(BOOK_REAL,)) == 0
    assert history.series(db, BOOK_REAL)["series"] == []
