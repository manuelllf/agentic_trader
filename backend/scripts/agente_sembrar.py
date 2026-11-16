"""Siembra la lista inicial de seguimiento del agente desde el último escaneo de Vennett.

Uso (una vez, al estrenar la base del agente):
    VENNETT_DATABASE_URL=... AGENTE_DATABASE_URL=... python scripts/agente_sembrar.py [--aplicar]

Sin --aplicar solo muestra las candidatas. Solo lee de Vennett.
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.agente import base, semilla


def _motor_vennett():  # noqa: ANN202
    url = os.environ.get("VENNETT_DATABASE_URL", "")
    if not url:
        raise SystemExit("Falta VENNETT_DATABASE_URL")
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return create_engine(url, pool_pre_ping=True)


def main(aplicar: bool) -> None:
    with Session(_motor_vennett()) as sv:
        sv.connection(execution_options={"postgresql_readonly": True})
        candidatas = semilla.leer_ultimo_escaneo(sv)
    for c in candidatas:
        print(f"{c.ticker:8} {c.motivo}")
    print(f"{len(candidatas)} candidatas")
    if not aplicar:
        print("Sin cambios (añade --aplicar para sembrar).")
        return
    with base.con_actor("semilla"), base.sesion() as s:
        print(f"{semilla.sembrar(s, candidatas)} empresas nuevas en seguimiento")


if __name__ == "__main__":
    main("--aplicar" in sys.argv[1:])
