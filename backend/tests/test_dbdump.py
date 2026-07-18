"""Volcado literal de la DB: export → import reemplaza todo, es atómico y rechaza basura.

Usa una BD SQLite en memoria (StaticPool) para no tocar jamás la base local real.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import (
    dbdump,
    models,  # noqa: F401  (registra las tablas)
)
from app.db import Base
from app.ledger import service as ledger


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _seed(db) -> None:
    ledger.allocate(db, 1000.0, "test")
    db.commit()


def test_export_import_roundtrip(db) -> None:
    _seed(db)
    snap = dbdump.export_all(db.connection())
    assert snap["version"] == 1
    assert len(snap["tables"]["allocations"]) >= 1

    out = dbdump.import_all(db.connection(), snap)   # reimporta el MISMO snapshot
    db.commit()
    assert out["ok"] is True
    assert dbdump.export_all(db.connection())["tables"]["allocations"] == snap["tables"]["allocations"]


def test_import_replaces_everything(db) -> None:
    _seed(db)
    snap = dbdump.export_all(db.connection())        # foto con 1 allocation
    ledger.allocate(db, 500.0, "extra")              # ahora hay 2
    db.commit()
    assert len(dbdump.export_all(db.connection())["tables"]["allocations"]) == 2

    dbdump.import_all(db.connection(), snap)          # volver a la foto de 1
    db.commit()
    assert len(dbdump.export_all(db.connection())["tables"]["allocations"]) == 1


def test_import_rejects_empty(db) -> None:
    _seed(db)
    before = len(dbdump.export_all(db.connection())["tables"]["allocations"])
    with pytest.raises(ValueError):
        dbdump.import_all(db.connection(), {"version": 1, "tables": {}})
    assert len(dbdump.export_all(db.connection())["tables"]["allocations"]) == before


# ---- blindaje: la validación corre ANTES de cualquier DELETE -----------------

def test_columna_desconocida_rechazada_sin_tocar_la_db(db) -> None:
    """Columna que no existe en el esquema → ValueError y la DB queda intacta SIN depender
    del rollback del caller (la validación va antes que el borrado)."""
    _seed(db)
    snap = {"version": 1, "tables": {"allocations": [{"columna_fantasma": 1}]}}
    with pytest.raises(ValueError, match="columna desconocida"):
        dbdump.import_all(db.connection(), snap)
    # SIN rollback: si el import hubiera borrado antes de validar, aquí no habría nada.
    assert len(dbdump.export_all(db.connection())["tables"]["allocations"]) == 1


def test_valor_no_escalar_rechazado(db) -> None:
    _seed(db)
    snap = {"version": 1, "tables": {"allocations": [{"note": {"un": "dict"}}]}}
    with pytest.raises(ValueError, match="no escalar"):
        dbdump.import_all(db.connection(), snap)
    assert len(dbdump.export_all(db.connection())["tables"]["allocations"]) == 1


def test_flotante_no_finito_rechazado(db) -> None:
    _seed(db)
    snap = {"version": 1, "tables": {"allocations": [{"amount": float("inf")}]}}
    with pytest.raises(ValueError, match="no finito"):
        dbdump.import_all(db.connection(), snap)


def test_snapshot_gigante_rechazado(db, monkeypatch) -> None:
    monkeypatch.setattr(dbdump, "_MAX_ROWS_TOTAL", 2)
    filas = [{"note": f"fila {i}"} for i in range(3)]
    with pytest.raises(ValueError, match="demasiado grande"):
        dbdump.import_all(db.connection(), {"version": 1, "tables": {"allocations": filas}})


def test_roundtrip_sigue_intacto_con_validacion(db) -> None:
    """El export real (dinero como TEXT vía DecimalStr, fechas como cadena) debe seguir
    pasando la validación tal cual — la REGLA: estructura sí, tipos de valores no."""
    _seed(db)
    snap = dbdump.export_all(db.connection())
    out = dbdump.import_all(db.connection(), snap)
    db.commit()
    assert out["ok"] is True
