"""Universo global: un CSV idéntico a la última tanda no guarda otra copia (eran 25 MB al mes)."""

from __future__ import annotations

import time

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.models import UniverseTicker
from app.screener import universe_global

_CABECERA = "ticker,exchange,name,asset_type,stock_sector,country,country_code,isin\n"
_BASE = (
    "AAA,NASDAQ,Alfa Inc,Stock,Technology,United States,US,US0000000001\n"
    "BBB,NYSE,Beta Corp,Stock,Energy,United States,US,US0000000002\n"
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _tandas(db) -> int:  # noqa: ANN001
    return db.query(func.count(func.distinct(UniverseTicker.synced_at))).scalar()


def test_la_misma_tanda_no_se_guarda_dos_veces(db):
    primera = universe_global.sincronizar_desde_archivo(db, (_CABECERA + _BASE).encode())
    assert primera["sin_cambios"] is False and primera["tickers"] == 2

    segunda = universe_global.sincronizar_desde_archivo(db, (_CABECERA + _BASE).encode())
    assert segunda["sin_cambios"] is True
    assert segunda["synced_at"] == primera["synced_at"]
    assert _tandas(db) == 1
    assert db.query(UniverseTicker).count() == 2


def test_un_cambio_real_si_crea_tanda_nueva(db):
    universe_global.sincronizar_desde_archivo(db, (_CABECERA + _BASE).encode())
    # El reloj de Windows tiene ~16 ms de resolución: sin esta pausa,
    # dos tandas caen en el mismo instante y se cuentan como una.
    time.sleep(0.02)
    cambiado = _BASE.replace("Beta Corp", "Beta Holdings")
    out = universe_global.sincronizar_desde_archivo(db, (_CABECERA + cambiado).encode())
    assert out["sin_cambios"] is False
    assert _tandas(db) == 2
    ultimo = universe_global.ultimo_sync(db)
    nombres = {n for (n,) in db.query(UniverseTicker.name)
               .filter(UniverseTicker.synced_at == ultimo).all()}
    assert nombres == {"Alfa Inc", "Beta Holdings"}


def test_ticker_repetido_en_el_csv_cuenta_una_vez(db):
    repetido = _BASE + "AAA,NASDAQ,Otra Alfa,Stock,Technology,United States,US,US0000000009\n"
    out = universe_global.sincronizar_desde_archivo(db, (_CABECERA + repetido).encode())
    assert out["tickers"] == 2
    nombre = db.query(UniverseTicker.name).filter(UniverseTicker.ticker == "AAA").scalar()
    assert nombre == "Alfa Inc"
