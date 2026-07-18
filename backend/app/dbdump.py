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

import math

from sqlalchemy.engine import Connection

_MAX_ROWS_TOTAL = 200_000   # el snapshot real ronda ~100 filas; el tope es anti-OOM


def _table_names(conn: Connection) -> list[str]:
    res = conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    return [r[0] for r in res.fetchall()]


def _column_names(conn: Connection, table: str) -> set[str]:
    """Columnas reales de la tabla según el esquema vivo (la tabla viene de sqlite_master)."""
    res = conn.exec_driver_sql(f'PRAGMA table_info("{table}")')
    return {r[1] for r in res.fetchall()}


def _validate(conn: Connection, tables: dict, existing: set[str]) -> None:
    """Valida TODO el snapshot antes de tocar nada: columnas contra el esquema real (sus
    nombres se interpolan en el INSERT — solo pueden ser columnas que existan de verdad),
    valores solo escalares finitos, y tope de filas. Se valida la ESTRUCTURA, no los tipos
    de los valores: el dinero vive como TEXT vía DecimalStr y "corregir" tipos aquí
    rechazaría datos válidos."""
    total = 0
    for t, rows in tables.items():
        if t not in existing or not rows:
            continue
        if not isinstance(rows, list):
            raise ValueError(f"Tabla '{t}': se esperaba una lista de filas.")
        total += len(rows)
        if total > _MAX_ROWS_TOTAL:
            raise ValueError(f"Snapshot demasiado grande (tope {_MAX_ROWS_TOTAL} filas).")
        reales = _column_names(conn, t)
        for i, fila in enumerate(rows):
            if not isinstance(fila, dict):
                raise ValueError(f"Tabla '{t}', fila {i}: se esperaba un objeto por fila.")
            for c, v in fila.items():
                if c not in reales:
                    raise ValueError(f"Tabla '{t}': columna desconocida '{c}'.")
                if v is not None and not isinstance(v, (str, int, float)):
                    raise ValueError(f"Tabla '{t}', fila {i}, '{c}': valor no escalar.")
                if isinstance(v, float) and not math.isfinite(v):
                    raise ValueError(f"Tabla '{t}', fila {i}, '{c}': flotante no finito.")


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
    en blanco), y valida TODA la estructura primero (columnas contra el esquema, valores
    escalares, tope de filas): si algo está mal, la DB ni se toca. Solo carga tablas que
    existen en el esquema actual; las que sobren se ignoran.
    """
    tables = payload.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise ValueError("Snapshot inválido o vacío: falta 'tables' con datos.")

    existing = set(_table_names(conn))
    _validate(conn, tables, existing)           # todo o nada: si algo está mal, ni un DELETE

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
