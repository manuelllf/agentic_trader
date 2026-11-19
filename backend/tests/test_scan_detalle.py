"""Detalle completo del escaneo de Jev: el bloque macro que vio la nota, guardado con el escaneo."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api.routes_scan import scan_full
from app.db import Base


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def test_detalle_del_escaneo_trae_el_macro_completo(db) -> None:
    run = models.ScanRun(cadence="jev/full", decide=True, outlook="VIX 15.3.",
                         macro_wiki_scheduled="Oct 1: FOMC", macro_wiki_events="Sep 20: evento")
    db.add(run)
    db.flush()
    db.add(models.ScanRunMacroHeadline(scan_run_id=run.id, fuente="gnews", posicion=0,
                                       texto="Fed holds"))
    db.commit()

    s = scan_full(None, db)["scan"]
    assert s["macro_calendario"] == "Oct 1: FOMC" and s["macro_eventos"] == "Sep 20: evento"
    assert s["macro_titulares"] == [{"fuente": "gnews", "texto": "Fed holds"}]
    assert s["decide"] is True and s["cadence"] == "jev/full"


def test_detalle_sin_escaneos_es_null(db) -> None:
    assert scan_full(None, db) == {"scan": None}