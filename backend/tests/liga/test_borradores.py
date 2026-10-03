"""Guardar y recuperar borradores privados contra Postgres local, sin llamadas de IA."""

from __future__ import annotations

import os
import time
import uuid

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"
ESCUDO = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68",
          "color2": "#FFFFFF", "iniciales": None}
RECETA = {"idea": None, "reglas": [], "excluidas": [], "pregunta": None,
          "pesos": {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
          "n_empresas": 5, "reparto": "igual", "max_por_sector": 0}
CONTENIDO = {"nombre": "", "idea": "", "etapa": 1, "escudo": ESCUDO, "receta": RECETA,
             "visibilidad": "privada", "declara_posiciones": None, "cada_dia_1": "revisar"}


@pytest.fixture
def api(monkeypatch):  # noqa: ANN001, ANN201
    psycopg = pytest.importorskip("psycopg")
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import auth, rutas_estrategias
    from app.liga import db as liga_db
    from app.liga.borradores import router as router_borradores

    clave = ec.generate_private_key(ec.SECP256R1())

    class JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: JWKS())
    monkeypatch.setattr(rutas_estrategias.moderacion, "evaluar_lista", lambda _texto: None)
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    def cab(uid: str) -> dict:
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                  "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": "aal1"}
        return {"Authorization": f"Bearer {jwt.encode(claims, clave, algorithm='ES256')}"}

    app = FastAPI()
    app.include_router(router_borradores, prefix="/liga")
    app.include_router(rutas_estrategias.router, prefix="/liga")
    cliente = TestClient(app)
    cx = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []

    def usuario() -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                   (uid, f"{uid.hex[:12]}@prueba.local"))
        creados.append(uid)
        return str(uid)

    try:
        yield cliente, cab, usuario, cx
    finally:
        for uid in creados:
            cx.execute("delete from liga.borradores where usuario_id = %s", (uid,))
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _crear_estrategia(cliente, cab, uid: str, nombre: str = "Foso ancho") -> str:  # noqa: ANN001
    respuesta = cliente.post("/liga/estrategias", json={"nombre": nombre, "escudo": ESCUDO},
                             headers=cab(uid))
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()["id"]


def _guardar(cliente, cab, uid: str, clave: str = "nueva", revision: int = 0) -> object:  # noqa: ANN001
    return cliente.put(f"/liga/borradores/{clave}",
                       json={"revision": revision, "contenido": CONTENIDO}, headers=cab(uid))


def test_restaurar_borrador_incompleto_y_controlar_conflictos(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    uid = usuario()

    vacio = cliente.get("/liga/borradores/nueva", headers=cab(uid))
    assert vacio.status_code == 200 and vacio.json() is None

    guardado = _guardar(cliente, cab, uid)
    assert guardado.status_code == 200, guardado.text
    assert guardado.json()["revision"] == 1
    assert guardado.json()["contenido"]["nombre"] == ""
    recuperado = cliente.get("/liga/borradores/nueva", headers=cab(uid))
    assert recuperado.status_code == 200
    assert recuperado.json()["contenido"] == guardado.json()["contenido"]

    # Una pestaña con una revisión vieja no pisa los cambios guardados desde otra.
    assert _guardar(cliente, cab, uid, revision=0).status_code == 409
    siguiente = _guardar(cliente, cab, uid, revision=1)
    assert siguiente.status_code == 200 and siguiente.json()["revision"] == 2

    # El contenido guardado es un borrador, no una estrategia ejecutable ni una receta SQL.
    n_estrategias = cx.execute(
        "select count(*) from liga.estrategias where dueno_id = %s", (uid,)
    ).fetchone()[0]
    n_recetas = cx.execute(
        "select count(*) from liga.recetas r join liga.estrategias e on e.id = r.estrategia_id "
        "where e.dueno_id = %s", (uid,)
    ).fetchone()[0]
    assert n_estrategias == 0 and n_recetas == 0


def test_borrador_y_estrategia_son_privados_y_vinculan_con_revision(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    dueno, otro = usuario(), usuario()
    estrategia = _crear_estrategia(cliente, cab, dueno)

    assert _guardar(cliente, cab, dueno).status_code == 200
    assert cliente.get(f"/liga/borradores/{estrategia}", headers=cab(otro)).status_code == 404
    assert cliente.post(f"/liga/borradores/nueva/vincular/{estrategia}?revision=1",
                        headers=cab(otro)).status_code == 404
    # El intento sobre la estrategia ajena no consume ni mueve el borrador del otro usuario.
    assert cliente.get("/liga/borradores/nueva", headers=cab(otro)).json() is None
    assert cliente.get("/liga/borradores/nueva", headers=cab(dueno)).json()["revision"] == 1

    # La revisión se compara antes de trasladar el borrador a la estrategia propia.
    assert cliente.post(f"/liga/borradores/nueva/vincular/{estrategia}?revision=2",
                        headers=cab(dueno)).status_code == 409
    vinculado = cliente.post(f"/liga/borradores/nueva/vincular/{estrategia}?revision=1",
                             headers=cab(dueno))
    assert vinculado.status_code == 204, vinculado.text
    assert cliente.get("/liga/borradores/nueva", headers=cab(dueno)).json() is None
    ficha = cliente.get(f"/liga/borradores/{estrategia}", headers=cab(dueno))
    assert ficha.status_code == 200 and ficha.json()["revision"] == 1
