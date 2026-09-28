"""Capa de base de datos (SQLAlchemy 2.0).

Motor síncrono a propósito: yfinance, pandas y APScheduler son síncronos. FastAPI ejecuta
los endpoints `def` en un threadpool, así que no bloqueamos el event loop."""

from __future__ import annotations

from collections.abc import Generator
from contextvars import ContextVar, Token

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# Actor de esta request para `public.tocar_auditoria()` (saneamiento 10): lo deja
# `app.auth.require_auth` con el uid del admin; vacío = proceso de sistema (scheduler, scripts),
# que nunca pasa por esa dependencia -> NULL en `created_by`/`updated_by`.
_actor: ContextVar[str | None] = ContextVar("actor", default=None)


def set_actor(uid: str | None) -> Token:
    return _actor.set(uid)


def reset_actor(token: Token) -> None:
    _actor.reset(token)

# `check_same_thread` solo aplica a SQLite; permite usar la conexión desde el
# threadpool de FastAPI y desde el scheduler.
connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

# Las peticiones de IA retienen su conexión durante minutos; con las 5+10 por defecto unas pocas
# dejaban sin conexión al resto. Los límites de `liga.acceso` acotan cuántas hay a la vez.
_pool = {} if settings.database_url.startswith("sqlite") else {"pool_size": 10, "max_overflow": 10}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True,
                       **_pool)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Session, "after_begin")
def _marcar_actor(session, transaction, connection) -> None:  # noqa: ANN001, ARG001
    """Dentro de cada transacción, deja `app.actor` para `public.tocar_auditoria()`. Solo en
    Postgres (SQLite de tests no tiene `set_config`); sin actor en el contextvar, no hace nada."""
    if connection.dialect.name != "postgresql":
        return
    uid = _actor.get()
    if uid:
        connection.execute(text("select set_config('app.actor', :uid, true)"), {"uid": uid})


class Base(DeclarativeBase):
    """Base declarativa para todos los modelos ORM."""


def get_db() -> Generator[Session, None, None]:
    """Dependencia de FastAPI: abre una sesión por request y la cierra al terminar."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Crea las tablas que falten, SOLO en el SQLite local (lo llama el lifespan de `main.py`).

    Contra Postgres no toca nada: el esquema vive en Supabase y se cambia allí primero."""
    if engine.dialect.name != "sqlite":
        return
    from app import models  # noqa: F401  (registra los modelos en la metadata)

    Base.metadata.create_all(bind=engine)
