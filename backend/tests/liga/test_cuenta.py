"""`/liga/yo/exportar` y `DELETE /liga/yo` (plan §15, D17) contra el Postgres de pruebas (se salta
sin `LIGA_TEST_DATABASE_URL`). Mismo patrón que `test_rutas_estrategias.py`: JWT verificado como
el usuario, para que RLS decida de verdad quién ve qué. La llamada a Supabase Auth se simula
siempre (nunca se llama a la Supabase real); el `DELETE FROM auth.users` que haría Supabase se
repite a mano con la conexión de sistema para comprobar la cascada. Al final se borra todo lo que
quede."""

from __future__ import annotations

import os
import time
import uuid
from types import SimpleNamespace

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"
CLAVE_BUENA = "la-contrasena-buena"


def _baja(cliente, cab, uid: str, confirmacion: str, clave: str = CLAVE_BUENA):  # noqa: ANN001, ANN202
    cuerpo = {"confirmacion": confirmacion, "clave": clave}
    return cliente.request("DELETE", "/liga/yo", json=cuerpo, headers=cab(uid))


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
    from app.liga import auth, cuenta
    from app.liga import db as liga_db
    from app.liga.rutas import router

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth.settings, "supabase_secret_key", "sb_secret_prueba")
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())

    llamadas_supabase: list[str] = []

    def _delete_falso(url: str, headers: dict, timeout: float):  # noqa: ANN001, ARG001
        llamadas_supabase.append(url)
        assert "Authorization" not in headers, "sb_secret_ no va en Authorization: Bearer"
        return SimpleNamespace(status_code=204)

    monkeypatch.setattr(cuenta.httpx, "delete", _delete_falso)

    from app.liga import acceso
    from app.liga import rutas as rutas_liga

    # Supabase Auth simulado: solo acepta la contraseña buena.
    monkeypatch.setattr(acceso, "_pedir_sesion",
                        lambda _e, clave: {"access_token": "t"} if clave == CLAVE_BUENA else None)
    monkeypatch.setattr(rutas_liga, "_LIMITE_BAJA", acceso.LimiteFrecuencia(tope=5, ventana_s=60))

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    def token(uid: str, aal: str = "aal1") -> str:
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                 "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": aal}
        return jwt.encode(claims, clave, algorithm="ES256")

    def cab(uid: str) -> dict:
        return {"Authorization": f"Bearer {token(uid)}"}

    app = FastAPI()
    app.include_router(router)
    cliente = TestClient(app)

    cx = psycopg.connect(URL, autocommit=True)
    creado: dict[str, list] = {"usuarios": [], "estrategias": []}

    def usuario(alias: str, rol: str | None = None, pro: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creado["usuarios"].append(uid)
        # This fixture's system connection uses a non-superuser local role. Run the alias change
        # with the same verified owner claim as the real account endpoint, as the trigger requires.
        with cx.transaction():
            cx.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uid),))
            cx.execute("update liga.perfiles set alias = %s where id = %s", (alias, uid))
        if rol:
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, %s)",
                      (uid, rol))
        if pro:
            cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                      "values (%s, 'pro', 'demo')", (uid,))
        cx.execute("insert into liga.consentimientos (usuario_id, documento, version) "
                  "values (%s, 'terminos', 'v1')", (uid,))
        return str(uid)

    def existe(uid: str) -> bool:
        return cx.execute("select 1 from auth.users where id = %s", (uid,)).fetchone() is not None

    def borrar_de_verdad(uid: str) -> None:
        """Lo que haría Supabase tras el HTTP simulado: el `DELETE` real, con su cascada."""
        with cx.transaction():
            cx.execute("set local role postgres")
            cx.execute("delete from auth.users where id = %s", (uid,))

    try:
        yield cliente, cab, usuario, existe, borrar_de_verdad, llamadas_supabase, cx, creado
    finally:
        cx.execute("set session_replication_role = replica")
        for eid in creado["estrategias"]:
            cx.execute("update liga.estrategias set receta_id = null where id = %s", (eid,))
            cx.execute("delete from liga.recetas where estrategia_id = %s", (eid,))
        cx.execute("set session_replication_role = origin")
        for eid in creado["estrategias"]:
            cx.execute("delete from liga.estrategias where id = %s", (eid,))
        for uid in creado["usuarios"]:
            if existe(str(uid)):
                cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _crear_estrategia(cliente, cab, uid: str, nombre: str, creado: dict) -> str:  # noqa: ANN001
    escudo = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68", "color2": "#FFFFFF"}
    r = cliente.post("/liga/estrategias", json={"nombre": nombre, "escudo": escudo},
                     headers=cab(uid))
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    creado["estrategias"].append(eid)
    return eid


