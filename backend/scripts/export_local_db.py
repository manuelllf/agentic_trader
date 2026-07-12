"""Genera un snapshot JSON LITERAL de la base de datos LOCAL para volcarlo en la nube.

Uso (desde la carpeta backend):
    uv run --system-certs python scripts/export_local_db.py

Salida: backend/secrets/db_snapshot.json (gitignoreado). Ese fichero es el que subes tú
desde el botón "Volcar base de datos" de la Sala Real en producción.
"""

from __future__ import annotations

import json
import pathlib

from app.db import engine
from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.dbdump import export_all

OUT = pathlib.Path(__file__).resolve().parents[1] / "secrets" / "db_snapshot.json"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with engine.connect() as conn:
        data = export_all(conn)
    OUT.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    total = sum(len(rows) for rows in data["tables"].values())
    print(f"Snapshot escrito en: {OUT}")
    for t, rows in data["tables"].items():
        print(f"  {t}: {len(rows)}")
    print(f"TOTAL: {total} filas · {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
