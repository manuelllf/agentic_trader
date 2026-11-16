"""La campana del admin: `avisar` guarda el aviso, las rutas del panel lo leen con la RLS del admin
con 2FA y la del servicio del agente entra con clave. Contra Postgres con el esquema de CI; sin
`LIGA_TEST_DATABASE_URL` se saltan los que tocan la base."""

from __future__ import annotations

import json
import os
import uuid
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app import avisos_admin
from app.config import settings
from app.liga import auth
from app.liga.auth import Identidad

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
con_bd = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
pytestmark = pytest.mark.guarda_avisos
CLAVE = "clave-de-servicio-de-pruebas"


@pytest.fixture
def bd(monkeypatch):
    """Conexión de sistema y las sesiones de la app apuntando a la misma base; limpia la tabla."""
    psycopg = pytest.importorskip("psycopg")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import db as liga_db

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1),
                          connect_args={"connect_timeout": 5,
                                        "options": "-c statement_timeout=10000"})
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    cx = psycopg.connect(URL, autocommit=True, connect_timeout=5,
                         options="-c statement_timeout=10000")
    cx.execute("delete from liga.avisos_admin")
    usuarios: list[uuid.UUID] = []

    def usuario(rol: str = "usuario") -> uuid.UUID:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) "
                   "values (%s, %s, now())", (uid, f"{uid.hex[:12]}@prueba.local"))
        if rol != "usuario":
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s, %s)",
                       (uid, rol))
        usuarios.append(uid)
        return uid

    cx.usuario = usuario
    try:
        yield cx
    finally:
        cx.execute("reset role")
        cx.execute("delete from liga.avisos_admin")
        for uid in usuarios:
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _como(cx, uid: uuid.UUID, aal: str = "aal2") -> None:
    cx.execute("select set_config('request.jwt.claims', %s, false)",
               (json.dumps({"sub": str(uid), "role": "authenticated", "aal": aal}),))
    cx.execute("set role authenticated")


def _sistema(cx) -> None:
    cx.execute("reset role")


def _sembrar(cx, n: int = 1) -> list[int]:
    return [cx.execute("insert into liga.avisos_admin (tipo, sala, datos) "
                       "values ('omega_nuevas', 'omega', '{\"count\": 2}') returning id"
                       ).fetchone()[0] for _ in range(n)]


@pytest.fixture
def push_falso(monkeypatch) -> list:  # noqa: ANN001
    """Sin correo y con el push recogido en una lista, sin red."""
    monkeypatch.setattr(settings, "resend_api_key", "")
    enviados: list = []
    resumen = {"total": 1, "ok": 1, "baja": 0, "error": 0, "endpoints": set()}
    monkeypatch.setattr("app.push.enviar_a_todos",
                        lambda db, **kw: enviados.append(kw) or resumen)
    monkeypatch.setattr("app.push.enviar_a_admins_liga", lambda *a, **kw:
                        {"total": 0, "ok": 0, "baja": 0, "error": 0, "endpoints": set()})
    monkeypatch.setattr("app.liga.procesos.comun.auditar", lambda *a, **kw: None)
    return enviados


# ---- guardar al avisar ---------------------------------------------------------------------

@con_bd
@pytest.mark.parametrize(("tipo", "sala"), [
    ("omega_nuevas", "omega"), ("ia_tope_80", "vennett"),
    ("agente_decision", "alphagentic"), ("otro_tipo", "vennett"),
])
def test_avisar_guarda_la_fila_con_su_sala(bd, push_falso, tipo, sala) -> None:  # noqa: ANN001
    avisos_admin.avisar(Mock(), tipo, title="t", body="b", url="/admin", tag="x",
                        filas=[("AAOI", "suelo")], count=2)
    fila = bd.execute("select tipo, sala, datos, leido_en from liga.avisos_admin").fetchall()
    assert len(fila) == 1
    assert fila[0][:2] == (tipo, sala)
    assert fila[0][2] == {"count": 2, "filas": [["AAOI", "suelo"]]}
    assert fila[0][3] is None


