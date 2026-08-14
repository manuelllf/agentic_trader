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
    # scan_audit.price: la traza pasó a ser histórica y sin precio no se puede medir a posteriori
    # qué hicieron las descartadas. ADD COLUMN no toca las filas ya guardadas (quedan a NULL).
    sa = cols("scan_audit")
    if sa and "price" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN price FLOAT"))
    # scan_audit.decide: sin él, la cartera HIPOTÉTICA de un observatorio se confunde con una
    # decisión real. Las filas viejas quedan a NULL = observatorio (las dos cohortes de julio
    # que sobreviven en la traza lo eran; la decisión real del 18-jul ni siquiera está).
    if sa and "decide" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN decide BOOLEAN"))
    # proposals.omitted: qué candidatos NO fondeó el constructor y por qué. Las propuestas ya
    # guardadas se quedan con '[]' — no había forma de saberlo entonces.
    pr = cols("proposals")
    if pr and "omitted" not in pr:
        conn.execute(text("ALTER TABLE proposals ADD COLUMN omitted JSON DEFAULT '[]'"))
    # scan_audit.entry_lane/had_prior_thesis: carril de entrada al profundo y si se puntuó con
    # tesis previa. Filas viejas quedan a NULL — no se registraba entonces.
    if sa and "entry_lane" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN entry_lane VARCHAR(12)"))
    if sa and "had_prior_thesis" not in sa:
        conn.execute(text("ALTER TABLE scan_audit ADD COLUMN had_prior_thesis BOOLEAN"))
    # scores.news_used/target_raw/target_flagged: telemetría congelada del prompt (noticias) y
    # del guardarrail de precio objetivo. Filas viejas quedan a NULL/False — no había forma de
    # reconstruirlas después.
    if sc and "news_used" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN news_used JSON"))
    if sc and "target_raw" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN target_raw FLOAT"))
    if sc and "target_flagged" not in sc:
        conn.execute(text(
            "ALTER TABLE scores ADD COLUMN target_flagged BOOLEAN NOT NULL DEFAULT 0"
        ))
    # under_acquisition SIN default: NULL significa "el modelo no contestó al campo", que es
    # exactamente lo que pasa con las filas anteriores a la columna. Ponerlas a 0 las haría pasar
    # por un "no" comprobado que nadie comprobó.
    if sc and "under_acquisition" not in sc:
        conn.execute(text("ALTER TABLE scores ADD COLUMN under_acquisition BOOLEAN"))
    # scan_runs.finalists/construction: recuperación completa del escaneo (ver models.py). Las
    # filas ya guardadas quedan con listas/dict vacíos — ese escaneo ya no es recuperable, pero
    # los siguientes sí.
    sr = cols("scan_runs")
    if sr and "finalists" not in sr:
        conn.execute(text("ALTER TABLE scan_runs ADD COLUMN finalists JSON DEFAULT '[]'"))
    if sr and "construction" not in sr:
        conn.execute(text("ALTER TABLE scan_runs ADD COLUMN construction JSON DEFAULT '{}'"))
    # scan_runs.timings: duración por fase (ver models.py). Filas viejas quedan con '{}' — no
    # se midió entonces, no hay forma de reconstruirlo después.
    if sr and "timings" not in sr:
        conn.execute(text("ALTER TABLE scan_runs ADD COLUMN timings JSON DEFAULT '{}'"))
    conn.commit()
    _migrate_score_decimal(conn)


# Columnas que guardan una nota del scorer y que nacieron enteras (una por tabla).
_COLUMNAS_NOTA = (("scores", "score"), ("watchlist", "score"),
                  ("scan_audit", "deep_score"), ("approvals", "score"))


def _migrate_score_decimal(conn) -> None:  # noqa: ANN001
    """La nota pasa de entera a dos decimales → las columnas INTEGER tienen que ser reales.

    Por qué importa el dialecto y no vale un solo camino:

    · **SQLite** (desarrollo) no tiene `ALTER COLUMN`, pero tampoco lo necesita: su afinidad
      INTEGER solo convierte a entero lo que quepa sin pérdida, así que un 78,37 se guarda tal
      cual como REAL. No hay nada que migrar y el `create_all` posterior no toca tablas que ya
      existen.
    · **PostgreSQL** (producción) sí es estricto y —lo peligroso— *no falla*: al insertar 78,37 en
      una columna INTEGER redondea a 78 en silencio. Sin este ALTER, el despliegue arrancaría bien,
      los tests pasarían y las notas volverían a apelmazarse sin un solo error en los logs.

    Idempotente: comprueba el tipo actual antes de tocar, así que puede correr en cada arranque.
    Los ALTER no pierden datos (78 → 78.0) y Postgres reconstruye solo el índice de `scores.score`.
    """
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

    No hay Alembic: `_migrate_books` hace los ALTER TABLE a mano —cada uno comprobando antes si
    la columna ya existe, así que es idempotente— y `create_all` añade las tablas nuevas. En
    producción esto corre solo, al bootear el contenedor tras cada despliegue: no hay script que
    lanzar ni paso manual. Si fallase, el arranque falla y Railway conserva la versión anterior.
    """
    from app import models  # noqa: F401  (registra los modelos en la metadata)

    with engine.connect() as conn:
        _migrate_books(conn)
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        _copy_positions_old(conn)
