"""Cada ruta de la liga declara su puerta y ninguna entra a la BD como sistema (plan §7.2 y §11).
Si una ruta se olvida la identidad, este test cae antes de que llegue a producción."""

from __future__ import annotations

from fastapi.routing import APIRoute

from app.db import get_db
from app.liga import auth, db
from app.liga.rutas import router

PUERTAS = {db.db_anon, db.db_usuario, auth.require_usuario, auth.require_admin}
PROHIBIDAS = {db.db_sistema, get_db}


def _llamadas(dependant) -> set:  # noqa: ANN001
    vistas = set()
    for dep in dependant.dependencies:
        vistas.add(dep.call)
        vistas |= _llamadas(dep)
    return vistas


def test_cada_ruta_tiene_puerta_y_ninguna_es_de_sistema() -> None:
    rutas = [r for r in router.routes if isinstance(r, APIRoute)]
    assert rutas
    for r in rutas:
        llamadas = _llamadas(r.dependant)
        assert llamadas & PUERTAS, f"{r.path} no declara quién puede entrar"
        assert not llamadas & PROHIBIDAS, f"{r.path} usa una sesión de sistema"
