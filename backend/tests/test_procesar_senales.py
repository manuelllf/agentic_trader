"""`scheduler.procesar_señales`: una señal nueva SIN resolver llega de `compute_signals()` con
`ret`/`motivo`/`dias` a NaN (float, vía DataFrame). SQLite lo traga; Postgres NO -- `dias` es
integer y el escaneo entero revienta con un error de SQL en la cara del usuario. Debe insertarse
con esos campos a NULL.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.scheduler import procesar_señales

_DDL = """create table momentum_senales (
    id integer primary key autoincrement, ticker text, sector text, tipo text,
    entry_date date, entry_price numeric, ref_label text, ref_price numeric,
    caida_pct numeric, resuelta boolean, exit_date date, ret numeric, motivo text,
    dias integer, estado text, gate_resultado text, gate_detalle text,
    created_at timestamp, ath numeric, desde_noticias date,
    unique (ticker, tipo, entry_date))"""


@pytest.fixture(autouse=True)
def _sin_push(monkeypatch):
    # `procesar_señales` avisa por push cuando hay señales nuevas; en el test no hay tabla
    # `push_subscriptions` ni interesa la notificación.
    monkeypatch.setattr("app.push.send_to_all", lambda *a, **kw: None)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    s = sessionmaker(bind=engine)()
    s.execute(text(_DDL))
    s.execute(text("create table momentum_universo_estado (ticker text primary key, mantener boolean)"))
    s.commit()
    yield s
    s.close()


def _senal_sin_resolver(ticker: str = "NEW") -> dict:
    hoy = pd.Timestamp(date.today())
    return {
        "ticker": ticker, "sector": "Space", "tipo": "suelo",
        "entry_date": hoy, "entry_price": 15.24, "ref_label": "ATH_referencia",
        "ref_price": 56.34, "caida_pct": 72.9, "ath": 56.34,
        "desde_noticias": hoy - pd.Timedelta(days=20),
        "resuelta": False,
        "exit_date": pd.NaT, "ret": float("nan"), "motivo": float("nan"), "dias": float("nan"),
    }


def test_senal_sin_resolver_se_inserta_con_ret_y_dias_nulos(db) -> None:
    res = procesar_señales(db, [_senal_sin_resolver()])
    assert res["nuevas"] == 1

    fila = db.execute(text(
        "select ret, motivo, dias, exit_date, resuelta from momentum_senales where ticker='NEW'"
    )).mappings().one()
    assert fila["ret"] is None
    assert fila["motivo"] is None
    assert fila["dias"] is None
    assert fila["exit_date"] is None
    assert not fila["resuelta"]


def test_ningun_parametro_bindeado_es_nan(db, monkeypatch) -> None:
    """Red de seguridad directa contra el bug de Postgres: ni un solo valor NaN puede salir
    en los parámetros de un INSERT/UPDATE (Postgres los rechaza en columnas numeric/integer)."""
    real = db.execute
    vistos: list = []

    def _espia(clause, params=None, *a, **kw):
        if params:
            vals = params.values() if isinstance(params, dict) else []
            vistos.extend(v for v in vals if isinstance(v, float) and pd.isna(v))
        return real(clause, params, *a, **kw)

    monkeypatch.setattr(db, "execute", _espia)
    procesar_señales(db, [_senal_sin_resolver("AAA"), _senal_sin_resolver("BBB")])
    assert vistos == [], f"llegaron NaN a un parámetro SQL: {vistos}"


def test_reactivar_devuelve_una_VETADA_POR_GATE_a_nueva(db) -> None:
    hoy = date.today()
    db.execute(text("""
        insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, ref_label,
            ref_price, caida_pct, resuelta, estado, gate_resultado, gate_detalle)
        values ('RKLB','Space','suelo',:d,63,'ATH_referencia',150,58,false,'descartada','falla','roto')
    """), {"d": hoy - timedelta(days=30)})
    db.commit()

    s = _senal_sin_resolver("RKLB")
    s.update(entry_date=pd.Timestamp(hoy - timedelta(days=30)), entry_price=63.0, reactivar=True)
    res = procesar_señales(db, [s])
    assert res["reactivadas"] == 1

    fila = db.execute(text(
        "select estado, gate_resultado, gate_detalle from momentum_senales where ticker='RKLB'"
    )).mappings().one()
    assert fila["estado"] == "nueva"
    assert fila["gate_resultado"] is None
    assert fila["gate_detalle"] == ""


def test_reactivar_NO_toca_un_descarte_a_mano(db) -> None:
    # gate_resultado NULL = descartada a mano por Manuel. Aunque el precio vuelva a la banda,
    # su decisión se respeta hasta que la señal se resuelva.
    hoy = date.today()
    db.execute(text("""
        insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, ref_label,
            ref_price, caida_pct, resuelta, estado)
        values ('PL','Space','suelo',:d,22,'ATH_referencia',51,57,false,'descartada')
    """), {"d": hoy - timedelta(days=20)})
    db.commit()

    s = _senal_sin_resolver("PL")
    s.update(entry_date=pd.Timestamp(hoy - timedelta(days=20)), entry_price=22.0, reactivar=True)
    res = procesar_señales(db, [s])
    assert res["reactivadas"] == 0
    assert db.execute(text("select estado from momentum_senales where ticker='PL'")).scalar() == "descartada"


def test_reactivar_no_toca_una_ya_nueva_ni_una_resuelta(db) -> None:
    hoy = date.today()
    db.execute(text("""
        insert into momentum_senales (ticker, sector, tipo, entry_date, entry_price, ref_label,
            ref_price, caida_pct, resuelta, estado)
        values ('AAA','S','suelo',:d,10,'ATH_referencia',30,66,true,'nueva'),
               ('BBB','S','suelo',:d,10,'ATH_referencia',30,66,false,'nueva')
    """), {"d": hoy - timedelta(days=20)})
    db.commit()
    for tk in ("AAA", "BBB"):
        s = _senal_sin_resolver(tk)
        s.update(entry_date=pd.Timestamp(hoy - timedelta(days=20)), entry_price=10.0, reactivar=True)
        procesar_señales(db, [s])
    estados = dict(db.execute(text("select ticker, estado from momentum_senales")).all())
    assert estados == {"AAA": "nueva", "BBB": "nueva"}   # ninguna cambió por reactivar


def test_senal_resuelta_conserva_ret_y_dias(db) -> None:
    """La normalización no debe pisar los valores buenos de una señal ya resuelta."""
    s = _senal_sin_resolver("RES")
    s.update(resuelta=True, ret=27.3, motivo="objetivo", dias=26.0,
             exit_date=pd.Timestamp(date.today()))
    procesar_señales(db, [s])
    fila = db.execute(text(
        "select ret, motivo, dias from momentum_senales where ticker='RES'"
    )).mappings().one()
    assert fila["ret"] == 27.3
    assert fila["motivo"] == "objetivo"
    assert fila["dias"] == 26
