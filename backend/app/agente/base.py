"""Base de datos propia del agente (SQLAlchemy 2.0), independiente de la de Vennett."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from functools import cache

from sqlalchemy import MetaData, create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.agente.config import ajustes

# Quien toca las filas; lo lee `agente.actor()` en la base.
_actor: ContextVar[str] = ContextVar("agente_actor", default="agente")


class Base(DeclarativeBase):
    """Base declarativa del agente; nunca se mezcla con la de Vennett."""

    metadata = MetaData(schema="agente")


@cache
def motor() -> Engine:
    """Motor perezoso: no se conecta ni se crea hasta el primer uso."""
    url = ajustes.database_url
    if not url:
        raise ValueError("Falta AGENTE_DATABASE_URL: la base del agente no está configurada")
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return create_engine(url, pool_pre_ping=True, pool_size=3, max_overflow=2)


@contextmanager
def con_actor(nombre: str) -> Iterator[None]:
    token = _actor.set(nombre)
    try:
        yield
    finally:
        _actor.reset(token)


@contextmanager
def sesion() -> Iterator[Session]:
    """Sesión con commit al salir, o rollback si algo falla."""
    s = Session(motor(), autoflush=False, expire_on_commit=False, info={"agente": True})
    try:
        yield s
        s.commit()
    except BaseException:
        s.rollback()
        raise
    finally:
        s.close()


@event.listens_for(Session, "after_begin")
def _marcar_actor(session, transaction, connection) -> None:  # noqa: ANN001, ARG001
    """Solo en sesiones del agente: deja `agente.actor` en la transacción."""
    if not session.info.get("agente"):
        return
    connection.execute(text("select set_config('agente.actor', :a, true)"), {"a": _actor.get()})
