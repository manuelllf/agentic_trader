"""Base de pruebas del agente: una base nueva por sesión de pytest con el esquema aplicado."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.agente import base, datos, interruptor
from app.agente.config import ajustes

# Todas las migraciones en orden, como se aplican en la base real.
_SQL = Path(__file__).resolve().parents[2] / "sql" / "agente"
_MIGRACIONES = sorted(_SQL.glob("[0-9][0-9][0-9]_*.sql"))


def _dsn(url: str) -> str:
    """URL de SQLAlchemy a la cadena que entiende psycopg."""
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


@pytest.fixture(autouse=True)
def _interruptor_cerrado() -> Iterator[None]:
    """El interruptor es uno por proceso: cada prueba empieza y acaba con él cerrado."""
    interruptor.deepseek.exito()
    yield
    interruptor.deepseek.exito()


@pytest.fixture(autouse=True)
def _sin_horario_extendido(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ninguna prueba sale a Yahoo por el horario extendido; las que lo miran pasan su falso."""
    monkeypatch.setattr(datos, "descargar_extendido", lambda tickers, franja, dia: {})


@pytest.fixture(scope="session")
def url_base_agente() -> Iterator[str]:
    admin = os.environ.get("AGENTE_TEST_DATABASE_URL")
    if not admin:
        pytest.skip("Falta AGENTE_TEST_DATABASE_URL")
    nombre = f"agente_test_{uuid.uuid4().hex[:8]}"
    url = make_url(admin).set(database=nombre).render_as_string(hide_password=False)
    with psycopg.connect(_dsn(admin), autocommit=True) as cx:
        cx.execute(f'create database "{nombre}"')
    try:
        with psycopg.connect(_dsn(url), autocommit=True) as cx:
            for migracion in _MIGRACIONES:
                cx.execute(migracion.read_text(encoding="utf-8"))
        yield url
    finally:
        with psycopg.connect(_dsn(admin), autocommit=True) as cx:
            cx.execute(f'drop database if exists "{nombre}" with (force)')


@pytest.fixture
def sesion_agente(url_base_agente: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Sesión sobre la base de prueba; todo se deshace con rollback (las tablas de solo añadir
    no admiten DELETE)."""
    monkeypatch.setattr(ajustes, "database_url", url_base_agente)
    base.motor.cache_clear()
    s = Session(base.motor(), autoflush=False, info={"agente": True})
    try:
        yield s
    finally:
        s.rollback()
        s.close()
        base.motor().dispose()
        base.motor.cache_clear()
