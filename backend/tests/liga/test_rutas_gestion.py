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


def test_alta_de_usuario_desde_admin(api, monkeypatch) -> None:  # noqa: ANN001
    from types import SimpleNamespace

    from app.liga import gestion

    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")
    monkeypatch.setattr(gestion.settings, "supabase_url", "https://proyecto.supabase.co")
    monkeypatch.setattr(gestion.settings, "supabase_secret_key", "sb_secret_prueba")
    nuevos: list[str] = []
    enviado: dict = {}

    def _post_falso(url, headers, json, timeout):  # noqa: ANN001, ANN202
        enviado.update(url=url, headers=headers, json=json)
        if json["email"] == "repetido@prueba.local":
            return SimpleNamespace(status_code=422, text='{"error_code":"email_exists"}')
        uid = str(uuid.uuid4())
        cx.execute("insert into auth.users (id, email) values (%s, %s)", (uid, json["email"]))
        nuevos.append(uid)
        return SimpleNamespace(status_code=200, text="", json=lambda: {"id": uid})

    monkeypatch.setattr(gestion.httpx, "post", _post_falso)
    try:
        # Sin sesión de admin: nada.
        r = cliente.post("/liga/admin/usuarios", json={"email": "a@prueba.local"},
                         headers=cab(usuario()))
        assert r.status_code == 404 and not nuevos

        r = cliente.post("/liga/admin/usuarios",
                         json={"email": " Colega@Prueba.Local ", "alias": "Colega_1"}, headers=a2)
        assert r.status_code == 201, r.text
        assert r.headers["cache-control"] == "no-store"
        cuerpo = r.json()
        assert cuerpo["email"] == "colega@prueba.local" and cuerpo["alias"] == "colega_1"
        assert cuerpo["alias_aplicado"] is True and len(cuerpo["clave_temporal"]) >= 12
        assert enviado["json"]["email_confirm"] is True
        assert enviado["json"]["password"] == cuerpo["clave_temporal"]
        assert "Authorization" not in enviado["headers"]
        fila = cx.execute("select alias from liga.perfiles where id = %s",
                          (cuerpo["id"],)).fetchone()
        assert fila == ("colega_1",)
        aud = cx.execute("select count(*) from liga.auditoria where accion = 'admin.usuario.alta' "
                         "and objeto = %s", (f"usuario:{cuerpo['id']}",)).fetchone()
        assert aud == (1,)

        # Alias reservado: la cuenta se crea con el suyo por defecto y se avisa.
        r = cliente.post("/liga/admin/usuarios",
                         json={"email": "otro@prueba.local", "alias": "alpha"}, headers=a2)
        assert r.status_code == 201, r.text
        assert r.json()["alias_aplicado"] is False and r.json()["alias"].startswith("jugador_")

        # Correo que ya existe.
        r = cliente.post("/liga/admin/usuarios", json={"email": "repetido@prueba.local"},
                         headers=a2)
        assert r.status_code == 409

        # Correo mal escrito: ni se llama a Supabase.
        antes = len(nuevos)
        r = cliente.post("/liga/admin/usuarios", json={"email": "sin-arroba"}, headers=a2)
        assert r.status_code == 422 and len(nuevos) == antes
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in nuevos:
            cx.execute("delete from liga.auditoria where objeto = %s", (f"usuario:{uid}",))
        cx.execute("set session_replication_role = origin")
        for uid in nuevos:
            cx.execute("delete from auth.users where id = %s", (uid,))


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

    r = cliente.put("/liga/admin/ajustes/creditos.bienvenida", json={"valor": 2.5}, headers=a2)
    assert r.status_code == 200 and r.json()["valor"] == 2.5

    r = cliente.put("/liga/admin/ajustes/lo.que.sea", json={"valor": True}, headers=a2)
    assert r.status_code == 422

    cx.execute("delete from liga.ajustes where clave = 'creditos.bienvenida'")


def test_ajustes_trae_metadato_y_efectivo_por_defecto(api) -> None:  # noqa: ANN001
    """Sin fila guardada: `valor` None, `efectivo` = el `defecto` del catálogo, con su texto."""
    cliente, cab, usuario, _cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")

    r = cliente.get("/liga/admin/ajustes", headers=a2)
    assert r.status_code == 200
    filas = {f["clave"]: f for f in r.json()}
    assert set(filas) == {
        "liga.registro.abierto", "liga.visible", "ia.conversor.activo", "ia.pregunta.activo",
        "ia.lectura.activo", "ia.tope_mensual_usd", "ia.margen_objetivo",
        "creditos.bienvenida", "procesos.foto.auto", "procesos.formar.auto",
    }
    registro = filas["liga.registro.abierto"]
    assert registro["valor"] is None and registro["efectivo"] is True
    assert registro["grupo"] == "Emergencia" and registro["tipo"] == "interruptor"
    assert registro["titulo"] and registro["ayuda"]

    conversor = filas["ia.conversor.activo"]
    assert conversor["defecto"] is False and conversor["efectivo"] is False

    margen = filas["ia.margen_objetivo"]
    assert float(margen["defecto"]) == 3.0 and float(margen["efectivo"]) == 3.0


