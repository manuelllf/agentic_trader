"""Prueba el resumen, la analítica y las consultas del panel de admin con RLS."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text
from test_procesos_integracion import fabrica  # noqa: F401

from app.liga.motor.calendario import dias_de_bolsa
from app.liga.procesos import estado

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
    ruta = "/liga/admin/panel/resumen"
    assert cliente.get(ruta, headers=cab(normal)).status_code == 404
    assert cliente.get(ruta, headers=cab(admin, aal="aal1")).status_code == 403
    r = cliente.get(ruta, headers=cab(admin, aal="aal2"))
    assert r.status_code == 200, r.text


def test_el_resumen_se_recalcula_solo(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    headers = cab(usuario(rol="admin"), aal="aal2")
    autor, objeto = usuario(), usuario()

    def cuantos():
        r = cliente.get("/liga/admin/panel/resumen", headers=headers)
        assert r.status_code == 200, r.text
        return sum(p["cuantos"] for p in r.json()["pendientes"] if p["tipo"] == "revisar")

    antes = cuantos()
    errores = []
    reporte = None
    try:
        for _ in range(2):
            errores.append(cx.execute(
                "insert into liga.avisos_error (pantalla, mensaje) "
                "values ('panel', 'Error de prueba') returning id").fetchone()[0])
        reporte = cx.execute(
            "insert into liga.reportes (autor_id, tipo, objeto_id, motivo) "
            "values (%s, 'alias', %s, 'Alias de prueba') returning id",
            (autor, objeto)).fetchone()[0]
        assert cuantos() == antes + 3
        cx.execute("update liga.avisos_error set estado = 'resuelto' where id = %s",
                   (errores[0],))
        assert cuantos() == antes + 2
    finally:
        for error in errores:
            cx.execute("delete from liga.avisos_error where id = %s", (error,))
        if reporte is not None:
            cx.execute("delete from liga.reportes where id = %s", (reporte,))


def test_altas_sin_estrategia_y_su_consulta(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    uid = usuario()
    headers = cab(usuario(rol="admin"), aal="aal2")
    cx.execute("update liga.perfiles set creado = now() - interval '4 days' where id = %s",
               (uid,))
    alias = cx.execute("select alias from liga.perfiles where id = %s", (uid,)).fetchone()[0]
    r = cliente.get("/liga/admin/panel/resumen", headers=headers)
    assert r.status_code == 200, r.text
    pendiente = next(p for p in r.json()["pendientes"] if p["tipo"] == "altas_sin_estrategia")
    assert pendiente["cuantos"] >= 1
    assert pendiente["datos"]["dias"] == 3
    ruta = "/liga/admin/panel/consultas/sin_estrategia"
    r = cliente.get(ruta, headers=headers)
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["columnas"] == ["alias", "creado", "visitas", "ultima_visita", "borrador"]
    assert datos["umbral_dias"] == 3
    assert any(f[0] == alias for f in datos["filas"])
    r = cliente.get(ruta + "?formato=csv", headers=headers)
    assert r.status_code == 200, r.text
    assert r.text.startswith("alias,creado,visitas,ultima_visita,borrador")
    assert "sin_estrategia.csv" in r.headers["Content-Disposition"]
    assert r.headers["Cache-Control"] == "no-store"


def test_analitica(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    r = cliente.get("/liga/admin/panel/analitica?dias=7",
                    headers=cab(usuario(rol="admin"), aal="aal2"))
    assert r.status_code == 200, r.text
    datos = r.json()
    assert len(datos["visitas_dia"]) == 7
    assert datos["embudo"]["altas"] == sum(c["altas"] for c in datos["cohortes"])


def test_consulta_desconocida(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    r = cliente.get("/liga/admin/panel/consultas/otra",
                    headers=cab(usuario(rol="admin"), aal="aal2"))
    assert r.status_code == 422


def test_coste_por_dia(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    mes = datetime.now(UTC).strftime("%Y-%m")
    r = cliente.get(f"/liga/admin/coste-ia?mes={mes}",
                    headers=cab(usuario(rol="admin"), aal="aal2"))
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["por_dia"], list)


def test_estado_con_dias_de_bolsa(request) -> None:  # noqa: ANN001
    crear_fabrica = request.getfixturevalue("fabrica")
    with crear_fabrica() as db:
        temporada = db.execute(text(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta) "
            "values ('Panel admin', 1, false) returning id")).scalar_one()
        jornada = db.execute(text("""
            insert into liga.jornadas (temporada_id, numero, estado, dia_inicio, dia_fin,
                                       dia_base, cierre_inscripcion)
            values (:t, 1, 'formada', '2026-09-01', '2026-09-30', '2026-08-31', '2026-08-31')
            returning id
        """), {"t": temporada}).scalar_one()
        datos = estado.general(lambda: db)
        fila = next(j for t in datos["temporadas"] for j in t["jornadas"] if j["id"] == jornada)
        total = len(dias_de_bolsa(date(2026, 9, 1), date(2026, 9, 30)))
        assert fila["dias_bolsa"] == {"hechos": total, "total": total}




@pytest.mark.parametrize(("dias", "visitas", "esperado"), [
    (15, [9, 9], (1, 1, 1, 0, 0)),
    (3, [], (1, 0, 0, 0, 0)),
    (22, [7, 14, 20, 21], (1, 1, 1, 1, 1)),
    (22, [6, 21], (1, 1, 0, 1, 0)),
])
def test_vuelta_bases_y_visitas(api, dias, visitas, esperado) -> None:  # noqa: ANN001
    from test_liga_rls import _como, _lista, _sistema

    _cliente, _cab, usuario, cx = api
    jugador, admin = usuario(pro=True), usuario(rol="admin")
    with cx.transaction(force_rollback=True):
        cx.execute("update liga.perfiles set creado = '2001-01-01' where id = %s", (jugador,))
        _como(cx, uuid.UUID(admin), aal="aal2")
        sql = ("select jugaron, base_2, vuelven_2, base_3, vuelven_3 "
               "from liga.v_admin_vuelta where semana = '2001-01-01'")
        antes = cx.execute(sql).fetchone()
        eid, rid = _lista(cx, uuid.UUID(jugador))
        _sistema(cx)
        tid = cx.execute("insert into liga.temporadas (nombre, n_jornadas, cuenta) "
                         "values ('Vuelta', 2, false) returning id").fetchone()[0]
        for numero, antiguedad in ((1, dias), (2, 1)):
            jid = cx.execute(
                "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, "
                "dia_fin, cierre_inscripcion) values (%s, %s, current_date - %s - 1, "
                "current_date - %s, current_date, now()) returning id",
                (tid, numero, antiguedad, antiguedad)).fetchone()[0]
            cx.execute("insert into liga.inscripciones "
                       "(jornada_id, estrategia_id, receta_id, estado) "
                       "values (%s, %s, %s, 'formada')", (jid, eid, rid))
        for dia in visitas:
            cx.execute("insert into liga.visitas (usuario_id, session_id, inicio) "
                       "values (%s, gen_random_uuid(), "
                       "(current_date - %s)::timestamp at time zone 'Europe/Madrid')",
                       (jugador, dias - dia))
        _como(cx, uuid.UUID(admin), aal="aal2")
        despues = cx.execute(sql).fetchone()
        assert tuple(b - a for a, b in zip(antes, despues, strict=True)) == esperado


def test_vuelta_no_admin_no_lee_filas(api) -> None:  # noqa: ANN001
    from test_liga_rls import _como

    _cliente, _cab, usuario, cx = api
    normal = usuario()
    with cx.transaction(force_rollback=True):
        _como(cx, uuid.UUID(normal))
        assert cx.execute("select * from liga.v_admin_vuelta").fetchall() == []


def test_analitica_vuelta_comparte_cohortes(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    respuesta = cliente.get("/liga/admin/panel/analitica",
                            headers=cab(usuario(rol="admin"), aal="aal2"))
    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    assert [f["semana"] for f in datos["vuelta"]] == [f["semana"] for f in datos["cohortes"]]
    assert [f["jugaron"] for f in datos["vuelta"]] == [f["jugaron"] for f in datos["cohortes"]]