def test_si_guardar_falla_el_push_sigue(monkeypatch, push_falso, caplog) -> None:  # noqa: ANN001
    def roto():
        raise RuntimeError("sin base")

    monkeypatch.setattr("app.liga.procesos.comun.fabrica_sistema", roto)
    n = avisos_admin.avisar(Mock(), "omega_prueba", title="t", body="b", url="/admin",
                            tag="x")
    assert n == 1
    assert len(push_falso) == 1
    assert "No se pudo guardar el aviso del admin" in caplog.text


@con_bd
def test_la_tabla_rechaza_tipo_sala_y_datos_fuera_de_formato(bd) -> None:  # noqa: ANN001
    import psycopg

    for tipo, sala, datos in [("Mal Tipo", "omega", "{}"), ("ok", "marte", "{}"),
                              ("ok", "omega", json.dumps({"x": "a" * 2100}))]:
        with pytest.raises(psycopg.errors.CheckViolation):
            bd.execute("insert into liga.avisos_admin (tipo, sala, datos) "
                       "values (%s, %s, %s::jsonb)", (tipo, sala, datos))


# ---- RLS por rol ---------------------------------------------------------------------------

@con_bd
def test_solo_el_admin_con_2fa_lee_y_marca(bd) -> None:  # noqa: ANN001
    admin, jugador = bd.usuario("admin"), bd.usuario()
    ids = _sembrar(bd)
    visible = "select count(*) from liga.avisos_admin"
    marca = "update liga.avisos_admin set leido_en = now(), leido_por = %s where id = %s"

    _como(bd, admin, "aal2")
    assert bd.execute(visible).fetchone()[0] == 1
    _como(bd, admin, "aal1")
    assert bd.execute(visible).fetchone()[0] == 0
    assert bd.execute(marca + " returning id", (admin, ids[0])).fetchall() == []
    _como(bd, jugador, "aal2")
    assert bd.execute(visible).fetchone()[0] == 0
    assert bd.execute(marca + " returning id", (jugador, ids[0])).fetchall() == []
    _como(bd, admin, "aal2")
    assert bd.execute(marca + " returning id", (admin, ids[0])).fetchall() == [(ids[0],)]
    _sistema(bd)
    assert bd.execute("select leido_por, actualizado_en is not null from liga.avisos_admin"
                      ).fetchone() == (admin, True)