def test_ajustes_valida_por_tipo(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")

    r = cliente.put("/liga/admin/ajustes/ia.conversor.activo", json={"valor": "si"}, headers=a2)
    assert r.status_code == 422 and "interruptor" in r.json()["detail"]

    r = cliente.put("/liga/admin/ajustes/ia.conversor.activo", json={"valor": True}, headers=a2)
    assert r.status_code == 200 and r.json()["valor"] is True

    r = cliente.put("/liga/admin/ajustes/ia.tope_mensual_usd", json={"valor": -1}, headers=a2)
    assert r.status_code == 422 and "negativo" in r.json()["detail"]

    r = cliente.put("/liga/admin/ajustes/ia.tope_mensual_usd", json={"valor": "no numero"},
                    headers=a2)
    assert r.status_code == 422

    r = cliente.put("/liga/admin/ajustes/ia.tope_mensual_usd", json={"valor": 5}, headers=a2)
    assert r.status_code == 200 and r.json()["valor"] == 5.0

    cx.execute("delete from liga.ajustes where clave = any(%s)",
              (["ia.conversor.activo", "ia.tope_mensual_usd"],))


def test_ajustes_restablecer_vuelve_al_defecto(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")

    r = cliente.put("/liga/admin/ajustes/liga.visible", json={"valor": False}, headers=a2)
    assert r.status_code == 200 and r.json()["valor"] is False

    r = cliente.delete("/liga/admin/ajustes/liga.visible", headers=a2)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["valor"] is None and cuerpo["efectivo"] is True

    fila = cx.execute("select 1 from liga.ajustes where clave = 'liga.visible'").fetchone()
    assert fila is None


# ---- IA: estado real («funciona» o por qué no) ---------------------------------------------------


def test_ia_estado_solo_admin(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, _cx = api
    normal = usuario()
    admin = usuario(rol="admin")

    assert cliente.get("/liga/admin/ia/estado", headers=cab(normal)).status_code == 404
    r = cliente.get("/liga/admin/ia/estado", headers=cab(admin, aal="aal2"))
    assert r.status_code == 200, r.text


def test_ia_estado_da_razones(api, monkeypatch) -> None:  # noqa: ANN001
    from app.config import settings

    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    a2 = cab(admin, aal="aal2")

    monkeypatch.setattr(settings, "enable_llm", False)
    r = cliente.get("/liga/admin/ia/estado", headers=a2)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["enable_llm"] is False
    assert all(f["funciona"] is False and f["razon"] == "Falta ENABLE_LLM en Railway"
              for f in cuerpo["finalidades"])

    monkeypatch.setattr(settings, "enable_llm", True)
    monkeypatch.setattr(settings, "deepseek_api_key", "")
    monkeypatch.setattr(settings, "typesafe_api_key", "")
    r = cliente.get("/liga/admin/ia/estado", headers=a2)
    cuerpo = r.json()
    assert cuerpo["deepseek_key_presente"] is False
    assert cuerpo["typesafe_key_presente"] is False
    por_finalidad = {f["finalidad"]: f for f in cuerpo["finalidades"]}
    assert por_finalidad["conversor"]["razon"] == "Sin clave de DeepSeek"
    assert por_finalidad["pregunta"]["razon"] == "Sin clave de Jev"

    monkeypatch.setattr(settings, "deepseek_api_key", "sk-lo-que-sea")
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    r = cliente.get("/liga/admin/ia/estado", headers=a2)
    por_finalidad = {f["finalidad"]: f for f in r.json()["finalidades"]}
    assert por_finalidad["conversor"]["funciona"] is True
    assert por_finalidad["lectura"]["razon"] == "Apagado aquí"

    cx.execute("delete from liga.ajustes where clave = 'ia.conversor.activo'")


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
    # Quien modera ve lo reportado, no solo un identificador.
    assert next(f for f in r.json()["filas"] if f["id"] == rid)["contenido"] == "Ofensiva"

    r = cliente.post("/liga/moderacion/ocultar", json={"reporte_id": rid}, headers=cab(moderador))
    assert r.status_code == 200 and r.json()["estado"] == "resuelto"

    oculta = cx.execute("select oculta from liga.estrategias where id = %s", (eid,)).fetchone()[0]
    assert oculta is True

    # Ya no sale entre los pendientes.
    r = cliente.get("/liga/moderacion/reportes", headers=cab(moderador))
    assert rid not in {f["id"] for f in r.json()["filas"]}

    cx.execute("delete from liga.reportes where id = %s", (rid,))
    cx.execute("delete from liga.estrategias where id = %s", (eid,))


# ---- avisos de error -----------------------------------------------------------------------------


def test_aviso_de_error_con_y_sin_sesion_y_el_admin_lo_resuelve(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    jugador = usuario()
    a2 = cab(admin, aal="aal2")
    cuerpo = {"codigo": "a1b2c3", "pantalla": "/crear",
              "mensaje": "Algo ha fallado. (código a1b2c3)",
              "nota": "Pulsé Guardar", "contexto": {"navegador": "Safari", "ancho": 390}}
    try:
        # Sin sesión también se puede avisar.
        r = cliente.post("/liga/errores", json=cuerpo)
        assert r.status_code == 201 and r.json() == {"ok": True}
        # Con sesión queda quién avisó.
        r = cliente.post("/liga/errores", json={**cuerpo, "codigo": "d4e5f6"}, headers=cab(jugador))
        assert r.status_code == 201

        # Un usuario normal no los ve; el admin sí, con el alias de quien avisó.
        assert cliente.get("/liga/admin/errores", headers=cab(jugador)).status_code == 404
        r = cliente.get("/liga/admin/errores", headers=a2)
        assert r.status_code == 200
        por_codigo = {f["codigo"]: f for f in r.json()["filas"]}
        assert por_codigo["a1b2c3"]["alias"] is None
        assert por_codigo["d4e5f6"]["alias"] and por_codigo["d4e5f6"]["nota"] == "Pulsé Guardar"
        assert por_codigo["d4e5f6"]["contexto"]["navegador"] == "Safari"

        aviso = por_codigo["a1b2c3"]["id"]
        r = cliente.post(f"/liga/admin/errores/{aviso}/resolver", headers=a2)
        assert r.status_code == 200 and r.json()["estado"] == "resuelto"
        abiertos = cliente.get("/liga/admin/errores", headers=a2).json()["filas"]
        codigos = {f["codigo"] for f in abiertos}
        assert "a1b2c3" not in codigos and "d4e5f6" in codigos
        assert cliente.post("/liga/admin/errores/999999999/resolver", headers=a2).status_code == 404

        # Datos fuera de límites: 422, no una nota enorme.
        demasiado = cliente.post("/liga/errores", json={**cuerpo, "mensaje": "x" * 501})
        assert demasiado.status_code == 422
    finally:
        cx.execute("delete from liga.avisos_error where codigo in ('a1b2c3', 'd4e5f6')")


def test_los_avisos_de_error_tienen_limite_por_persona(api) -> None:  # noqa: ANN001
    from app.liga import rutas

    cliente, cab, usuario, cx = api
    jugador = usuario()
    rutas._LIMITE_AVISOS._golpes.clear()
    try:
        codigos = [cliente.post("/liga/errores", json={"pantalla": "/x", "mensaje": "fallo"},
                                headers=cab(jugador)).status_code for _ in range(8)]
        assert codigos[:6] == [201] * 6 and codigos[6:] == [429, 429]
    finally:
        rutas._LIMITE_AVISOS._golpes.clear()
        cx.execute("delete from liga.avisos_error where pantalla = '/x'")


# ---- cuentas suspendidas -------------------------------------------------------------------------


def test_una_cuenta_suspendida_no_puede_gastar_ia_pero_la_activa_si_entra(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, cx = api
    admin = usuario(rol="admin")
    jugador = usuario()
    a2 = cab(admin, aal="aal2")
    peticion = {"frase": "empresas grandes y baratas"}

    r = cliente.post("/liga/convertir", json=peticion, headers=cab(jugador))
    assert r.status_code != 403                     # activa: la puerta la deja pasar
    r = cliente.post(f"/liga/admin/usuarios/{jugador}/suspender", json={"suspendido": True},
                     headers=a2)
    assert r.status_code == 200

    for ruta, cuerpo in (("/liga/convertir", peticion),
                         ("/liga/lecturas/AAPL", {"idempotencia": "clave-de-prueba-1"})):
        r = cliente.post(ruta, json=cuerpo, headers=cab(jugador))
        assert r.status_code == 403 and "suspendida" in r.json()["detail"], (ruta, r.text)
