from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.liga import auth
from app.liga import rutas_publicas as rp
from app.liga.auth import Identidad


@pytest.fixture
def cliente(monkeypatch):
    filas = [SimpleNamespace(
        eid=eid, nombre=nombre, casa_clave=casa, alias=autor,
        forma="circulo", dibujo="liso", color1="#000000", color2="#ffffff",
        iniciales=None, puntos=3, jornadas=1, ganadas=1, empatadas=0, perdidas=0,
        dif_sp=Decimal("1"), rentabilidad=Decimal("2"), iid=i, pos=i + 1,
    ) for i, (eid, nombre, casa, autor) in enumerate([
        ("00000000-0000-0000-0000-000000000002", "Alpha", "alpha", None),
        ("00000000-0000-0000-0000-000000000001", "Una", None, "ana"),
    ])]

    class Db:
        def execute(self, *_args, **_kwargs):
            return SimpleNamespace(all=lambda: filas, scalar_one=lambda: len(filas),
                                   one_or_none=lambda: None)

    temporada = rp.TemporadaOut(
        id=1, nombre="Liga", cuenta=True, estado="cerrada", n_jornadas=1)
    jornada = rp.JornadaOut(
        id=1, temporada_id=1, numero=1, dia_inicio=date(2026, 9, 1),
        dia_fin=date(2026, 9, 30), cierre_inscripcion=datetime(2026, 9, 1, tzinfo=UTC),
        estado="cerrada", sp_rentabilidad=Decimal("1"))
    monkeypatch.setattr(rp, "_clasificacion_viva_activa", lambda: True)
    monkeypatch.setattr(rp, "_temporada", lambda *_a: temporada)
    monkeypatch.setattr(rp, "_jornada", lambda _db, where, *_a:
                        jornada if where in ("id = :j", "estado = 'cerrada'") else None)
    monkeypatch.setattr(rp, "retornos_acumulados", lambda *_a: {})
    monkeypatch.setattr(rp, "movimientos_clasificacion", lambda *_a: {})
    monkeypatch.setattr(rp.gestion, "registro_abierto", lambda: True)
    monkeypatch.setattr(rp.estrategias, "contar_apuntadas", lambda: 0)
    app = FastAPI()
    app.include_router(rp.router)
    app.dependency_overrides[rp.db_anon] = lambda: Db()
    app.dependency_overrides[rp.exigir_visible] = lambda: None
    with TestClient(app) as client:
        yield client, app, filas


@pytest.mark.parametrize("con_sesion", [False, True])
@pytest.mark.parametrize("ruta", [
    "/publico/clasificacion?orden=rentabilidad&cuantos=1&alias=ana",
    "/publico/clasificacion?orden=puntos&cuantos=1&alias=ana",
    "/publico/jornada/1", "/publico/portada",
])
def test_uuid_solo_con_sesion(cliente, con_sesion, ruta):
    client, app, originales = cliente
    ident = Identidad(uid="usuario", aal="aal1", claims={}) if con_sesion else None
    app.dependency_overrides[auth.identidad_opcional] = lambda: ident
    respuesta = client.get(ruta)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    if ruta == "/publico/portada":
        datos = datos["ultima_cerrada"]
    filas = datos["filas"] + datos.get("mias", [])
    assert filas
    for fila in filas:
        equipo = fila["equipo"]
        original = next(f for f in originales if f.nombre == equipo["nombre"])
        esperado = {
            "id": original.eid if con_sesion else None,
            "nombre": original.nombre, "casa": original.casa_clave, "autor": original.alias,
            "escudo": {"forma": "circulo", "dibujo": "liso", "color1": "#000000",
                       "color2": "#ffffff", "iniciales": None},
        }
        assert equipo == esperado
        assert equipo["autor"] == original.alias
        assert equipo["casa"] == original.casa_clave
        assert fila["puntos"] == original.puntos


@pytest.mark.parametrize("ruta", [
    "/publico/clasificacion", "/publico/jornada/1", "/publico/portada",
])
def test_token_malo_responde_401(cliente, monkeypatch, ruta):
    client, _app, _filas = cliente

    def clave_invalida(_token):
        raise jwt.InvalidTokenError("token malo")

    monkeypatch.setattr(auth, "_emisor", lambda: "https://ejemplo.invalid/auth/v1")
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: SimpleNamespace(
        get_signing_key_from_jwt=clave_invalida))
    assert client.get(ruta, headers={"Authorization": "Bearer malo"}).status_code == 401
