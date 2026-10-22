"""Solicitudes del usuario contra Postgres local, sin proveedor de IA."""

import json
import os
import uuid

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def api(monkeypatch):
    psycopg = pytest.importorskip("psycopg")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.liga import auth, rutas_intenciones

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    monkeypatch.setattr(rutas_intenciones, "fabrica_sistema", sessionmaker(bind=motor))
    monkeypatch.setattr(auth, "verificar",
                        lambda token: auth.Identidad(uid=token, aal="aal1", claims={}))
    app = FastAPI()
    app.include_router(rutas_intenciones.router)
    cx = psycopg.connect(URL, autocommit=True)
    uid = uuid.uuid4()
    prefijo = f"solicitud-{uuid.uuid4().hex}"
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
               (uid, f"{uid.hex[:12]}@prueba.local"))
    try:
        with TestClient(app) as cliente:
            yield cliente, {"Authorization": f"Bearer {uid}"}, cx, uid, prefijo
    finally:
        cx.execute("delete from liga.intenciones_sin_regla where intencion like %s",
                   (prefijo + "%",))
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def test_envio_anonimo_normaliza_y_respeta_idioma(api):
    from app.i18n import current_locale

    cliente, cab, cx, _uid, prefijo = api
    texto = f"{prefijo} inversión ética"
    token = current_locale.set("en")
    try:
        respuesta = cliente.post("/liga/intenciones",
                                 json={"texto": f"  {prefijo}\t inversión   ética \n"},
                                 headers=cab)
    finally:
        current_locale.reset(token)
    assert respuesta.status_code == 204, respuesta.text
    assert respuesta.content == b""
    fila = cx.execute("select origen, tipo, regla, creado_por, idioma "
                      "from liga.intenciones_sin_regla where intencion = %s",
                      (texto,)).fetchall()
    assert fila == [("usuario", "no_disponible", None, None, "en")]


def test_cuarto_envio_no_crea_fila_ni_auditoria(api):
    cliente, cab, cx, uid, prefijo = api
    for numero in range(4):
        respuesta = cliente.post("/liga/intenciones",
                                 json={"texto": f"{prefijo} {numero}"}, headers=cab)
        assert respuesta.status_code == (204 if numero < 3 else 429), respuesta.text
    assert cx.execute("select count(*) from liga.intenciones_sin_regla "
                      "where intencion like %s", (prefijo + "%",)).fetchone()[0] == 3
    assert cx.execute("select count(*) from liga.auditoria "
                      "where accion = 'intencion.solicitud' and actor_id = %s",
                      (uid,)).fetchone()[0] == 3


@pytest.mark.parametrize("texto", ["", "   \t\n", "x" * 161, "x" * 401])
def test_texto_invalido(api, texto):
    cliente, cab, cx, uid, _prefijo = api
    respuesta = cliente.post("/liga/intenciones", json={"texto": texto}, headers=cab)
    assert respuesta.status_code == 422
    assert cx.execute("select count(*) from liga.auditoria "
                      "where accion = 'intencion.solicitud' and actor_id = %s",
                      (uid,)).fetchone()[0] == 0


def test_sin_sesion(api):
    cliente, _cab, _cx, _uid, prefijo = api
    respuesta = cliente.post("/liga/intenciones", json={"texto": prefijo})
    assert respuesta.status_code == 401


def test_auditoria_solo_guarda_largo(api):
    cliente, cab, cx, uid, prefijo = api
    texto = f"{prefijo} energía ética"
    respuesta = cliente.post("/liga/intenciones", json={"texto": texto}, headers=cab)
    assert respuesta.status_code == 204, respuesta.text
    filas = cx.execute("select objeto, detalle from liga.auditoria "
                       "where accion = 'intencion.solicitud' and actor_id = %s",
                       (uid,)).fetchall()
    assert filas == [(None, {"largo": len(texto)})]
    assert texto not in json.dumps(filas, ensure_ascii=False)
