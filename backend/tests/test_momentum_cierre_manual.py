"""Una señal que cerraste a mano enseña TU resultado aunque el job diario la resuelva después; lo
que habría hecho el algoritmo va aparte, aplicado a tu coste medio (caso real: HQ, 15-sep)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.momentum.routes import historial
from tests.test_momentum_universo_apagado import _DDL


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    s = sessionmaker(bind=engine)()
    for ddl in _DDL:
        s.execute(text(ddl))
    yield s
    s.close()


def _senal(db, *, resuelta: bool, ret: float | None) -> int:
    db.execute(text("""
        insert into momentum_senales (ticker, tipo, entry_date, entry_price, ret, resuelta,
            estado, motivo)
        values ('HQ', 'zigzag', :d, 10.675, :ret, :r, 'vendida', :m)
    """), {"d": date(2026, 9, 14), "ret": ret, "r": resuelta, "m": "objetivo" if resuelta else None})
    sid = db.execute(text("select max(id) from momentum_senales")).scalar()
    for accion, n, precio, com in (("compra", 95, 10.35, 0.24), ("compra", 3, 10.35, 0),
                                   ("venta", 98, 13, 0.71)):
        db.execute(text("""
            insert into momentum_ejecuciones (senal_id, accion, acciones, precio, comision,
                ejecutada_at)
            values (:s, :a, :n, :p, :c, '2026-09-15 20:26:00')
        """), {"s": sid, "a": accion, "n": n, "p": precio, "c": com})
    db.commit()
    return sid


def test_resuelta_despues_sigue_mandando_tu_cierre(db) -> None:
    _senal(db, resuelta=True, ret=46.9052)
    (s,) = historial(db)
    cierre = s["cierre_manual"]
    assert float(cierre["ret"]) == pytest.approx(25.5, abs=0.1)          # lo que hiciste tú
    # Salida del algoritmo 10.675 × 1.469 = 15.68 sobre tu coste medio 10.352 → +51.5%.
    assert float(cierre["ret_sistema"]) == pytest.approx(51.5, abs=0.1)
    assert cierre["exit_date"] == "2026-09-15"


def test_sin_resolver_no_hay_resultado_del_sistema(db) -> None:
    _senal(db, resuelta=False, ret=None)
    (s,) = historial(db)
    assert float(s["cierre_manual"]["ret"]) == pytest.approx(25.5, abs=0.1)
    assert s["cierre_manual"]["ret_sistema"] is None
