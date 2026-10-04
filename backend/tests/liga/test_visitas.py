"""Prueba visitas en LIGA_TEST_DATABASE_URL, sin acceder a Supabase de producción."""

from __future__ import annotations

import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

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
    from app.liga.visitas import router, router_admin

    clave = ec.generate_private_key(ec.SECP256R1())

    class JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: JWKS())

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    def cab(uid: str, session_id: uuid.UUID | None = None, aal: str = "aal1") -> dict:
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                  "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": aal}
        if session_id is not None:
            claims["session_id"] = str(session_id)
        token = jwt.encode(claims, clave, algorithm="ES256")
        return {"Authorization": f"Bearer {token}"}

    app = FastAPI()
    app.include_router(router, prefix="/liga")
    app.include_router(router_admin, prefix="/liga/admin")
    cliente = TestClient(app)
    cx = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []

    def usuario(admin: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                   (uid, f"{uid.hex[:12]}@prueba.local"))
        creados.append(uid)
        if admin:
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, 'admin')",
                       (uid,))
        return str(uid)

    try:
        yield cliente, cab, usuario, cx
    finally:
        for uid in creados:
            cx.execute("delete from liga.visitas where usuario_id = %s", (uid,))
            cx.execute("delete from liga.roles_usuario where usuario_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def test_restored_session_retries_and_devices_count_visits(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    uid = usuario()
    sesion_a = uuid.uuid4()
    sesion_b = uuid.uuid4()
    path = "/liga/visitas/actividad"

    assert cliente.post(path, headers=cab(uid, sesion_a)).status_code == 202
    # Un reintento y otra pestaña que comparten el mismo JWT siguen siendo la misma visita.
    assert cliente.post(path, headers=cab(uid, sesion_a)).status_code == 202
    total = cx.execute(
        "select count(*) from liga.visitas where usuario_id = %s", (uid,)
    ).fetchone()[0]
    assert total == 1

    # Otro dispositivo tiene un auth.session_id distinto y empieza su propia visita.
    assert cliente.post(path, headers=cab(uid, sesion_b)).status_code == 202
    total = cx.execute(
        "select count(*) from liga.visitas where usuario_id = %s", (uid,)
    ).fetchone()[0]
    assert total == 2

    sesion_c = uuid.uuid4()
    headers = cab(uid, sesion_c)
    with ThreadPoolExecutor(max_workers=8) as workers:
        respuestas = list(workers.map(lambda _: cliente.post(path, headers=headers), range(8)))
    assert all(r.status_code == 202 for r in respuestas)
    total = cx.execute(
        "select count(*) from liga.visitas where usuario_id = %s and session_id = %s",
        (uid, sesion_c),
    ).fetchone()[0]
    assert total == 1

    # Más de 30 minutos sin actividad en la sesión A abre una nueva visita sin esperar login.
    cx.execute("update liga.visitas set ultima_actividad = now() - interval '31 minutes' "
               "where usuario_id = %s and session_id = %s", (uid, sesion_a))
    assert cliente.post(path, headers=cab(uid, sesion_a)).status_code == 202
    total = cx.execute(
        "select count(*) from liga.visitas where usuario_id = %s", (uid,)
    ).fetchone()[0]
    # A now has a second visit; together with B and C, there are four visits.
    assert total == 4


def test_session_id_must_be_in_verified_jwt_and_summary_is_admin_only(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    normal = usuario()
    admin = usuario(admin=True)
    ruta = f"/liga/admin/usuarios/{normal}/visitas"

    assert cliente.post("/liga/visitas/actividad", headers=cab(normal)).status_code == 401
    assert cliente.get(ruta, headers=cab(normal, uuid.uuid4())).status_code == 404
    cab_admin = cab(admin, uuid.uuid4(), aal="aal2")
    r = cliente.get(ruta, headers=cab_admin)
    assert r.status_code == 200, r.text
    assert r.json() == {"visitas": 0, "ultima_visita": None, "ultima_actividad": None}

    assert cliente.post("/liga/visitas/actividad",
                        headers=cab(normal, uuid.uuid4())).status_code == 202
    historia = cliente.get(ruta + "/historial?desde=0&cuantos=10", headers=cab_admin)
    assert historia.status_code == 200, historia.text
    assert historia.json()["total"] == 1 and len(historia.json()["filas"]) == 1
    assert set(historia.json()["filas"][0]) == {"inicio", "ultima_actividad"}
