"""Capa de base de datos (SQLAlchemy 2.0).

Motor síncrono a propósito: yfinance, pandas y APScheduler son síncronos. FastAPI ejecuta
los endpoints `def` en un threadpool, así que no bloqueamos el event loop."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# `check_same_thread` solo aplica a SQLite; permite usar la conexión desde el
# threadpool de FastAPI y desde el scheduler.
connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


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
