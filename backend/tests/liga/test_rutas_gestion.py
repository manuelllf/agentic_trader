"""Admin (usuarios, créditos, ajustes, auditoría) y moderación, contra el Postgres de pruebas (se
salta sin `LIGA_TEST_DATABASE_URL`). Mismo patrón que `test_rutas_estrategias.py`: JWT verificado de
verdad, para que RLS y `require_admin`/`require_moderador` decidan. Al final se borra todo."""

from __future__ import annotations

import os
import time
import uuid

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
    app.include_router(router_admin)
    app.include_router(router_moderacion)
    cliente = TestClient(app)

    cx = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []

    def usuario(rol: str | None = "usuario", pro: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
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


# ---- puertas: quién entra ------------------------------------------------------------------------


def test_no_admin_404_admin_sin_2fa_403(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    normal = usuario()
    admin_uid = usuario(rol="admin")

    assert cliente.get("/liga/admin/usuarios", headers=cab(normal)).status_code == 404
    assert cliente.get("/liga/admin/usuarios", headers=cab(admin_uid)).status_code == 403
    r = cliente.get("/liga/admin/usuarios", headers=cab(admin_uid, aal="aal2"))
    assert r.status_code == 200, r.text


def test_moderador_entra_normal_no(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    normal = usuario()
    moderador = usuario(rol="moderador")

    assert cliente.get("/liga/moderacion/reportes", headers=cab(normal)).status_code == 404
    r = cliente.get("/liga/moderacion/reportes", headers=cab(moderador))
    assert r.status_code == 200, r.text


# ---- usuarios: listar, ver, rol, plan, suspender -------------------------------------------------


def test_listar_y_ver_usuario(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    jugador = usuario(pro=True)

    r = cliente.get("/liga/admin/usuarios", params={"cuantos": 100},
                    headers=cab(admin, aal="aal2"))
    assert r.status_code == 200
    ids = {f["id"] for f in r.json()["filas"]}
    assert jugador in ids

    r = cliente.get(f"/liga/admin/usuarios/{jugador}", headers=cab(admin, aal="aal2"))
    assert r.status_code == 200
    detalle = r.json()
    assert detalle["plan"] == "pro" and detalle["suspendido"] is False
    assert detalle["saldo"] == "0"


def test_rol_plan_y_suspender_tienen_efecto_inmediato(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    jugador = usuario()
    a2 = cab(admin, aal="aal2")

    r = cliente.post(f"/liga/admin/usuarios/{jugador}/rol",
                     json={"rol": "moderador", "conceder": True}, headers=a2)
    assert r.status_code == 200 and "moderador" in r.json()["roles"], r.text

    r = cliente.post(f"/liga/admin/usuarios/{jugador}/plan", json={"hasta": None}, headers=a2)
    assert r.status_code == 200 and r.json()["plan"] == "pro"

    r = cliente.post(f"/liga/admin/usuarios/{jugador}/plan/quitar", headers=a2)
    assert r.status_code == 200 and r.json()["plan"] == "gratis"

    r = cliente.post(f"/liga/admin/usuarios/{jugador}/suspender", json={"suspendido": True},
                     headers=a2)
    assert r.status_code == 200 and r.json()["suspendido"] is True

    # Se ve en la siguiente petición: no hay caché de rol/plan en el token.
    r = cliente.get(f"/liga/admin/usuarios/{jugador}", headers=a2)
    assert r.json()["suspendido"] is True and "moderador" in r.json()["roles"]

    r = cliente.post(f"/liga/admin/usuarios/{jugador}/suspender", json={"suspendido": False},
                     headers=a2)
    assert r.json()["suspendido"] is False


# ---- créditos: conceder es idempotente -----------------------------------------------------------


def test_otorgar_creditos_es_idempotente(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    jugador = usuario()
    a2 = cab(admin, aal="aal2")
    cuerpo = {"usuario_id": jugador, "importe": "5.00", "motivo": "regalo",
             "idempotencia": "prueba-regalo-1"}

    r1 = cliente.post("/liga/admin/creditos", json=cuerpo, headers=a2)
    assert r1.status_code == 201, r1.text
    r2 = cliente.post("/liga/admin/creditos", json=cuerpo, headers=a2)
    assert r2.status_code == 201 and r2.json()["id"] == r1.json()["id"]

    r = cliente.get("/liga/admin/creditos", params={"usuario_id": jugador}, headers=a2)
    assert r.status_code == 200 and r.json()["total"] == 1


# ---- ajustes: solo claves conocidas --------------------------------------------------------------


def test_ajustes_solo_claves_conocidas(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")

    r = cliente.put("/liga/admin/ajustes/creditos.pro_mensual", json={"valor": 2.5}, headers=a2)
    assert r.status_code == 200 and r.json()["valor"] == 2.5

    r = cliente.put("/liga/admin/ajustes/lo.que.sea", json={"valor": True}, headers=a2)
    assert r.status_code == 422

    cx.execute("delete from liga.ajustes where clave = 'creditos.pro_mensual'")


# ---- auditoría: lo que hicieron las rutas de arriba queda apuntado -------------------------------


def test_auditoria_registra_los_cambios_de_admin(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    jugador = usuario()
    a2 = cab(admin, aal="aal2")
    cliente.post(f"/liga/admin/usuarios/{jugador}/suspender", json={"suspendido": True},
                headers=a2)

    r = cliente.get("/liga/admin/auditoria", params={"accion_prefix": "admin.rol"}, headers=a2)
    assert r.status_code == 200
    assert any(f["objeto"] == f"usuario:{jugador}" for f in r.json()["filas"])


# ---- moderación: reportes y ocultar --------------------------------------------------------------


def test_moderador_oculta_una_estrategia_reportada(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    moderador = usuario(rol="moderador")
    autor = usuario()
    denunciante = usuario()

    # Moderación no toca borradores (RLS): tiene que estar apuntada para poder ocultarla.
    eid = cx.execute(
        "insert into liga.estrategias (nombre, forma, dibujo, color1, color2, dueno_id, estado) "
        "values ('Ofensiva', 'escudo', 'liso', '#0B6E68', '#FFFFFF', %s, 'apuntada') returning id",
        (autor,)).fetchone()[0]
    rid = cx.execute(
        "insert into liga.reportes (autor_id, tipo, objeto_id, motivo) values "
        "(%s, 'estrategia', %s, 'Nombre ofensivo') returning id",
        (denunciante, str(eid))).fetchone()[0]

    r = cliente.get("/liga/moderacion/reportes", headers=cab(moderador))
    assert r.status_code == 200
    assert any(f["id"] == rid for f in r.json()["filas"])

    r = cliente.post("/liga/moderacion/ocultar", json={"reporte_id": rid}, headers=cab(moderador))
    assert r.status_code == 200 and r.json()["estado"] == "resuelto"

    oculta = cx.execute("select oculta from liga.estrategias where id = %s", (eid,)).fetchone()[0]
    assert oculta is True

    # Ya no sale entre los pendientes.
    r = cliente.get("/liga/moderacion/reportes", headers=cab(moderador))
    assert rid not in {f["id"] for f in r.json()["filas"]}

    cx.execute("delete from liga.reportes where id = %s", (rid,))
    cx.execute("delete from liga.estrategias where id = %s", (eid,))
