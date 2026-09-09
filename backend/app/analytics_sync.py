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

# Tablas de esquema 'public' que se saltan del reemplazo diario genérico (`CREATE OR REPLACE
# TABLE ... SELECT *`), no por accidente:
_EXCLUIDAS = {
    # `memories.text` ya no lleva vector propio (se movió a `memory_chunks`, ver
    # `memory/store.py`) — se queda excluida igual: sin ANN aquí, nada la consulta en DuckDB.
    "memories",
    # `embedding` (pgvector) llega como VARCHAR con el texto crudo del vector — no hay ANN
    # aquí, la búsqueda real sigue viviendo en Postgres. Mismo motivo que `memories`: duplicar
    # miles de vectores de texto cada día es peso sin ningún consultante real hoy.
    "memory_chunks",
    # Append-only, grandes y NUNCA leídas por `/analytics/*` (comprobado en
    # `analytics_explorer.py`) -- el reemplazo diario las retransmitía ENTERAS cada día:
    # detectado 5-sep-2026 tras un aviso de Supabase por bandwidth, ~710 MB/día (~21 GB/mes)
    # contra un free tier de 5.5 GB. Del 9-sep-2026 en adelante se sincronizan por delta
    # (`_INCREMENTALES` de abajo) en vez de excluirse del todo.
    "fundamentals_snapshot_metric",
    "llm_call_logprob",
    "llm_call",
    "fundamentals_snapshot_news",
}

# Tablas que se archivan por DELTA (nunca `CREATE OR REPLACE`, eso fue el bug de bandwidth del
# 5-sep) -- se acumulan en DuckDB para siempre aunque Postgres las pode o las borre. Primera
# vez que corre (tabla aún no existe en este fichero DuckDB): pull completo, fija la marca de
# agua en el `id` máximo. Siguientes veces: solo `id > marca_de_agua`, insertado sin más.
#
# Formato: {nombre_en_duckdb: (referencia_en_postgres, columna_id)}.
#
# Las 4 de 'public' llevan su propia PK autoincremental. Las 5 `..._archivo` (poda del
# 9-sep-2026, ver docs/momentum-sala-real-x.md -- no, esto es del ranker: `fundamentals_snapshot`
# guardaba el dataset global/HuggingFace entero sin que `foto_reciente` (TTL=12h) ni el escaneo
# real -- solo mira las ~3.310 de NASDAQ -- lo consultasen nunca; y `scan_audit`/`scan_runs`
# guardaban cada escaneo de PRUEBA (`decide=false`) igual que uno real) viven en un esquema
# `archivo` aparte EN POSTGRES (no en 'public') -- movidas ahí a propósito el 9-sep-2026 para
# que ni siquiera un despliegue viejo/atrasado de este archivo pueda volver a mandarlas enteras
# por error (el descubrimiento de arriba solo mira 'public'). Son estáticas -- nadie vuelve a
# escribir en ellas -- así que tras el primer pull completo esto no hace nada más.
_INCREMENTALES: dict[str, tuple[str, str]] = {
    "fundamentals_snapshot_metric": ("pg.fundamentals_snapshot_metric", "id"),
    "fundamentals_snapshot_news": ("pg.fundamentals_snapshot_news", "id"),
    "llm_call": ("pg.llm_call", "id"),
    "llm_call_logprob": ("pg.llm_call_logprob", "id"),
    "fundamentals_snapshot_archivo": ("pg.archivo.fundamentals_snapshot_archivo", "id"),
    "fundamentals_snapshot_metric_archivo": (
        "pg.archivo.fundamentals_snapshot_metric_archivo", "id"),
    "fundamentals_snapshot_news_archivo": ("pg.archivo.fundamentals_snapshot_news_archivo", "id"),
    "scan_audit_archivo": ("pg.archivo.scan_audit_archivo", "id"),
    "scan_runs_archivo": ("pg.archivo.scan_runs_archivo", "id"),
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


def _tablas_existentes_duckdb(con) -> set[str]:  # noqa: ANN001
    """Tablas que YA existen en el fichero DuckDB local -- filtra por `current_database()`
    (el catálogo local, no el `pg` adjuntado) para no confundirse si algo dentro de Postgres
    tuviera un esquema también llamado 'main' (los adjuntados por `TYPE postgres` no lo tienen
    -- exponen los esquemas reales de Postgres -- pero un mock/test con `ATTACH ':memory:'`
    sí, y es gratis blindarse)."""
    filas = con.execute(
        "select table_name from duckdb_tables() where database_name = current_database()"
    ).fetchall()
    return {t for (t,) in filas}


def _sync_incremental(con, existentes: set[str]) -> dict[str, int]:  # noqa: ANN001
    """Archiva por delta las tablas de `_INCREMENTALES`. Ver docstring del diccionario."""
    con.execute(
        "create table if not exists _sync_watermark (tabla varchar primary key, ultimo_id bigint)"
    )
    counts: dict[str, int] = {}
    for tabla, (fuente, columna_id) in _INCREMENTALES.items():
        if tabla not in existentes:
            con.execute(f"create table {tabla} as select * from {fuente}")
        else:
            fila = con.execute(
                "select ultimo_id from _sync_watermark where tabla = ?", [tabla]
            ).fetchone()
            ultimo_id = fila[0] if fila else 0
            con.execute(
                f"insert into {tabla} select * from {fuente} where {columna_id} > {ultimo_id}"
            )
        nuevo_max = con.execute(
            f"select coalesce(max({columna_id}), 0) from {tabla}"
        ).fetchone()[0]
        con.execute(
            "insert into _sync_watermark (tabla, ultimo_id) values (?, ?) "
            "on conflict (tabla) do update set ultimo_id = excluded.ultimo_id",
            [tabla, nuevo_max],
        )
        counts[tabla] = con.execute(f"select count(*) from {tabla}").fetchone()[0]
    return counts


def sync(path: str | None = None) -> dict[str, int]:
    """Reconstruye por completo las tablas normales y sincroniza por delta las de
    `_INCREMENTALES`. Devuelve nº de filas por tabla (en las incrementales, el total
    acumulado, no el delta)."""
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
        existentes = _tablas_existentes_duckdb(con)
        counts.update(_sync_incremental(con, existentes))
        con.execute("detach pg")
        logger.info("Analítica DuckDB sincronizada (%s, %d + %d tablas): %s",
                    db_path, len(tablas), len(_INCREMENTALES), counts)
        return counts
    finally:
        con.close()
