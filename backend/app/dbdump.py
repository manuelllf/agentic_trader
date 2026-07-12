"""Volcado / restauración LITERAL de la base de datos (export local → import nube).

Trabaja a nivel SQLite CRUDO (lee `sqlite_master` y las filas tal cual): la copia es
lógicamente byte-a-byte — TEXT/INTEGER/REAL/NULL sin recodificar, así no hay líos de tipos
(Decimal guardado como TEXT, fechas como cadena ISO…). El import es DESTRUCTIVO pero
transaccional: borra todas las tablas y recarga el snapshot dentro de la MISMA transacción
de la conexión que le pasan; si algo falla, el caller hace rollback y la DB queda intacta.

Opera sobre una `Connection` de SQLAlchemy (no sobre el engine global) para respetar la BD
inyectada en tests. Solo SQLite (local y Railway). Un snapshot es
`{"version": 1, "tables": {"<tabla>": [ {col: val, ...}, ... ], ...}}`.
"""

from __future__ import annotations

from sqlalchemy.engine import Connection


def _table_names(conn: Connection) -> list[str]:
    res = conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    return [r[0] for r in res.fetchall()]


def export_all(conn: Connection) -> dict:
    """Snapshot literal de TODAS las tablas de usuario."""
    tables: dict[str, list[dict]] = {}
    for t in _table_names(conn):
        res = conn.exec_driver_sql(f'SELECT * FROM "{t}"')
        cols = list(res.keys())
        tables[t] = [dict(zip(cols, row)) for row in res.fetchall()]
    return {"version": 1, "tables": tables}


def import_all(conn: Connection, payload: dict) -> dict:
    """Reemplaza TODA la DB por el snapshot. No hace commit: lo hace el caller (atomicidad).

    Rechaza un snapshot vacío/inválido ANTES de borrar nada (un POST accidental no deja la DB
    en blanco). Solo carga tablas que existen en el esquema actual; las que sobren se ignoran.
    """
    tables = payload.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise ValueError("Snapshot inválido o vacío: falta 'tables' con datos.")

    existing = set(_table_names(conn))
    conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
    for t in existing:                          # vaciar TODO (también lo que no venga en el snapshot)
        conn.exec_driver_sql(f'DELETE FROM "{t}"')

    loaded: dict[str, int] = {}
    for t, rows in tables.items():
        if t not in existing or not rows:
            loaded[t] = 0
            continue
        cols = list(rows[0].keys())
        collist = ",".join(f'"{c}"' for c in cols)
        ph = ",".join("?" * len(cols))
        conn.exec_driver_sql(
            f'INSERT INTO "{t}" ({collist}) VALUES ({ph})',
            [tuple(r.get(c) for c in cols) for r in rows],
        )
        loaded[t] = len(rows)
    return {"ok": True, "loaded": loaded, "total": sum(loaded.values())}
