"""Identidad de la liga: verificación del JWT de Supabase y llave de admin (rol en BD + 2FA).

La firma se prueba con una clave EC propia en lugar del JWKS real (sin red). La parte que consulta
la BD corre contra el Postgres de pruebas de la liga y se salta sin `LIGA_TEST_DATABASE_URL`.
"""

from __future__ import annotations

import os
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app import auth as auth_salas
from app.liga import auth

EMISOR = "https://proyecto.supabase.co"
CLAVE = ec.generate_private_key(ec.SECP256R1())


class _JWKS:
    def get_signing_key_from_jwt(self, _token: str):  # noqa: ANN202
        return type("Clave", (), {"key": CLAVE.public_key()})()


@pytest.fixture(autouse=True)
def _proyecto(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())


def _token(clave=CLAVE, alg: str = "ES256", **cambios) -> str:  # noqa: ANN001
    ahora = int(time.time())
    claims = {"sub": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated",
              "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": "aal1"}
    claims.update(cambios)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, clave, algorithm=alg)


def _codigo(token: str) -> int:
    with pytest.raises(HTTPException) as e:
        auth.verificar(token)
    return e.value.status_code


def test_un_token_bueno_da_su_identidad() -> None:
    uid = str(uuid.uuid4())
    ident = auth.verificar(_token(sub=uid, aal="aal2"))
    assert (ident.uid, ident.aal, ident.claims["sub"]) == (uid, "aal2", uid)


def test_caducado_audiencia_emisor_o_rol_ajenos_no_valen() -> None:
    assert _codigo(_token(exp=int(time.time()) - 120)) == 401
    assert _codigo(_token(aud="otra")) == 401
    assert _codigo(_token(iss="https://otro.supabase.co/auth/v1")) == 401
    assert _codigo(_token(role="anon")) == 401
    assert _codigo(_token(sub=None)) == 401


def test_la_firma_tiene_que_ser_la_del_proyecto() -> None:
    assert _codigo(_token(clave=ec.generate_private_key(ec.SECP256R1()))) == 401
    # Confusión de algoritmo: un HS256 no entra aunque traiga claims perfectos.
    assert _codigo(_token(clave="secreto-cualquiera-de-32-bytes!!", alg="HS256")) == 401
    assert _codigo("no.es.jwt") == 401


