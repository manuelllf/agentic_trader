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


def _migrate_books(conn) -> None:  # noqa: ANN001
    """Migración ligera para bases previas al libro real (columna `book`).

    Renombra positions, crea tabla con UNIQUE(ticker, book) y copia datos."""
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
    # Cartera híbrida EUR/USD: el libro real ya no convierte al aportar (ver `models.Allocation`).
    ac = cols("allocations")
    if ac and "currency" not in ac:
        conn.execute(text(
            "ALTER TABLE allocations ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'USD'"
        ))
    c = cols("positions")
    if c and "book" not in c:
        # Índices renombrados chocan con create_all.
        for idx in insp.get_indexes("positions"):
            if idx.get("name"):
                conn.execute(text(f"DROP INDEX IF EXISTS {idx['name']}"))
        conn.execute(text("ALTER TABLE positions RENAME TO positions_old"))
    # Tiebreaker por market cap.
    sc = cols("scores")
    if sc and "market_cap" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN market_cap FLOAT"))
    # Reconciliación de fills reales.
    ap = cols("approvals")
    if ap and "broker_order_id" not in ap:
        conn.execute(text("ALTER TABLE approvals ADD COLUMN broker_order_id VARCHAR(48)"))
    if ap and "requested_quantity" not in ap:
        conn.execute(text("ALTER TABLE approvals ADD COLUMN requested_quantity VARCHAR(32)"))
    # Precio al escanear; mide retornos de descartadas post-hoc.
    sa = cols("scan_audit")
    if sa and "price" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN price FLOAT"))
    # Cartera hipotética vs. decisión real; NULL = observatorio.
    if sa and "decide" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN decide BOOLEAN"))
    # Carril de entrada. (`had_prior_thesis` ya no se crea ni se escribe; donde exista, se queda.)
    if sa and "entry_lane" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN entry_lane VARCHAR(12)"))
    if sc and "target_raw" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN target_raw FLOAT"))
    if sc and "target_flagged" not in sc:
        conn.execute(text(
            "ALTER TABLE scores ADD COLUMN target_flagged BOOLEAN NOT NULL DEFAULT 0"
        ))
    # NULL = no respondió; 0 = verificado como falso.
    if sc and "under_acquisition" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN under_acquisition BOOLEAN"))
    # Guardarraíl de precio objetivo.
    if sc and "target_consensus_mean" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN target_consensus_mean FLOAT"))
    if sc and "target_echoed_consensus" not in sc:
        conn.execute(text(
            "ALTER TABLE scores ADD COLUMN target_echoed_consensus BOOLEAN NOT NULL DEFAULT 0"
        ))
    # `scan_run_finalist` pasa de resumen a archivo de verdad: informe completo + los mismos 5
    # campos de guardarraíl que `scores` (que se pisa; esta fila no).
    srf = cols("scan_run_finalist")
    if srf and "report" not in srf:
        conn.execute(text("ALTER TABLE scan_run_finalist ADD COLUMN report TEXT"))
    if srf and "target_raw" not in srf:
        conn.execute(text("ALTER TABLE scan_run_finalist ADD COLUMN target_raw FLOAT"))
    if srf and "target_flagged" not in srf:
        conn.execute(text(
            "ALTER TABLE scan_run_finalist ADD COLUMN target_flagged BOOLEAN NOT NULL DEFAULT 0"
        ))
    if srf and "target_consensus_mean" not in srf:
        conn.execute(text("ALTER TABLE scan_run_finalist ADD COLUMN target_consensus_mean FLOAT"))
    if srf and "target_echoed_consensus" not in srf:
        conn.execute(text(
            "ALTER TABLE scan_run_finalist ADD COLUMN target_echoed_consensus "
            "BOOLEAN NOT NULL DEFAULT 0"
        ))
    if srf and "under_acquisition" not in srf:
        conn.execute(text("ALTER TABLE scan_run_finalist ADD COLUMN under_acquisition BOOLEAN"))
    conn.commit()
    _migrate_score_decimal(conn)
    _drop_columnas_muertas(conn)


# Columnas JSON normalizadas a tablas hijas (ver ScanRun.finalists/construction/timings y
# Proposal.omitted/Score.news_used en models.py) — confirmadas vacías antes de soltarlas.
_COLUMNAS_MUERTAS = (
    ("scan_runs", "finalists"), ("scan_runs", "construction"), ("scan_runs", "timings"),
    ("proposals", "omitted"), ("scores", "news_used"),
)


def _drop_columnas_muertas(conn) -> None:  # noqa: ANN001
    from sqlalchemy import inspect, text

    insp = inspect(conn)
    for tabla, columna in _COLUMNAS_MUERTAS:
        if not insp.has_table(tabla):
            continue
        if columna in {c["name"] for c in insp.get_columns(tabla)}:
            conn.execute(text(f"ALTER TABLE {tabla} DROP COLUMN {columna}"))
    conn.commit()


# Score columns per table (originally INTEGER).
_COLUMNAS_NOTA = (("scores", "score"), ("watchlist", "score"),
                  ("scan_audit", "deep_score"), ("approvals", "score"))


def _migrate_score_decimal(conn) -> None:  # noqa: ANN001
    """La nota pasa de entera a dos decimales → las columnas INTEGER tienen que ser reales.

    PostgreSQL redondea silenciosamente INTEGER; idempotente."""
    from sqlalchemy import Integer, inspect, text

    if conn.dialect.name != "postgresql":
        return
    insp = inspect(conn)
    for tabla, columna in _COLUMNAS_NOTA:
        if not insp.has_table(tabla):
            continue
        for c in insp.get_columns(tabla):
            if c["name"] == columna and isinstance(c["type"], Integer):
                conn.execute(text(
                    f"ALTER TABLE {tabla} ALTER COLUMN {columna} TYPE DOUBLE PRECISION"
                ))
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
    """Prepara el esquema AL ARRANCAR la app (lo llama el lifespan de `main.py`).

    Sin Alembic: `_migrate_books` hace ALTER TABLE a mano; si falla, Railway conserva versión anterior."""
    from app import models  # noqa: F401  (registra los modelos en la metadata)

    with engine.connect() as conn:
        _migrate_books(conn)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _copy_positions_old(conn)
