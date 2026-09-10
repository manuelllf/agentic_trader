"""Config de LLM por etapa PERSISTIDA para el escaneo con decisión (`app.scan_config`).

Cubre: el saneado (solo etapas/campos conocidos), el round-trip por endpoint, el borrado que
vuelve a producción, y que el cron (`scheduler._scan_job`) le pasa lo guardado a
`run_scan_and_store`.
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, scan_config
from app import models  # noqa: F401  (registra las tablas)
from app.api.routes import public_router, router
from app.db import Base, get_db

PASSWORD = "clave-test-decide-cfg"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setattr(auth.settings, "app_password", PASSWORD)
    app = FastAPI()
    app.include_router(public_router)
    app.include_router(router, dependencies=[Depends(auth.require_auth)])
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def headers(client) -> dict:
    return {"Authorization": f"Bearer {auth.login(PASSWORD)}"}


# ---- saneado ---------------------------------------------------------------

def test_sanear_descarta_etapas_y_campos_desconocidos() -> None:
    crudo = {
        "deep": {"model": "deepseek-flash", "reasoning_effort": "high", "basura": 1},
        "otra_etapa": {"model": "x"},
        "macro": {"temperature": None},          # None se cae
        "constructor": {},                        # vacío -> no aparece
    }
    assert scan_config._sanear(crudo) == {
        "deep": {"model": "deepseek-flash", "reasoning_effort": "high"},
    }


def test_sanear_no_dict() -> None:
    assert scan_config._sanear(["deep"]) == {}
    assert scan_config._sanear(None) == {}


# ---- persistencia directa ------------------------------------------------------

def test_set_get_borrado(db) -> None:
    assert scan_config.get_decide_overrides(db) is None

    guardado = scan_config.set_decide_overrides(db, {"mid": {"model": "deepseek-flash"}})
    assert guardado == {"mid": {"model": "deepseek-flash"}}
    assert scan_config.get_decide_overrides(db) == {"mid": {"model": "deepseek-flash"}}

    # un override que queda vacío tras sanear borra la clave (vuelve a producción)
    assert scan_config.set_decide_overrides(db, {"mid": {}}) == {}
    assert scan_config.get_decide_overrides(db) is None


def test_get_ignora_json_roto(db) -> None:
    from app.models import Meta
    db.add(Meta(key="scan_decide_llm_overrides", value="{no es json"))
    db.commit()
    assert scan_config.get_decide_overrides(db) is None


# ---- endpoints ---------------------------------------------------------------

def test_endpoint_round_trip(client, headers) -> None:
    assert client.get("/scan/decide-config", headers=headers).json() == {"overrides": {}}

    r = client.put("/scan/decide-config", headers=headers, json={"overrides": {
        "deep": {"model": "deepseek-flash", "reasoning_effort": "high"},
        "constructor": {"temperature": 0.2},
    }})
    assert r.status_code == 200
    assert r.json()["overrides"] == {
        "deep": {"model": "deepseek-flash", "reasoning_effort": "high"},
        "constructor": {"temperature": 0.2},
    }
    assert client.get("/scan/decide-config", headers=headers).json()["overrides"]["deep"]["model"] \
        == "deepseek-flash"

    # cuerpo vacío -> borra
    assert client.put("/scan/decide-config", headers=headers,
                      json={"overrides": {}}).json() == {"overrides": {}}
    assert client.get("/scan/decide-config", headers=headers).json() == {"overrides": {}}


def test_endpoint_exige_token(client) -> None:
    assert client.get("/scan/decide-config").status_code == 401
    assert client.put("/scan/decide-config", json={"overrides": {}}).status_code == 401


# ---- el cron usa lo guardado ------------------------------------------------

def test_scan_job_pasa_overrides_guardados(db, monkeypatch) -> None:
    from app import scheduler

    scan_config.set_decide_overrides(db, {"deep": {"model": "deepseek-flash"}})

    capturado = {}
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: db)

    def _fake_run(session, **kw):
        capturado.update(kw)
        return {"ok": True}

    monkeypatch.setattr(scheduler, "run_scan_and_store", _fake_run)
    scheduler._scan_job()

    assert capturado["decide"] is True
    assert capturado["llm_overrides"] == {"deep": {"model": "deepseek-flash"}}