def test_sin_proyecto_configurado_no_hay_cuentas(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(auth.settings, "supabase_url", "")
    assert _codigo(_token()) == 503


def test_sin_cabecera_es_anonimo_y_con_token_malo_401() -> None:
    assert auth.identidad_opcional("") is None
    with pytest.raises(HTTPException) as e:
        auth.require_usuario(None)
    assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:
        auth.identidad_opcional("Bearer basura.basura.basura")
    assert e.value.status_code == 401


def test_las_salas_abren_con_la_sesion_de_admin_y_con_nada_mas(monkeypatch) -> None:  # noqa: ANN001
    vistos = []
    monkeypatch.setattr(auth_salas, "comprobar_admin", lambda ident: vistos.append(ident.uid))
    uid = str(uuid.uuid4())
    auth_salas.require_auth(f"Bearer {_token(sub=uid, aal='aal2')}")
    assert vistos == [uid]
    # El token de la antigua contraseña (`ts.firma`) ya no abre nada.
    with pytest.raises(HTTPException) as e:
        auth_salas.require_auth("Bearer 1790000000.abcdef0123456789")
    assert e.value.status_code == 401


def test_quien_no_es_admin_no_entra_a_las_salas(monkeypatch) -> None:  # noqa: ANN001
    def no_admin(_ident):  # noqa: ANN001, ANN202
        raise HTTPException(404, "Not Found")

    monkeypatch.setattr(auth_salas, "comprobar_admin", no_admin)
    with pytest.raises(HTTPException) as e:
        auth_salas.require_auth(f"Bearer {_token()}")
    assert e.value.status_code == 404
    assert auth_salas.auth_optional(f"Bearer {_token()}") is False


# ---- la llave de admin contra la BD --------------------------------------------------------------

URL = os.environ.get("LIGA_TEST_DATABASE_URL")


@pytest.fixture
def bd(monkeypatch):  # noqa: ANN001, ANN201
    if not URL:
        pytest.skip("Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")
    psycopg = pytest.importorskip("psycopg")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import db as liga_db

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    # Los servicios de sistema (p. ej. `limites`, plan §14) abren su sesión con
    # `app.db.SessionLocal` directamente (`fabrica_sistema`), no con la de `app.liga.db`.
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    cx = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []

    def usuario(rol: str = "usuario") -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                   (uid, f"{uid.hex[:12]}@prueba.local"))
        if rol != "usuario":
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, %s)",
                       (uid, rol))
        creados.append(uid)
        return str(uid)

    try:
        yield usuario
    finally:
        # `liga.auditoria` es de solo añadir (disparador `solo_anadir`): un cambio de alias deja
        # una fila que sobrevive a la baja del usuario (`actor_id` no lleva FK, plan §15).
        cx.execute("set session_replication_role = replica")
        for uid in creados:
            cx.execute("delete from liga.auditoria where actor_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        for uid in creados:
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _ident(uid: str, aal: str) -> auth.Identidad:
    return auth.Identidad(uid=uid, aal=aal,
                          claims={"sub": uid, "role": "authenticated", "aal": aal})


def test_admin_con_2fa_entra_sin_2fa_403_y_el_resto_404(bd) -> None:  # noqa: ANN001
    admin, moderador, usuario = bd("admin"), bd("moderador"), bd()
    assert auth.comprobar_admin(_ident(admin, "aal2")).uid == admin
    for uid, aal, codigo in ((admin, "aal1", 403), (moderador, "aal2", 404),
                             (usuario, "aal2", 404)):
        with pytest.raises(HTTPException) as e:
            auth.comprobar_admin(_ident(uid, aal))
        assert e.value.status_code == codigo


def test_yo_dice_quien_eres_y_si_ves_el_panel(bd) -> None:  # noqa: ANN001
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.liga.rutas import router

    app = FastAPI()
    app.include_router(router)
    cliente = TestClient(app)
    admin, usuario = bd("admin"), bd()

    r = cliente.get("/liga/yo", headers={"Authorization": f"Bearer {_token(sub=usuario)}"})
    assert r.status_code == 200
    assert r.json() == {"alias": f"jugador_{usuario.replace('-', '')[:12]}", "plan": "gratis",
                        "roles": ["usuario"], "admin": False, "aal2": False}
    r = cliente.get("/liga/yo", headers={"Authorization": f"Bearer {_token(sub=admin)}"})
    assert (r.json()["admin"], r.json()["aal2"], r.json()["roles"]) == \
        (True, False, ["usuario", "admin"])
    assert cliente.get("/liga/yo").status_code == 401

    # Cambiar el alias: la BD decide formato, reservados y unicidad.
    cab = {"Authorization": f"Bearer {_token(sub=usuario)}"}
    nuevo = f"nuevo_{usuario[:6]}"
    r = cliente.patch("/liga/yo", json={"alias": f"  {nuevo.upper()} "}, headers=cab)
    assert (r.status_code, r.json()["alias"]) == (200, nuevo)
    assert cliente.patch("/liga/yo", json={"alias": "a b"}, headers=cab).status_code == 422
    assert cliente.patch("/liga/yo", json={"alias": "alpha"}, headers=cab).status_code == 422
    assert cliente.patch("/liga/yo", json={"alias": "admin"}, headers=cab).status_code == 422
    otro = bd()
    r = cliente.patch("/liga/yo", json={"alias": nuevo},
                      headers={"Authorization": f"Bearer {_token(sub=otro)}"})
    assert r.status_code == 409


def test_la_sesion_de_usuario_es_su_usuario_en_postgres(bd) -> None:  # noqa: ANN001
    from sqlalchemy import text

    from app.liga.db import sesion_como

    uid = bd()
    with sesion_como(_ident(uid, "aal1")) as db:
        assert db.execute(text("select current_user, auth.uid()::text")).one() == \
            ("authenticated", uid)
        assert db.execute(text("select count(*) from liga.roles_usuario")).scalar() == 1
    with sesion_como(None) as db:
        assert db.execute(text("select current_user")).scalar() == "anon"
