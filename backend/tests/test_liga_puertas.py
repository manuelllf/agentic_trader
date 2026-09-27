"""Cada ruta de la liga declara su puerta y ninguna entra a la BD como sistema (plan §7.2 y §11).
Si una ruta se olvida la identidad, este test cae antes de que llegue a producción."""

from __future__ import annotations

from fastapi.routing import APIRoute, APIRouter

from app.db import get_db
from app.liga import auth, db
from app.liga.rutas import router
from app.liga.rutas_admin import router as router_admin
from app.liga.rutas_gestion import router_moderacion

PUERTAS = {db.db_anon, db.db_usuario, auth.require_usuario, auth.require_admin,
          auth.require_moderador}
PROHIBIDAS = {db.db_sistema, get_db}
# Públicas sin sesión de BD, cada una con su motivo. Nada entra aquí por comodidad.
SIN_PUERTA = {
    "/liga/entrar",  # aún no hay usuario: resuelve el alias en un servicio acotado y con límite
}


def _rutas(*routers: APIRouter) -> list:
    """Rutas propias y las de los routers anidados con `include_router` (FastAPI las guarda como
    `_IncludedRouter`, no como `APIRoute`, y su `dependant` hay que pedirlo ya fusionado con lo que
    se añadió al incluirlas, como el `dependencies=ADMIN` de `rutas_gestion`)."""
    vistas = []
    for r in routers:
        for ruta in r.routes:
            if isinstance(ruta, APIRoute):
                vistas.append(ruta)
            else:
                vistas.extend(ruta.effective_candidates())
    return vistas


def _llamadas(dependant) -> set:  # noqa: ANN001
    vistas = set()
    for dep in dependant.dependencies:
        vistas.add(dep.call)
        vistas |= _llamadas(dep)
    return vistas


def test_cada_ruta_tiene_puerta_y_ninguna_es_de_sistema() -> None:
    rutas = _rutas(router, router_admin, router_moderacion)
    assert rutas
    for r in rutas:
        llamadas = _llamadas(r.dependant)
        assert r.path in SIN_PUERTA or llamadas & PUERTAS, f"{r.path} no declara quién entra"
        assert not llamadas & PROHIBIDAS, f"{r.path} usa una sesión de sistema"


def test_los_procesos_solo_los_lanza_el_admin() -> None:
    """Los procesos corren como sistema por dentro, pero la ruta es solo del admin con 2FA."""
    rutas = _rutas(router_admin)
    assert rutas
    for r in rutas:
        llamadas = _llamadas(r.dependant)
        assert auth.require_admin in llamadas, f"{r.path} no exige admin"
        assert not llamadas & PROHIBIDAS, f"{r.path} usa una sesión de sistema"
