"""`universe_global.top_market_cap_usd()`: dedupe por ticker, allow-list de IBKR, orden por
market_cap_usd, límite -- el candidate-list del scan "top market cap global" del modal rojo."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import FundamentalsSnapshot, IbkrExchange, UniverseTicker
from app.screener import universe_global


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _universo(db, sync_at, filas):  # noqa: ANN001
    for ticker, exchange in filas:
        db.add(UniverseTicker(synced_at=sync_at, source="test", ticker=ticker,
                              yahoo_symbol=ticker, exchange=exchange, asset_type="Stock"))
    db.commit()


def _foto(db, ticker, market_cap_usd, captured_at, es_dataset=True):  # noqa: ANN001
    db.add(FundamentalsSnapshot(ticker=ticker, sector="Technology", industry="Software",
                                name=ticker, price=10.0, market_cap=market_cap_usd,
                                market_cap_usd=market_cap_usd, currency="USD",
                                captured_at=captured_at, es_dataset=es_dataset))
    db.commit()


def test_ordena_por_market_cap_usd_desc(db):
    sync_at = datetime.now(UTC)
    _universo(db, sync_at, [("AAA", "NASDAQ"), ("BBB", "NASDAQ")])
    db.add(IbkrExchange(exchange="NASDAQ", name="Nasdaq"))
    db.commit()
    _foto(db, "AAA", 1e9, sync_at)
    _foto(db, "BBB", 5e9, sync_at)

    assert universe_global.top_market_cap_usd(db) == [("BBB", "BBB"), ("AAA", "AAA")]


def test_excluye_exchange_fuera_del_allow_list(db):
    sync_at = datetime.now(UTC)
    _universo(db, sync_at, [("AAA", "NASDAQ"), ("ZZZ", "HOSE")])
    db.add(IbkrExchange(exchange="NASDAQ", name="Nasdaq"))
    db.commit()
    _foto(db, "AAA", 1e9, sync_at)
    _foto(db, "ZZZ", 9e9, sync_at)   # market cap mayor, pero HOSE no está en el allow-list

    assert universe_global.top_market_cap_usd(db) == [("AAA", "AAA")]


def test_se_queda_con_la_foto_mas_reciente_por_ticker(db):
    sync_at = datetime.now(UTC)
    _universo(db, sync_at, [("AAA", "NASDAQ")])
    db.add(IbkrExchange(exchange="NASDAQ", name="Nasdaq"))
    db.commit()
    _foto(db, "AAA", 1e9, sync_at - timedelta(days=2))
    _foto(db, "AAA", 3e9, sync_at)   # la última gana, aunque la vieja tuviera otro valor

    resultado = universe_global.top_market_cap_usd(db)
    assert resultado == [("AAA", "AAA")]


def test_sin_market_cap_usd_no_entra(db):
    sync_at = datetime.now(UTC)
    _universo(db, sync_at, [("AAA", "NASDAQ")])
    db.add(IbkrExchange(exchange="NASDAQ", name="Nasdaq"))
    db.add(FundamentalsSnapshot(ticker="AAA", sector="Technology", industry="Software",
                                name="AAA", price=10.0, market_cap=1e9, market_cap_usd=None,
                                currency="KRW", captured_at=sync_at, es_dataset=True))
    db.commit()

    assert universe_global.top_market_cap_usd(db) == []


def test_respeta_el_limite(db):
    sync_at = datetime.now(UTC)
    _universo(db, sync_at, [("AAA", "NASDAQ"), ("BBB", "NASDAQ"), ("CCC", "NASDAQ")])
    db.add(IbkrExchange(exchange="NASDAQ", name="Nasdaq"))
    db.commit()
    _foto(db, "AAA", 1e9, sync_at)
    _foto(db, "BBB", 2e9, sync_at)
    _foto(db, "CCC", 3e9, sync_at)

    assert universe_global.top_market_cap_usd(db, limite=2) == [("CCC", "CCC"), ("BBB", "BBB")]
