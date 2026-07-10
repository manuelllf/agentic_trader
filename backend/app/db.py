"""Capa de base de datos (SQLAlchemy 2.0).

Motor síncrono a propósito: yfinance, pandas y APScheduler son síncronos, así que
mantener todo síncrono es más simple de razonar y defender que mezclar async. FastAPI
ejecuta los endpoints `def` en un threadpool, con lo que no bloqueamos el event loop.
"""

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


def _migrate_books(conn) -> None:  # noqa: ANN001
    """Migración ligera para bases previas al libro real (columna `book`).

    - allocations/trades: ADD COLUMN book DEFAULT 'shadow'.
    - positions: tenía UNIQUE(ticker) global (impediría el mismo ticker en sombra Y real)
      → se renombra, create_all crea la nueva con UNIQUE(ticker, book) y se copian los datos.
    """
    from sqlalchemy import inspect, text

    insp = inspect(conn)

    def cols(table: str) -> set[str]:
        return {c["name"] for c in insp.get_columns(table)} if insp.has_table(table) else set()

    for table in ("allocations", "trades"):
        c = cols(table)
        if c and "book" not in c:
            conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN book VARCHAR(8) NOT NULL DEFAULT 'shadow'"
            ))
    c = cols("positions")
    if c and "book" not in c:
        # Los índices sobreviven al RENAME con su nombre viejo → chocan con create_all. Fuera.
        for idx in insp.get_indexes("positions"):
            if idx.get("name"):
                conn.execute(text(f"DROP INDEX IF EXISTS {idx['name']}"))
        conn.execute(text("ALTER TABLE positions RENAME TO positions_old"))
    # scores.market_cap (desempate por market cap, fiel al paper).
    sc = cols("scores")
    if sc and "market_cap" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN market_cap FLOAT"))
    # approvals.broker_order_id / requested_quantity (reconciliación de fills reales).
    ap = cols("approvals")
    if ap and "broker_order_id" not in ap:
        conn.execute(text("ALTER TABLE approvals ADD COLUMN broker_order_id VARCHAR(48)"))
    if ap and "requested_quantity" not in ap:
        conn.execute(text("ALTER TABLE approvals ADD COLUMN requested_quantity VARCHAR(32)"))
    conn.commit()


def _copy_positions_old(conn) -> None:  # noqa: ANN001
    from sqlalchemy import inspect, text

    if inspect(conn).has_table("positions_old"):
        conn.execute(text(
            "INSERT INTO positions (id, ticker, quantity, avg_cost, opened_at, order_ref, book) "
            "SELECT id, ticker, quantity, avg_cost, opened_at, order_ref, 'shadow' "
            "FROM positions_old"
        ))
        conn.execute(text("DROP TABLE positions_old"))
        conn.commit()


def init_db() -> None:
    """Crea las tablas si no existen (para dev; en prod se usa Alembic)."""
    from app import models  # noqa: F401  (registra los modelos en la metadata)

    with engine.connect() as conn:
        _migrate_books(conn)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _copy_positions_old(conn)
