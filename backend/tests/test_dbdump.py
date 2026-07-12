"""Volcado literal de la DB: export → import reemplaza todo, es atómico y rechaza basura.

Usa una BD SQLite en memoria (StaticPool) para no tocar jamás la base local real.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import dbdump
from app import models  # noqa: F401  (registra las tablas)
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