RECETA_BASICA = {
    "reglas": [], "excluidas": [], "pregunta": None,
    "pesos": {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
    "n_empresas": 5, "reparto": "igual", "max_por_sector": 0,
}


# ---- exportar: solo lo propio --------------------------------------------------------------------


def test_exportar_solo_trae_lo_propio(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_rest = api
    cx, creado = _rest[-2:]
    a = usuario("exporta_a")
    b = usuario("exporta_b")
    eid_a = _crear_estrategia(cliente, cab, a, "De A", creado)
    cliente.post(f"/liga/estrategias/{eid_a}/receta", json=RECETA_BASICA, headers=cab(a))
    eid_b = _crear_estrategia(cliente, cab, b, "De B", creado)
    from psycopg.types.json import Jsonb

    cx.execute("insert into liga.borradores (usuario_id, clave, contenido, revision) "
               "values (%s, 'nueva', %s, 3)", (a, Jsonb({"nombre": "En progreso"})))
    cx.execute("insert into liga.borradores (usuario_id, clave, contenido, revision) "
               "values (%s, 'nueva', %s, 2)", (b, Jsonb({"nombre": "Privado"})))
    revision = cliente.post("/liga/seguimiento/revisado", headers=cab(a), json={
        "items": [{"estrategia_id": eid_a, "inscripcion_id": None,
                   "resultado_inscripcion_id": None}],
    })
    assert revision.status_code == 200, revision.text
    revision_b = cliente.post("/liga/seguimiento/revisado", headers=cab(b), json={
        "items": [{"estrategia_id": eid_b, "inscripcion_id": None,
                   "resultado_inscripcion_id": None}],
    })
    assert revision_b.status_code == 200, revision_b.text

    visita_a, visita_b = uuid.uuid4(), uuid.uuid4()
    cx.execute("insert into liga.visitas (usuario_id, session_id) values (%s, %s), (%s, %s)",
               (a, visita_a, b, visita_b))

    r = cliente.get("/liga/yo/exportar", headers=cab(a))
    assert r.status_code == 200, r.text
    cuerpo = r.json()

    assert cuerpo["perfil"]["alias"] == "exporta_a"
    assert [e["id"] for e in cuerpo["estrategias"]] == [eid_a]
    assert len(cuerpo["recetas"]) == 1
    assert len(cuerpo["consentimientos"]) == 1
    assert [d["clave"] for d in cuerpo["borradores"]] == ["nueva"]
    assert cuerpo["borradores"][0]["revision"] == 3
    assert [v["estrategia_id"] for v in cuerpo["revisiones_estrategia"]] == [eid_a]
    assert len(cuerpo["visitas"]) == 1
    assert set(cuerpo["visitas"][0]) == {"inicio", "ultima_actividad"}

    r_b = cliente.get("/liga/yo/exportar", headers=cab(b))
    ids_b = [e["id"] for e in r_b.json()["estrategias"]]
    assert eid_a not in ids_b


# ---- baja: confirmación, admin y 503 sin clave -------------------------------------------------


def test_baja_con_confirmacion_equivocada_no_hace_nada(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, existe, _borrar, llamadas, *_ = api
    uid = usuario("baja_mal")
    r = _baja(cliente, cab, uid, "no-soy-yo")
    assert r.status_code == 422, r.text
    assert existe(uid)
    assert llamadas == []


def test_baja_con_contrasena_mala_o_sin_ella_no_hace_nada(api) -> None:  # noqa: ANN001
    """Una sesión robada no basta para borrar la cuenta: hay que saber la contraseña."""
    cliente, cab, usuario, existe, _borrar, llamadas, *_ = api
    uid = usuario("baja_clave")
    r = cliente.request("DELETE", "/liga/yo", json={"confirmacion": "baja_clave", "clave": "otra"},
                        headers=cab(uid))
    assert r.status_code == 403, r.text
    r = cliente.request("DELETE", "/liga/yo", json={"confirmacion": "baja_clave"}, headers=cab(uid))
    assert r.status_code == 422, r.text
    assert existe(uid)
    assert llamadas == []


def test_probar_contrasenas_en_la_baja_tiene_tope(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, existe, _borrar, llamadas, *_ = api
    uid = usuario("baja_tope")
    cuerpo = {"confirmacion": "baja_tope", "clave": "otra"}
    codigos = [cliente.request("DELETE", "/liga/yo", json=cuerpo, headers=cab(uid)).status_code
               for _ in range(6)]
    assert codigos == [403] * 5 + [429]
    assert existe(uid) and llamadas == []


def test_admin_no_puede_darse_de_baja_a_si_mismo(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, existe, _borrar, llamadas, *_ = api
    uid = usuario("baja_admin", rol="admin")
    r = _baja(cliente, cab, uid, "baja_admin")
    assert r.status_code == 409, r.text
    assert existe(uid)
    assert llamadas == []


def test_baja_sin_clave_secreta_responde_503(api, monkeypatch) -> None:  # noqa: ANN001
    from app.liga import auth

    monkeypatch.setattr(auth.settings, "supabase_secret_key", "")
    cliente, cab, usuario, existe, _borrar, llamadas, *_ = api
    uid = usuario("baja_sin_clave")
    r = _baja(cliente, cab, uid, "baja_sin_clave")
    assert r.status_code == 503, r.text
    assert existe(uid)
    assert llamadas == []


def test_borrar_la_cuenta_retira_y_oculta_sus_estrategias_que_jugaban(api) -> None:  # noqa: ANN001
    """Sin esto la estrategia huérfana seguiría inscribiéndose cada jornada (y pagando su pregunta)
    y, si era pública, seguiría enseñando sus reglas a los Pro."""
    cliente, cab, usuario, existe, borrar_de_verdad, _llamadas, cx, creado = api
    uid = usuario("baja_juega", pro=True)
    eid = _crear_estrategia(cliente, cab, uid, "Jugaba", creado)
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=RECETA_BASICA, headers=cab(uid))
    assert r.status_code == 201, r.text
    borrador = _crear_estrategia(cliente, cab, uid, "Sin apuntar", creado)
    with cx.transaction():
        cx.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))
        cx.execute("update liga.estrategias set estado = 'apuntada', visibilidad = 'publicada', "
                   "declara_posiciones = 'no', receta_id = (select max(id) from liga.recetas "
                   "where estrategia_id = %s) where id = %s", (eid, eid))

    borrar_de_verdad(uid)
    assert not existe(uid)

    jugaba = cx.execute("select estado, visibilidad, dueno_id from liga.estrategias where id = %s",
                        (eid,)).fetchone()
    assert jugaba == ("retirada", "privada", None)
    sin_apuntar = cx.execute("select estado, visibilidad from liga.estrategias where id = %s",
                             (borrador,)).fetchone()
    assert sin_apuntar == ("borrador", "privada")


def test_baja_feliz_deja_la_estrategia_retirada_y_borra_lo_personal(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, existe, borrar_de_verdad, llamadas, cx, creado = api
    uid = usuario("baja_bien", pro=True)
    eid = _crear_estrategia(cliente, cab, uid, "Se queda", creado)
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=RECETA_BASICA, headers=cab(uid))
    assert r.status_code == 201, r.text

    r = _baja(cliente, cab, uid, "baja_bien")
    assert r.status_code == 204, r.text
    assert len(llamadas) == 1 and uid in llamadas[0]

    auditoria = cx.execute(
        "select accion, actor_id, detalle from liga.auditoria where accion = 'cuenta.baja' "
        "and actor_id = %s", (uid,)).fetchone()
    assert auditoria is not None and auditoria[2] == {}

    # El HTTP a Supabase está simulado: aquí se repite el `DELETE` real que haría Supabase,
    # para comprobar que la cascada de la BD deja lo que dice el plan (D17).
    borrar_de_verdad(uid)
    assert not existe(uid)

    fila = cx.execute("select dueno_id from liga.estrategias where id = %s", (eid,)).fetchone()
    assert fila is not None and fila[0] is None  # «Estrategia retirada»
    assert cx.execute("select 1 from liga.recetas where estrategia_id = %s",
                      (eid,)).fetchone() is not None
    assert cx.execute("select 1 from liga.perfiles where id = %s", (uid,)).fetchone() is None
    assert cx.execute("select 1 from liga.planes_usuario where usuario_id = %s",
                      (uid,)).fetchone() is None
    assert cx.execute("select 1 from liga.consentimientos where usuario_id = %s",
                      (uid,)).fetchone() is None
