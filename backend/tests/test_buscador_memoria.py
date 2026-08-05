"""Tests de `/memory/search`: protegido entero, tolerante a memoria no disponible, y con el
reparto ticker/semántico que hace el endpoint sobre un store simulado (sin cargar fastembed)."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import (
    auth,
    models,  # noqa: F401  (registra las tablas)
)
from app.api.routes import public_router, router
from app.db import Base, get_db

PASSWORD = "clave-test-memoria-1"


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
def token(client) -> str:
    return auth.login(PASSWORD)


def test_memory_search_sin_token_da_401(client) -> None:
    assert client.get("/memory/search?q=AAA").status_code == 401


def test_memory_search_sin_memoria_disponible(client, token, monkeypatch) -> None:
    """`get_store()` devuelve None (deps opcionales ausentes) → 200 con items vacíos, no 500."""
    from app import memory

    monkeypatch.setattr(memory, "get_store", lambda: None)
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/memory/search?q=AAA", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "vacio"
    assert body["items"] == []
    assert "error" in body


@dataclass
class _FakeMemory:
    id: int
    kind: str
    ticker: str
    text: str
    distance: float | None = None
    created_at: str = "2026-08-01T00:00:00"
    # Mismo campo que `Memory` (app.memory.store): por defecto None, solo se rellena tras
    # deduplicar por ticker. `_memory_out` lo lee sin `getattr`, así que el doble de test debe
    # tener el atributo aunque no lo use.
    n_tesis: int | None = None


class _FakeStore:
    def history_for(self, ticker: str, limit: int = 20) -> list[_FakeMemory]:
        if ticker == "AAA":
            return [_FakeMemory(1, "thesis", "AAA", "tesis AAA reciente"),
                    _FakeMemory(2, "thesis", "AAA", "tesis AAA vieja")]
        return []

    def search(self, query: str, k: int = 10) -> list[_FakeMemory]:
        return [_FakeMemory(3, "thesis", "BBB", f"parecido a: {query}", distance=0.12)]


def test_memory_search_modo_ticker_con_historia(client, token, monkeypatch) -> None:
    from app import memory

    monkeypatch.setattr(memory, "get_store", lambda: _FakeStore())
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/memory/search?q=AAA", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "ticker"
    assert [i["text"] for i in body["items"]] == ["tesis AAA reciente", "tesis AAA vieja"]


def test_memory_search_modo_semantico_texto_libre(client, token, monkeypatch) -> None:
    from app import memory

    monkeypatch.setattr(memory, "get_store", lambda: _FakeStore())
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/memory/search?q=momentum+en+small+caps", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "semantic"
    assert body["items"][0]["ticker"] == "BBB"
    assert body["items"][0]["distance"] == 0.12


def test_memory_search_ticker_sin_historia_cae_a_semantico(client, token, monkeypatch) -> None:
    """Parece ticker pero `history_for` no devuelve nada → busca semántico igualmente."""
    from app import memory

    monkeypatch.setattr(memory, "get_store", lambda: _FakeStore())
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/memory/search?q=ZZZ", headers=headers)
    assert res.status_code == 200
    assert res.json()["mode"] == "semantic"
