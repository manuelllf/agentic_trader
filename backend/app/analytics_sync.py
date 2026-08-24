"""Sincroniza TODAS las tablas de Postgres a un fichero DuckDB persistente — columnar de
verdad (datos en disco en formato propio, comprimidos por columna), no una pasarela en memoria
que vuelve a pedirle todo a Postgres en cada consulta.

La lista de tablas se descubre en caliente contra `information_schema.tables` (esquema
`public`) en vez de mantenerse a mano — cualquier tabla nueva del esquema aparece sola en la
siguiente sincronización, sin tocar este fichero. `CREATE OR REPLACE TABLE ... AS SELECT * FROM
pg....` es un reemplazo atómico por tabla: si el proceso muere a mitad, la tabla vieja se queda
tal cual, nunca a medias.

El fichero vive en `settings.duckdb_path` — en Railway, el mismo volumen `/data` que ya usaba
el SQLite de la memoria vectorial (variable `DUCKDB_PATH=/data/analytics.duckdb`, mismo patrón
que `MEMORY_DB_PATH`).
"""

from __future__ import annotations

import logging
import os

from app.config import settings

logger = logging.getLogger(__name__)

# Tablas que se saltan a propósito, no por accidente:
_EXCLUIDAS = {
    # `embedding` (pgvector) llega como VARCHAR con el texto crudo del vector — no hay ANN
    # aquí, la búsqueda real sigue viviendo en Postgres. Se sincroniza igual (no rompe nada,
    # medido), pero duplicar 2.376 vectores de texto en cada sincronización diaria es peso sin
    # ningún consultante real hoy — si algún día hace falta analítica sobre la memoria, quitar
    # de aquí.
    "memories",
}


def _pg_dsn(database_url: str) -> str:
    return database_url.replace("postgresql+psycopg://", "postgresql://")


def default_path() -> str:
    return settings.duckdb_path


def _tablas_publicas(con, url: str) -> list[str]:  # noqa: ANN001
    con.execute(f"attach '{_pg_dsn(url)}' as pg_meta (type postgres, read_only)")
    try:
        filas = con.execute(
            "select table_name from pg_meta.information_schema.tables "
            "where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
        ).fetchall()
    finally:
        con.execute("detach pg_meta")
    return [t for (t,) in filas if t not in _EXCLUIDAS]


def sync(path: str | None = None) -> dict[str, int]:
    """Reconstruye el fichero DuckDB entero desde Postgres. Devuelve nº de filas por tabla."""
    import duckdb

    url = settings.database_url
    if not url.startswith(("postgresql", "postgres")):
        raise RuntimeError("La sincronización requiere DATABASE_URL de Postgres (no SQLite).")
    db_path = path or default_path()
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    con = duckdb.connect(db_path)
    try:
        con.execute("install postgres; load postgres;")
        tablas = _tablas_publicas(con, url)
        con.execute(f"attach '{_pg_dsn(url)}' as pg (type postgres, read_only)")
        counts: dict[str, int] = {}
        for tabla in tablas:
            con.execute(f"create or replace table {tabla} as select * from pg.{tabla}")
            counts[tabla] = con.execute(f"select count(*) from {tabla}").fetchone()[0]
        con.execute("detach pg")
        logger.info("Analítica DuckDB sincronizada (%s, %d tablas): %s",
                    db_path, len(tablas), counts)
        return counts
    finally:
        con.close()