@con_bd
def test_ningun_authenticated_inserta_ni_borra(bd) -> None:  # noqa: ANN001
    import psycopg

    admin = bd.usuario("admin")
    _sembrar(bd)
    _como(bd, admin)
    for sql in ("insert into liga.avisos_admin (tipo, sala) values ('x', 'omega')",
                "delete from liga.avisos_admin",
                "update liga.avisos_admin set tipo = 'otro'"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            bd.execute(sql)


# ---- rutas del panel ------------------------------------------------------------------------

@pytest.fixture
def api(bd, monkeypatch):  # noqa: ANN001
    """La app real de las rutas; la identidad sale de las cabeceras (el JWT se prueba en
    test_liga_auth) y la puerta de admin y la RLS son las de verdad."""
    from app.liga import rutas_admin, rutas_avisos_admin

    app = FastAPI()
    app.include_router(rutas_admin.router)
    app.include_router(rutas_avisos_admin.router_servicio)

    def quien(x_uid: str = Header(default=""), x_aal: str = Header(default="aal2")) -> Identidad:
        if not x_uid:
            from fastapi import HTTPException
            raise HTTPException(401, "Entra en tu cuenta para seguir.")
        return Identidad(uid=x_uid, aal=x_aal, claims={"sub": x_uid, "role": "authenticated",
                                                       "aal": x_aal})

    app.dependency_overrides[auth.require_usuario] = quien
    monkeypatch.setattr(settings, "agente_clave_servicio", CLAVE)
    return TestClient(app)


def _h(uid, aal: str = "aal2") -> dict:
    return {"x-uid": str(uid), "x-aal": aal}


@con_bd
def test_lista_y_marcar_leido_solo_para_admin(bd, api) -> None:  # noqa: ANN001
    admin, jugador = bd.usuario("admin"), bd.usuario()
    primero, segundo = _sembrar(bd, 2)

    assert api.get("/liga/admin/avisos").status_code == 401
    assert api.get("/liga/admin/avisos", headers=_h(jugador)).status_code == 404
    assert api.post(f"/liga/admin/avisos/{primero}/leido", headers=_h(jugador)).status_code == 404
    assert api.post("/liga/admin/avisos/leidos", headers=_h(jugador)).status_code == 404
    assert api.get("/liga/admin/avisos", headers=_h(admin, "aal1")).status_code == 403

    r = api.get("/liga/admin/avisos", headers=_h(admin))
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["sin_leer"] == 2
    assert [a["id"] for a in cuerpo["avisos"]] == [segundo, primero]
    assert cuerpo["avisos"][0]["datos"] == {"count": 2}
    assert cuerpo["avisos"][0]["sala"] == "omega"

    r = api.post(f"/liga/admin/avisos/{primero}/leido", headers=_h(admin))
    assert r.json()["sin_leer"] == 1
    assert api.post("/liga/admin/avisos/999999/leido", headers=_h(admin)).status_code == 404
    r = api.post("/liga/admin/avisos/leidos", headers=_h(admin))
    assert r.json()["sin_leer"] == 0
    assert all(a["leido"] for a in r.json()["avisos"])


@con_bd
def test_la_lista_se_corta_en_50(bd, api) -> None:  # noqa: ANN001
    admin = bd.usuario("admin")
    _sembrar(bd, 52)
    r = api.get("/liga/admin/avisos", headers=_h(admin)).json()
    assert len(r["avisos"]) == 50
    assert r["sin_leer"] == 52


# ---- ruta del servicio del agente -----------------------------------------------------------

@con_bd
def test_ruta_del_agente_sin_clave_configurada_no_existe(bd, api, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(settings, "agente_clave_servicio", "")
    r = api.post("/liga/admin/avisos/agente", json={"tipo": "agente_x"},
                 headers={"X-Clave-Servicio": CLAVE})
    assert r.status_code == 404
    assert bd.execute("select count(*) from liga.avisos_admin").fetchone()[0] == 0


@con_bd
def test_ruta_del_agente_con_clave_mala_da_401(bd, api) -> None:  # noqa: ANN001
    for cabeceras in ({}, {"X-Clave-Servicio": "otra"}):
        r = api.post("/liga/admin/avisos/agente", json={"tipo": "agente_x"}, headers=cabeceras)
        assert r.status_code == 401
    assert bd.execute("select count(*) from liga.avisos_admin").fetchone()[0] == 0


@con_bd
def test_ruta_del_agente_con_clave_buena_guarda(bd, api, push_falso) -> None:  # noqa: ANN001
    r = api.post("/liga/admin/avisos/agente",
                 json={"tipo": "agente_decision", "datos": {"ticker": "AAOI", "n": 3}},
                 headers={"X-Clave-Servicio": CLAVE})
    assert r.status_code == 201
    assert bd.execute("select tipo, sala, datos from liga.avisos_admin").fetchall() == [
        ("agente_decision", "alphagentic", {"ticker": "AAOI", "n": 3})]


@con_bd
@pytest.mark.parametrize("cuerpo", [
    {"tipo": "omega_nuevas"},
    {"tipo": "agente_x", "datos": {"title": "pisa"}},
    {"tipo": "agente_x", "datos": {"Mal": 1}},
    {"tipo": "agente_x", "datos": {"texto": "a" * 1600}},
])
def test_ruta_del_agente_rechaza_cuerpos_fuera_de_formato(bd, api, cuerpo) -> None:  # noqa: ANN001
    r = api.post("/liga/admin/avisos/agente", json=cuerpo, headers={"X-Clave-Servicio": CLAVE})
    assert r.status_code == 422
    assert bd.execute("select count(*) from liga.avisos_admin").fetchone()[0] == 0
