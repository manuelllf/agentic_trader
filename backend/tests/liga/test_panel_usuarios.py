"""Prueba el panel de usuarios del admin con RLS y cifras exactas."""

from __future__ import annotations

import os
import time
import uuid
from decimal import Decimal

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"


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
    from app.liga import auth
    from app.liga import db as liga_db
    from app.liga.rutas import router as router_liga
    from app.liga.rutas_admin import router as router_admin
    from app.liga.rutas_gestion import router_moderacion

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    def token(uid: str, aal: str = "aal1") -> str:
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                 "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": aal}
        return jwt.encode(claims, clave, algorithm="ES256")

    def cab(uid: str, aal: str = "aal1") -> dict:
        return {"Authorization": f"Bearer {token(uid, aal)}"}

    app = FastAPI()
    app.include_router(router_liga)
    app.include_router(router_admin)
    app.include_router(router_moderacion)
    cliente = TestClient(app)

    cx = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []

    def usuario(rol: str | None = "usuario", pro: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creados.append(uid)
        if rol is not None and rol != "usuario":
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, %s)",
                      (uid, rol))
        if pro:
            cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                      "values (%s, 'pro', 'admin')", (uid,))
        return str(uid)

    try:
        yield cliente, cab, usuario, cx
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in creados:
            cx.execute("delete from liga.auditoria where actor_id = %s or "
                      "detalle::text like %s", (uid, f"%{uid}%"))
            cx.execute("delete from liga.reportes where autor_id = %s", (uid,))
            cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from liga.planes_usuario where usuario_id = %s", (uid,))
            cx.execute("delete from liga.roles_usuario where usuario_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        for uid in creados:
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()



def test_puertas_del_panel(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    normal, admin = usuario(), usuario(rol="admin")
    ruta = "/liga/admin/panel-usuarios"
    assert cliente.get(ruta, headers=cab(normal)).status_code == 404
    assert cliente.get(ruta, headers=cab(admin)).status_code == 403
    r = cliente.get(ruta, headers=cab(admin, aal="aal2"))
    assert r.status_code == 200, r.text


def test_ficha_con_cifras_exactas(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    jugador, admin = usuario(pro=True), usuario(rol="admin")
    otro = usuario()
    cx.execute("update liga.perfiles_privados set edad = 34 where id = %s", (jugador,))
    cx.execute("insert into liga.visitas (usuario_id, session_id, inicio, ultima_actividad) "
               "values (%s, gen_random_uuid(), now() - interval '2 hours', "
               "now() - interval '1 hour'), "
               "(%s, gen_random_uuid(), now() - interval '20 days', "
               "now() - interval '20 days' + interval '10 minutes')", (jugador, jugador))
    for accion, coste, cache, dias in (
        ("ia.conversor", "0.001", False, 0),
        ("ia.pregunta", "0.002", True, 0),
        ("ia.lectura", "0.004", False, 0),
        ("ia.conversor", "0.5", False, 40),
    ):
        cx.execute("insert into liga.auditoria (actor_id, accion, detalle, creada) "
                   "values (%s, %s, jsonb_build_object('coste_usd', %s::numeric, "
                   "'cache', %s::boolean), now() - %s * interval '1 day')",
                   (jugador, accion, coste, cache, dias))
    for motivo, importe in (("recarga", 200), ("prueba", -100),
                            ("lectura", -50), ("regalo", 10)):
        cx.execute("insert into liga.creditos_movimientos "
                   "(usuario_id, importe, motivo, idempotencia, creado) "
                   "values (%s, %s, %s, %s, now())",
                   (jugador, importe, motivo, f"panel-test-{motivo}"))
    for estado in ("jugando", "borrador"):
        cx.execute("insert into liga.estrategias "
                   "(dueno_id, nombre, forma, dibujo, color1, color2, estado) "
                   "values (%s, %s, 'circulo', 'liso', '#112233', '#445566', %s)",
                   (jugador, f"Panel {estado}", estado))
    cx.execute("insert into liga.ligas_privadas (dueno_id, nombre, codigo) "
               "values (%s, 'Liga panel', 'PANEL2K7')", (jugador,))
    liga = cx.execute("insert into liga.ligas_privadas (dueno_id, nombre, codigo) "
                      "values (%s, 'Otra liga', 'PANEL3K8') returning id", (otro,)).fetchone()[0]
    cx.execute("insert into liga.miembros_liga (liga_id, usuario_id) values (%s, %s)",
               (liga, jugador))
    for autor, objeto in ((jugador, otro), (otro, jugador)):
        cx.execute("insert into liga.reportes (autor_id, tipo, objeto_id, motivo) "
                   "values (%s, 'alias', %s, 'Alias inapropiado')", (autor, objeto))
    cx.execute("insert into liga.consentimientos (usuario_id, documento, version) "
               "values (%s, 'terminos', liga.version_terminos())", (jugador,))
    ruta = f"/liga/admin/panel-usuarios/{jugador}"
    respuesta = cliente.get(ruta, headers=cab(admin, aal="aal2"))
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.headers["Cache-Control"] == "no-store"
    r = respuesta.json()
    assert r["email"] == jugador.replace("-", "")[:12] + "@prueba.local"
    assert r["plan"] == "pro"
    assert r["edad"] == 34
    assert r["terminos"]["aceptado"] is True
    assert r["actividad"]["visitas_total"] == 2
    assert r["actividad"]["visitas_7d"] == 1
    assert r["actividad"]["tiempo_30d_seg"] == 4200
    mes = r["ia"]["mes"]
    assert mes["llamadas"] == 3
    assert mes["cache"] == 1
    assert Decimal(mes["total_usd"]) == Decimal("0.007")
    for finalidad in ("conversor", "pregunta", "lectura"):
        assert mes[f"{finalidad}_llamadas"] == 1
    assert Decimal(r["ia"]["historico_usd"]) == Decimal("0.507")
    assert Decimal(mes["cobrado_pregunta_usd"]) == Decimal("1.00")
    assert Decimal(mes["cobrado_lectura_usd"]) == Decimal("0.50")
    assert Decimal(mes["cobrado_usd"]) == Decimal("1.50")
    assert Decimal(r["saldo"]) == Decimal("60")
    assert r["liga"] == {
        "estrategias": 2, "estrategias_jugando": 1, "inscripciones": 0,
        "ligas_propias": 1, "ligas_miembro": 2, "reportes_hechos": 1,
        "reportes_recibidos": 1,
    }
    assert cliente.get(ruta, headers=cab(otro)).status_code == 404


def test_lista_filtros_orden_y_busqueda(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    jugadores = [usuario() for _ in range(3)]
    for jugador, visitas in zip(jugadores, (3, 1, 0), strict=True):
        for _ in range(visitas):
            cx.execute("insert into liga.visitas "
                       "(usuario_id, session_id, inicio, ultima_actividad) "
                       "values (%s, gen_random_uuid(), now(), now())", (jugador,))
    for jugador, edad in zip(jugadores[:2], (19, 16), strict=True):
        cx.execute("update liga.perfiles_privados set edad = %s where id = %s", (edad, jugador))
    ruta = "/liga/admin/panel-usuarios"
    a2 = cab(admin, aal="aal2")
    for indice, jugador in enumerate(jugadores):
        q = jugador.replace("-", "")[:12]
        for filtro, esperado in (("todas", True), ("activas", indice < 2),
                                  ("mayores18", indice == 0)):
            respuesta = cliente.get(ruta, params={"q": f"  {q}  ", "filtro": filtro}, headers=a2)
            assert respuesta.status_code == 200, respuesta.text
            r = respuesta.json()
            assert r["total"] == int(esperado)
            assert [f["id"] for f in r["filas"]] == ([jugador] if esperado else [])
    cx.execute("delete from liga.roles_usuario where usuario_id = %s and rol = 'usuario'",
               (jugadores[2],))
    for indice, jugador in enumerate(jugadores):
        r = cliente.get(ruta, params={"q": jugador.replace("-", "")[:12],
                                     "filtro": "suspendidas"}, headers=a2)
        assert r.status_code == 200, r.text
        assert r.json()["total"] == int(indice == 2)
    ids = []
    desde = 0
    while True:
        respuesta = cliente.get(ruta, params={"orden": "visitas_7d", "desc": True,
                                             "desde": desde, "cuantos": 100}, headers=a2)
        assert respuesta.status_code == 200, respuesta.text
        r = respuesta.json()
        ids.extend(f["id"] for f in r["filas"])
        desde += len(r["filas"])
        if desde >= r["total"]:
            break
        assert r["filas"]
    assert ids.index(jugadores[0]) < ids.index(jugadores[1]) < ids.index(jugadores[2])


def test_resumen_y_dias(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin, jugador = usuario(rol="admin"), usuario()
    a2 = cab(admin, aal="aal2")
    ruta = "/liga/admin/panel-usuarios"
    respuesta = cliente.get(f"{ruta}/resumen", headers=a2)
    assert respuesta.status_code == 200, respuesta.text
    antes = respuesta.json()
    assert set(antes) == {
        "cuentas", "nuevas_7d", "activas_7d", "visitas_7d", "pro_vigentes",
        "pases_vigentes", "ia_mes_usd", "cobrado_mes_usd", "tope_mensual_usd",
    }
    for clave, valor in antes.items():
        if clave == "tope_mensual_usd" and valor is None:
            continue
        assert Decimal(str(valor)).is_finite()
    cx.execute("insert into liga.visitas (usuario_id, session_id, inicio, ultima_actividad) "
               "values (%s, gen_random_uuid(), now(), now())", (jugador,))
    respuesta = cliente.get(f"{ruta}/resumen", headers=a2)
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["visitas_7d"] == antes["visitas_7d"] + 1
    cx.execute("insert into liga.visitas (usuario_id, session_id, inicio, ultima_actividad) "
               "values (%s, gen_random_uuid(), now() - interval '2 days', "
               "now() - interval '2 days')", (jugador,))
    respuesta = cliente.get(f"{ruta}/{jugador}/dias", params={"n": 14}, headers=a2)
    assert respuesta.status_code == 200, respuesta.text
    dias = respuesta.json()["dias"]
    assert len(dias) == 14
    assert dias[-1]["visitas"] == 1
    assert dias[11]["visitas"] == 1
    assert all(d["visitas"] == 0 for i, d in enumerate(dias) if i not in (11, 13))
    hoy = cx.execute("select (now() at time zone 'Europe/Madrid')::date").fetchone()[0]
    assert dias[-1]["dia"] == hoy.isoformat()


def test_ficha_inexistente(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    r = cliente.get(f"/liga/admin/panel-usuarios/{uuid.uuid4()}",
                    headers=cab(admin, aal="aal2"))
    assert r.status_code == 404
    assert r.json()["detail"] == "No existe ese usuario."
