"""Un ticker apagado (`momentum_universo_estado.mantener=false`) desaparece de las alertas
activas y de los recuentos, pero sus señales se siguen guardando y siguen en el histórico
para poder ver si mejora y reactivarlo."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.momentum.routes import alertas, historial

_DDL = [
    """create table momentum_senales (
        id integer primary key autoincrement, ticker text, sector text, tipo text,
        entry_date date, entry_price numeric, ref_label text, ref_price numeric,
        caida_pct numeric, resuelta boolean, exit_date date, ret numeric, motivo text,
        dias integer, estado text, gate_resultado text, gate_detalle text,
        created_at timestamp, ath numeric, desde_noticias date)""",
    "create table momentum_universo_estado (ticker text primary key, mantener boolean)",
]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    s = sessionmaker(bind=engine)()
    for ddl in _DDL:
        s.execute(text(ddl))
    hoy = date.today()
    for tk, resuelta, estado in [
        ("AAA", False, "nueva"),   # alerta activa normal
        ("BBB", False, "nueva"),   # se apagará -> sale de alertas
        ("BBB", True, "nueva"),    # resuelta de BBB -> se queda en histórico
    ]:
        s.execute(text("""
            insert into momentum_senales (ticker, tipo, entry_date, entry_price, ret,
                resuelta, estado, motivo)
            values (:t, 'suelo', :d, 10, :ret, :r, :e, :m)
        """), {"t": tk, "d": hoy - timedelta(days=3), "ret": 12 if resuelta else 4,
               "r": resuelta, "e": estado, "m": "objetivo" if resuelta else None})
    s.commit()
    yield s
    s.close()


def _apagar(db, ticker: str, apagado: bool) -> None:
    db.execute(text("delete from momentum_universo_estado where ticker = :t"), {"t": ticker})
    db.execute(text("insert into momentum_universo_estado (ticker, mantener) values (:t, :m)"),
               {"t": ticker, "m": not apagado})
    db.commit()


def test_activo_sale_en_alertas(db) -> None:
    tickers = {a["ticker"] for a in alertas(db)}
    assert tickers == {"AAA", "BBB"}


def test_apagado_sale_de_alertas_pero_no_del_historial(db) -> None:
    _apagar(db, "BBB", True)

    assert {a["ticker"] for a in alertas(db)} == {"AAA"}

    hist = historial(db)
    bbb = [h for h in hist if h["ticker"] == "BBB"]
    assert bbb, "la resuelta de BBB debe seguir en el histórico aunque esté apagado"
    assert bbb[0]["mantener"] is False


def test_reactivar_lo_devuelve_a_alertas(db) -> None:
    _apagar(db, "BBB", True)
    assert {a["ticker"] for a in alertas(db)} == {"AAA"}

    _apagar(db, "BBB", False)
    assert {a["ticker"] for a in alertas(db)} == {"AAA", "BBB"}
