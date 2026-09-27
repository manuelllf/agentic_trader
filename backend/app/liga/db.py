"""Sesiones de BD de la liga: cada petición es su usuario en Postgres y las políticas RLS deciden.

Tres dependencias y ninguna más: `db_anon` (lo público), `db_usuario` (todo lo de una cuenta, admin
incluido) y `db_sistema` (solo procesos y los servicios auditados que lo necesitan).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.liga.auth import Identidad, require_usuario


@contextmanager
def sesion_como(ident: Identidad | None) -> Iterator[Session]:
    """Transacción en la que Postgres es el usuario del JWT ya verificado (o anon). `SET LOCAL`
    muere con la transacción: seguro con el pool y con Supavisor en modo transacción."""
    db = SessionLocal()
    try:
        with db.begin():
            if ident is None:
                db.execute(text("set local role anon"))
            else:
                db.execute(text("select set_config('request.jwt.claims', :c, true)"),
                           {"c": json.dumps(ident.claims)})
                db.execute(text("set local role authenticated"))
            yield db
    finally:
        db.close()


def db_anon() -> Iterator[Session]:
    with sesion_como(None) as db:
        yield db


def db_usuario(ident: Identidad = Depends(require_usuario)) -> Iterator[Session]:
    with sesion_como(ident) as db:
        yield db


def db_sistema() -> Iterator[Session]:
    """Dueño de la BD (sin RLS). Nunca en una ruta de usuario: lo vigila un test."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
