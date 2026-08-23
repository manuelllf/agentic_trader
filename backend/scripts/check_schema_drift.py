"""Compara el esquema REAL de la BD conectada contra lo que `models.py` declara.

Motivo: el esquema ahora vive en SQL aplicado directo a Supabase, no en `models.py` — nada
sincroniza el modelo Python automáticamente cuando cambia la BD (ver
docs/plan-datos-observability.md, Fase 0.2). Este script es la red de seguridad: sin él, "la BD
manda" sería una promesa, no algo que se pueda verificar.

Solo tiene sentido correrlo contra Postgres — SQLite es de tipado dinámico y no distingue
NUMERIC de VARCHAR, así que un drift real (p. ej. alguien olvida `Numeric` en `DecimalStr`)
pasaría desapercibido ahí. Sale sin comprobar nada si `DATABASE_URL` no es postgres.

Uso (desde backend/):
    uv run python scripts/check_schema_drift.py

Exit code 0 = sin deriva. Exit code 1 = hay diferencias, se listan.
"""

from __future__ import annotations

import sys

from sqlalchemy import inspect

from app import models  # noqa: F401  (registra las tablas en Base.metadata)
from app.config import settings
from app.db import Base, engine


# Alias que Postgres resuelve al mismo tipo físico pero SQLAlchemy compila con otro nombre:
# Float() sin precisión emite el DDL "FLOAT", que Postgres crea y reporta luego como
# "DOUBLE PRECISION" en su catálogo — no es una diferencia real, es cómo Postgres nombra
# ese alias tras crearlo.
_ALIAS_TIPOS = {"FLOAT": "DOUBLE PRECISION"}


def _tipo_ddl(col_type, dialect) -> str:  # noqa: ANN001
    """DDL real del tipo para ESTE dialecto (p. ej. "VARCHAR(16)", "NUMERIC(20, 8)").

    Comparar `type(col_type).__name__` (STRING vs VARCHAR, DATETIME vs TIMESTAMP, DECIMALSTR
    vs NUMERIC) da falsos positivos: son nombres distintos del mismo tipo. Compilar a DDL
    resuelve además los `TypeDecorator` (como `DecimalStr`) a su tipo físico real por dialecto,
    que es justo lo que hace falta comparar.
    """
    try:
        ddl = str(col_type.compile(dialect=dialect)).upper()
    except Exception:  # noqa: BLE001  # tipos sin compilador para este dialecto
        ddl = type(col_type).__name__.upper()
    return _ALIAS_TIPOS.get(ddl, ddl)


def comparar() -> list[str]:
    """Devuelve una lista de diferencias legibles; vacía si BD y modelo coinciden."""
    insp = inspect(engine)
    diffs: list[str] = []

    tablas_bd = set(insp.get_table_names())
    tablas_modelo = set(Base.metadata.tables.keys())

    for solo_bd in sorted(tablas_bd - tablas_modelo):
        diffs.append(f"tabla '{solo_bd}' existe en la BD pero no en models.py")
    for solo_modelo in sorted(tablas_modelo - tablas_bd):
        diffs.append(f"tabla '{solo_modelo}' está en models.py pero no existe en la BD")

    for tabla in sorted(tablas_bd & tablas_modelo):
        cols_bd = {c["name"]: c for c in insp.get_columns(tabla)}
        cols_modelo = {c.name: c for c in Base.metadata.tables[tabla].columns}

        for solo_bd in sorted(set(cols_bd) - set(cols_modelo)):
            diffs.append(f"{tabla}.{solo_bd}: columna en la BD, ausente en models.py")
        for solo_modelo in sorted(set(cols_modelo) - set(cols_bd)):
            diffs.append(f"{tabla}.{solo_modelo}: columna en models.py, ausente en la BD")

        for nombre in sorted(set(cols_bd) & set(cols_modelo)):
            bd, mod = cols_bd[nombre], cols_modelo[nombre]
            t_bd = _tipo_ddl(bd["type"], insp.dialect)
            t_mod = _tipo_ddl(mod.type, insp.dialect)
            if t_bd != t_mod:
                diffs.append(f"{tabla}.{nombre}: tipo BD={t_bd} vs models.py={t_mod}")
            if bool(bd["nullable"]) != bool(mod.nullable):
                diffs.append(
                    f"{tabla}.{nombre}: nullable BD={bd['nullable']} vs models.py={mod.nullable}"
                )
    return diffs


def main() -> int:
    if not settings.database_url.startswith(("postgresql", "postgres")):
        print(f"DATABASE_URL no es Postgres ({settings.database_url.split(':')[0]}://...) "
              "— sin comprobar, SQLite no distingue tipos de forma útil para esto.")
        return 0

    diffs = comparar()
    if not diffs:
        print("Sin deriva: la BD y models.py coinciden.")
        return 0

    print(f"DERIVA DETECTADA — {len(diffs)} diferencia(s):")
    for d in diffs:
        print(f"  - {d}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
