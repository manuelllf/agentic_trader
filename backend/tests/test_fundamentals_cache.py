"""Caché de 12h de `fundamentals.gather()` (`FundamentalsCache`)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import FundamentalsCache
from app.screener import fundamentals as fund_mod
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _sample() -> NameData:
    return NameData(
        ticker="AAA", sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=["n1"],
    )


def test_cache_put_y_get_redondo(db) -> None:
    fund_mod._cache_put(db, "AAA", _sample())
    got = fund_mod._cache_get(db, "AAA")
    assert got is not None
    assert got.ticker == "AAA"
    assert got.fundamentals_text == "- P/E: 20"


def test_cache_get_sin_fila_devuelve_none(db) -> None:
    assert fund_mod._cache_get(db, "ZZZ") is None


def test_cache_expira_a_las_12h(db) -> None:
    fund_mod._cache_put(db, "AAA", _sample())
    row = db.get(FundamentalsCache, "AAA")
    row.at = datetime.now(UTC) - timedelta(hours=13)   # forzar caducidad
    db.commit()
    assert fund_mod._cache_get(db, "AAA") is None


def test_gather_usa_la_cache_sin_tocar_yfinance(db, monkeypatch) -> None:
    """Segunda llamada dentro de las 12h no debe tocar yfinance en absoluto."""
    llamadas = {"n": 0}

    class _TickerFalso:
        def __init__(self, ticker):
            llamadas["n"] += 1
            self.info = {"sector": "Technology", "marketCap": 5e9, "shortName": "AAA Inc"}
            self.news = []

        def history(self, **kwargs):
            import pandas as pd
            return pd.DataFrame()

    monkeypatch.setattr(fund_mod.yf, "Ticker", _TickerFalso)

    d1, err1 = fund_mod.gather("AAA", db=db)
    assert d1 is not None and err1 is None
    assert llamadas["n"] == 1

    d2, err2 = fund_mod.gather("AAA", db=db)
    assert d2 is not None and err2 is None
    assert llamadas["n"] == 1     # NO volvió a tocar yfinance, sirvió de caché
