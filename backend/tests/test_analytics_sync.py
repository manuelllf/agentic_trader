"""Archivo incremental de `fundamentals_snapshot_datos` y reemplazo diario sin las columnas pesadas.

Postgres se simula con un segundo fichero DuckDB adjuntado como `pg`: la sintaxis de las fuentes
(`pg.tabla`, subconsulta con alias) es la misma que con la extensión de Postgres."""

from __future__ import annotations

import pytest

from app import analytics_sync as sync_mod

# `duckdb` es un extra (`analytics`), no una dependencia base: sin él, todo el fichero se salta.
duckdb = pytest.importorskip("duckdb")


@pytest.fixture
def con(tmp_path):
    c = duckdb.connect(str(tmp_path / "analytics.duckdb"))
    c.execute(f"attach '{tmp_path / 'pg.duckdb'}' as pg")
    c.execute("create table pg.fundamentals_snapshot (id bigint, ticker varchar, "
              "metricas json, titulares varchar[])")
    yield c
    c.close()


def _insertar(con, filas) -> None:  # noqa: ANN001
    for i, ticker, metricas, titulares in filas:
        con.execute("insert into pg.fundamentals_snapshot values (?, ?, ?, ?)",
                    [i, ticker, metricas, titulares])


def test_no_quedan_las_tablas_viejas_en_la_sincronizacion() -> None:
    assert "fundamentals_snapshot_metric" not in sync_mod._INCREMENTALES
    assert "fundamentals_snapshot_news" not in sync_mod._INCREMENTALES
    # Siguen excluidas del reemplazo diario: sus copias en DuckDB no se pueden pisar nunca.
    assert "fundamentals_snapshot_metric" in sync_mod._EXCLUIDAS
    assert "fundamentals_snapshot_news" in sync_mod._EXCLUIDAS
    assert "fundamentals_snapshot_datos" in sync_mod._INCREMENTALES


def test_archivo_incremental_de_metricas_y_titulares(con, monkeypatch) -> None:
    monkeypatch.setattr(sync_mod, "_INCREMENTALES", {
        "fundamentals_snapshot_datos": sync_mod._INCREMENTALES["fundamentals_snapshot_datos"]})
    _insertar(con, [(1, "AAA", '{"beta": 1.1}', ["uno", "dos"]),
                    (2, "BBB", None, None),                 # sin datos: no se archiva
                    (3, "CCC", None, ["solo titulares"])])

    counts = sync_mod._sync_incremental(con, sync_mod._tablas_existentes_duckdb(con))
    assert counts == {"fundamentals_snapshot_datos": 2}
    assert con.execute("select id from fundamentals_snapshot_datos order by id").fetchall() == [
        (1,), (3,)]

    # Segunda pasada: solo entra lo nuevo, y lo ya archivado no se toca aunque Postgres lo pode.
    con.execute("update pg.fundamentals_snapshot set metricas = null, titulares = null "
                "where id = 1")
    _insertar(con, [(4, "DDD", '{"beta": 0.9}', None)])
    counts = sync_mod._sync_incremental(con, sync_mod._tablas_existentes_duckdb(con))
    assert counts == {"fundamentals_snapshot_datos": 3}
    assert con.execute("select id, titulares from fundamentals_snapshot_datos where id = 1"
                       ).fetchone() == (1, ["uno", "dos"])
    assert con.execute("select ultimo_id from _sync_watermark").fetchone() == (4,)


def test_una_columna_nueva_en_postgres_no_rompe_el_archivo_incremental(con, monkeypatch) -> None:
    # Producción: `llm_call_logprob` ganó una columna (auditoría) y el `insert ... select *` sobre
    # la tabla archivada, creada con el esquema viejo, reventaba: "6 columns but 7 values".
    monkeypatch.setattr(sync_mod, "_INCREMENTALES", {"logprob": ("pg.logprob", "id")})
    con.execute("create table pg.logprob (id bigint, token varchar)")
    con.execute("insert into pg.logprob values (1, 'a'), (2, 'b')")
    sync_mod._sync_incremental(con, sync_mod._tablas_existentes_duckdb(con))

    con.execute("alter table pg.logprob add column created_at varchar")
    con.execute("insert into pg.logprob values (3, 'c', '2026-09-29')")
    counts = sync_mod._sync_incremental(con, sync_mod._tablas_existentes_duckdb(con))

    assert counts == {"logprob": 3}
    # Lo archivado antes queda como estaba (columna nueva vacía) y lo nuevo trae su valor.
    assert con.execute("select id, token, created_at from logprob order by id").fetchall() == [
        (1, "a", None), (2, "b", None), (3, "c", "2026-09-29")]


def test_reemplazo_diario_deja_fuera_metricas_y_titulares(con) -> None:
    _insertar(con, [(1, "AAA", '{"beta": 1.1}', ["uno"])])
    columnas = sync_mod._SELECT_REEMPLAZO["fundamentals_snapshot"]
    con.execute(f"create or replace table fundamentals_snapshot as select {columnas} "
                "from pg.fundamentals_snapshot")
    cols = [c for (c,) in con.execute(
        "select column_name from duckdb_columns() where table_name = 'fundamentals_snapshot' "
        "and database_name = current_database() order by column_index").fetchall()]
    assert cols == ["id", "ticker"]
