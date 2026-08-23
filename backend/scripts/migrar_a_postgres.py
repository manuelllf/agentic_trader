"""Migra la SQLite de producción a Postgres (Supabase), una sola vez.

No continúa si la verificación aritmética falla — impreso el detalle y `sys.exit(1)`.
Nunca borra ni toca la SQLite de origen.

Uso (desde backend/):
    SQLITE_ORIGEN="ruta/a/agentic_trader.db" \
    DATABASE_URL="postgresql+psycopg://..." \
    uv run --system-certs python scripts/migrar_a_postgres.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, create_engine, func, select, text

from app import models  # noqa: F401  (registra las tablas en Base.metadata)
from app.db import Base
from app.dbdump import export_all
from app.ledger.money import DecimalStr

# Sin FKs reales en el esquema — el orden es solo para que los logs se lean de arriba abajo
# en un orden con sentido, no una dependencia real.
ORDEN_TABLAS = [
    "meta", "watchlist", "fundamentals_cache",
    "scores", "proposals", "scan_audit", "scan_runs",
    "allocations", "trades", "positions", "approvals", "equity_snapshots",
    "personal_positions", "push_subscriptions",
]

# Tablas y columna de dinero a verificar por suma exacta, agrupado por `book`.
_TABLAS_DINERO = [
    ("allocations", "amount"),
    ("trades", "quantity"),
    ("trades", "price"),
    ("positions", "quantity"),
    ("equity_snapshots", "equity"),
]


def _convertir(col, valor):  # noqa: ANN001
    """SQLite devuelve todo crudo (texto/int) vía `export_all()`; aquí se adapta al tipo
    Python que cada columna espera para escribir bien en Postgres."""
    if valor is None:
        return None
    t = col.type
    if isinstance(t, DecimalStr):
        return valor  # su process_bind_param ya acepta str o Decimal
    if isinstance(t, JSON):
        return json.loads(valor) if isinstance(valor, str) else valor
    if isinstance(t, DateTime):
        return datetime.fromisoformat(valor) if isinstance(valor, str) else valor
    if isinstance(t, Date):
        return date.fromisoformat(valor) if isinstance(valor, str) else valor
    if isinstance(t, Boolean):
        return bool(valor) if isinstance(valor, int) else valor
    return valor


def cargar(sqlite_engine, pg_engine) -> dict[str, int]:  # noqa: ANN001
    with sqlite_engine.connect() as conn:
        snapshot = export_all(conn)

    cargadas: dict[str, int] = {}
    with pg_engine.begin() as pconn:
        for t in ORDEN_TABLAS:
            filas = snapshot["tables"].get(t, [])
            if not filas:
                cargadas[t] = 0
                continue
            tabla = Base.metadata.tables[t]
            cols = {c.name: c for c in tabla.columns}
            filas_conv = [
                {k: _convertir(cols[k], v) for k, v in fila.items() if k in cols}
                for fila in filas
            ]
            pconn.execute(tabla.insert(), filas_conv)
            cargadas[t] = len(filas_conv)
    return cargadas


def _realinear_secuencias(pg_engine) -> None:  # noqa: ANN001
    """Tras cargar con IDs explícitos, la identity de Postgres sigue pensando que el próximo
    valor es 1 — el primer INSERT normal de la app (sin id) chocaría con la PK ya ocupada.
    `ALTER ... RESTART WITH` la realinea al primer hueco libre real."""
    with pg_engine.begin() as conn:
        for t in ORDEN_TABLAS:
            tabla = Base.metadata.tables[t]
            if "id" not in tabla.columns:
                continue
            maximo = conn.execute(
                text(f'SELECT COALESCE(MAX(id), 0) + 1 FROM "{t}"')
            ).scalar()
            conn.execute(text(f'ALTER TABLE "{t}" ALTER COLUMN id RESTART WITH {maximo}'))


def _suma_sqlite(sqlite_engine, tabla: str, columna: str) -> dict[str, Decimal]:  # noqa: ANN001
    """Suma exacta con Decimal en Python — nunca SUM() de SQL sobre texto."""
    with sqlite_engine.connect() as conn:
        rows = conn.exec_driver_sql(
            f'SELECT book, "{columna}" FROM "{tabla}"'
        ).fetchall() if "book" in _column_names(conn, tabla) else \
            [("-", r[0]) for r in conn.exec_driver_sql(f'SELECT "{columna}" FROM "{tabla}"')]
    out: dict[str, Decimal] = {}
    for book, v in rows:
        out[book] = out.get(book, Decimal(0)) + Decimal(str(v))
    return out


def _column_names(conn, tabla: str) -> set[str]:  # noqa: ANN001
    return {r[1] for r in conn.exec_driver_sql(f'PRAGMA table_info("{tabla}")').fetchall()}


def _suma_postgres(pg_engine, tabla: str, columna: str) -> dict[str, Decimal]:  # noqa: ANN001
    t = Base.metadata.tables[tabla]
    con_book = "book" in t.columns
    with pg_engine.connect() as conn:
        if con_book:
            rows = conn.execute(select(t.c.book, t.c[columna])).fetchall()
        else:
            rows = [("-", r[0]) for r in conn.execute(select(t.c[columna]))]
    out: dict[str, Decimal] = {}
    for book, v in rows:
        if v is not None:
            out[book] = out.get(book, Decimal(0)) + Decimal(v)
    return out


def verificar(sqlite_engine, pg_engine) -> list[str]:  # noqa: ANN001
    problemas: list[str] = []

    with sqlite_engine.connect() as sconn, pg_engine.connect() as pconn:
        for t in ORDEN_TABLAS:
            tabla = Base.metadata.tables[t]
            n_sqlite = sconn.exec_driver_sql(f'SELECT COUNT(*) FROM "{t}"').scalar()
            n_pg = pconn.execute(select(func.count()).select_from(tabla)).scalar()
            if n_sqlite != n_pg:
                problemas.append(f"CONTEO {t}: {n_sqlite} en SQLite vs {n_pg} en Postgres")

    for tabla, columna in _TABLAS_DINERO:
        s_sqlite = _suma_sqlite(sqlite_engine, tabla, columna)
        s_pg = _suma_postgres(pg_engine, tabla, columna)
        for book in set(s_sqlite) | set(s_pg):
            a, b = s_sqlite.get(book, Decimal(0)), s_pg.get(book, Decimal(0))
            if a != b:
                problemas.append(
                    f"SUMA {tabla}.{columna} (book={book}): {a} en SQLite vs {b} en Postgres"
                )

    # positions: fila a fila, por (ticker, book) — pocas filas, comparación exacta.
    with sqlite_engine.connect() as sconn, pg_engine.connect() as pconn:
        pos_sqlite = {
            (r[0], r[1]): (Decimal(str(r[2])), Decimal(str(r[3])))
            for r in sconn.exec_driver_sql(
                'SELECT ticker, book, quantity, avg_cost FROM positions'
            ).fetchall()
        }
        t = Base.metadata.tables["positions"]
        pos_pg = {
            (r.ticker, r.book): (Decimal(r.quantity), Decimal(r.avg_cost))
            for r in pconn.execute(select(t.c.ticker, t.c.book, t.c.quantity, t.c.avg_cost))
        }
    if pos_sqlite != pos_pg:
        problemas.append(f"POSITIONS: difieren — SQLite {pos_sqlite} vs Postgres {pos_pg}")

    return problemas


def main() -> int:
    sqlite_url = f"sqlite:///{os.environ['SQLITE_ORIGEN']}"
    pg_url = os.environ["DATABASE_URL"]
    if not pg_url.startswith(("postgresql", "postgres")):
        print(f"DATABASE_URL no es Postgres ({pg_url.split(':')[0]}://...) — abortado.")
        return 1

    sqlite_engine = create_engine(sqlite_url)
    pg_engine = create_engine(pg_url)

    print(f"Origen:  {sqlite_url}")
    print(f"Destino: {pg_url.split('@')[-1]}")  # sin credenciales en el log
    print()

    with pg_engine.connect() as conn:
        for t in ORDEN_TABLAS:
            n = conn.execute(select(func.count()).select_from(Base.metadata.tables[t])).scalar()
            if n:
                print(f"ABORTADO: la tabla '{t}' en destino ya tiene {n} filas — "
                      "este script es de carga única sobre BD vacía, no hace upsert.")
                return 1

    print("Cargando…")
    cargadas = cargar(sqlite_engine, pg_engine)
    for t, n in cargadas.items():
        print(f"  {t}: {n} filas")
    print()

    print("Realineando secuencias identity…")
    _realinear_secuencias(pg_engine)

    print("Verificando…")
    problemas = verificar(sqlite_engine, pg_engine)
    if problemas:
        print(f"\nVERIFICACIÓN FALLIDA — {len(problemas)} problema(s):")
        for p in problemas:
            print(f"  - {p}")
        print("\nLa SQLite de origen NO se ha tocado. Revisa antes de reintentar.")
        return 1

    print("Verificación OK: conteos y sumas de dinero coinciden en origen y destino.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
