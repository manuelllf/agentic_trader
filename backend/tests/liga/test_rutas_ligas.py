"""API de ligas privadas, créditos y reportes (`/liga`) contra el Postgres de pruebas (se salta sin
`LIGA_TEST_DATABASE_URL`). Mismo patrón que `test_rutas_estrategias.py`: JWT verificado como el
usuario, para que RLS decida de verdad quién ve y quién toca qué. Al final se borra todo lo creado.
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"

RECETA_BASICA = {
    "reglas": [], "excluidas": [], "pregunta": None,
    "pesos": {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
    "n_empresas": 5, "reparto": "igual", "max_por_sector": 0,
}


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
    from app.liga import auth, ligas
    from app.liga import db as liga_db
    from app.liga.rutas import router

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())
    # El límite de intentos con código es un singleton en memoria: aislado entre pruebas.
    monkeypatch.setattr(ligas, "LIMITE_UNIRSE", type(ligas.LIMITE_UNIRSE)(
        por_ip=10, global_=200, ventana_s=60 * 60))

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
    app.include_router(router)
    cliente = TestClient(app)

    cx = psycopg.connect(URL, autocommit=True)
    creado: dict[str, list] = {"usuarios": []}

    def usuario(pro: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creado["usuarios"].append(uid)
        if pro:
            cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                      "values (%s, 'pro', 'demo')", (uid,))
        return str(uid)

    try:
        yield cliente, cab, usuario
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.reportes where autor_id = %s", (uid,))
            cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
            cx.execute("delete from liga.miembros_liga where usuario_id = %s", (uid,))
            cx.execute("delete from liga.ligas_privadas where dueno_id = %s", (uid,))
            cx.execute("update liga.estrategias set receta_id = null where dueno_id = %s", (uid,))
            cx.execute("delete from liga.recetas where estrategia_id in "
                      "(select id from liga.estrategias where dueno_id = %s)", (uid,))
        cx.execute("set session_replication_role = origin")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from liga.planes_usuario where usuario_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _crear_estrategia(cliente, cab, uid: str, nombre: str = "Foso ancho") -> str:  # noqa: ANN001
    escudo = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68", "color2": "#FFFFFF"}
    r = cliente.post("/liga/estrategias", json={"nombre": nombre, "escudo": escudo},
                     headers=cab(uid))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _receta(cliente, cab, uid: str, eid: str, **cambios) -> dict:  # noqa: ANN001
    body = {**RECETA_BASICA, **cambios}
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=body, headers=cab(uid))
    assert r.status_code == 201, r.text
    return r.json()


# ---- ligas privadas: crear, unirse, ver, salir, rotar el código -----------------------------


def test_solo_pro_crea_una_liga(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    gratis = usuario()
    r = cliente.post("/liga/ligas", json={"nombre": "Amigos"}, headers=cab(gratis))
    assert r.status_code == 403, r.text

    pro = usuario(pro=True)
    r = cliente.post("/liga/ligas", json={"nombre": "Amigos"}, headers=cab(pro))
    assert r.status_code == 201, r.text
    liga = r.json()
    assert liga["es_dueno"] is True and liga["n_miembros"] == 1 and liga["codigo"]

    mias = cliente.get("/liga/ligas", headers=cab(pro)).json()
    assert any(x["id"] == liga["id"] for x in mias)


def test_flujo_unirse_ver_y_salir(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    r = cliente.post("/liga/ligas", json={"nombre": "Liga de prueba", "cupo": 5},
                     headers=cab(duena))
    liga = r.json()

    # Unirse a una liga privada también es de Pro (plan §2.1), como crearla.
    amigo = usuario(pro=True)
    assert cliente.post("/liga/ligas/unirse", json={"codigo": "ZZZZZZZZ"},
                        headers=cab(amigo)).status_code == 422
    r = cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == liga["id"] and r.json()["codigo"] is None

    detalle = cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(amigo)).json()
    assert detalle["n_miembros"] == 2 and detalle["codigo"] is None
    alias_vistos = {m["alias"] for m in detalle["miembros"]}
    assert len(alias_vistos) == 2
    yo = next(m for m in detalle["miembros"] if m["es_yo"])
    assert yo is not None

    # Unirse otra vez con el mismo código no duplica al miembro.
    r = cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    assert r.status_code == 200
    assert cliente.get(f"/liga/ligas/{liga['id']}",
                       headers=cab(duena)).json()["n_miembros"] == 2

    # Salir la deja fuera; ya no ve la liga.
    assert cliente.delete(f"/liga/ligas/{liga['id']}/yo", headers=cab(amigo)).status_code == 204
    assert cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(amigo)).status_code == 404
    assert cliente.delete(f"/liga/ligas/{liga['id']}/yo", headers=cab(amigo)).status_code == 404


def test_gratis_no_se_une_a_una_liga_privada(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Solo Pro"}, headers=cab(duena)).json()

    gratis = usuario()
    r = cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(gratis))
    assert r.status_code == 403, r.text


def test_detalle_muestra_equipo_formado_y_mes_sin_abrir_datos_privados(api, monkeypatch) -> None:  # noqa: ANN001
    from datetime import UTC, date, datetime, timedelta
    from decimal import Decimal

    import psycopg

    from app.liga import rutas_ligas

    cliente, cab, usuario = api
    duena, miembro, ajeno = usuario(pro=True), usuario(pro=True), usuario()
    liga = cliente.post("/liga/ligas", json={"nombre": "Resultados"},
                        headers=cab(duena)).json()
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(miembro))
    eid = _crear_estrategia(cliente, cab, duena)
    receta = _receta(cliente, cab, duena, eid)
    _crear_estrategia(cliente, cab, miembro, "Todavía sin cartera")
    apuntada = cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(duena))
    assert apuntada.status_code == 200, apuntada.text
    with psycopg.connect(URL, autocommit=True) as cx:
        temporada = cx.execute(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta, estado) "
            "values ('Privadas test', 12, false, 'cerrada') returning id"
        ).fetchone()[0]
        try:
            hoy = date.today()
            jornada = cx.execute(
                "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, "
                "dia_fin, cierre_inscripcion, estado) "
                "values (%s, 1, %s, %s, %s, %s, 'formada') returning id",
                (temporada, hoy - timedelta(days=2), hoy - timedelta(days=1),
                 hoy + timedelta(days=28), datetime.now(UTC) - timedelta(days=2)),
            ).fetchone()[0]
            inscripcion = cx.execute(
                "insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado) "
                "values (%s, %s, %s, 'formada') returning id",
                (jornada, eid, receta["id"]),
            ).fetchone()[0]
            monkeypatch.setattr(rutas_ligas, "_temporada_actual", lambda db: temporada)
            llamadas = []

            def vivo(jid):  # noqa: ANN001, ANN202
                llamadas.append(jid)
                return {"dia": hoy, "sp": Decimal("1.2"), "en_vivo": True,
                        "por_inscripcion": {inscripcion: {
                            "rentabilidad": Decimal("2.5"), "dif": Decimal("1.3")}}}

            monkeypatch.setattr(rutas_ligas.diario, "vivo", vivo)
            response = cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(miembro))
            assert response.status_code == 200, response.text
            detalle = response.json()
            assert detalle["codigo"] is None
            assert detalle["jornada_numero"] == 1 and detalle["en_vivo"] is True
            assert detalle["datos_hasta"] == hoy.isoformat()
            equipo = next(m for m in detalle["miembros"] if not m["es_yo"])
            assert equipo["estrategia"]["id"] == eid
            assert equipo["estrategia"]["nombre"] == "Foso ancho"
            assert "receta" not in equipo["estrategia"]
            assert equipo["puntos"] is None
            assert Decimal(equipo["rentabilidad_mes"]) == Decimal("2.5")
            assert Decimal(equipo["diferencia_mes"]) == Decimal("1.3")
            sin_cartera = next(m for m in detalle["miembros"] if m["es_yo"])
            assert sin_cartera["estrategia"] is None
            assert sin_cartera["rentabilidad_mes"] is None
            assert cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(ajeno)).status_code == 404
            assert llamadas == [jornada]
        finally:
            cx.execute("delete from liga.inscripciones where jornada_id in "
                       "(select id from liga.jornadas where temporada_id = %s)", (temporada,))
            cx.execute("delete from liga.jornadas where temporada_id = %s", (temporada,))
            cx.execute("delete from liga.temporadas where id = %s", (temporada,))


def test_codigo_equivocado_frena_por_fuerza_bruta(api) -> None:  # noqa: ANN001
    # Solo Pro llega a probar el código (antes se comprueba el plan): con Pro para aislar el
    # límite de intentos del error de plan, que ya cubre `test_gratis_no_se_une_a_una_liga_privada`.
    cliente, cab, usuario = api
    uid = usuario(pro=True)
    for _ in range(10):
        r = cliente.post("/liga/ligas/unirse", json={"codigo": "ZZZZZZZZ"}, headers=cab(uid))
        assert r.status_code == 422, r.text
    r = cliente.post("/liga/ligas/unirse", json={"codigo": "ZZZZZZZZ"}, headers=cab(uid))
    assert r.status_code == 429, r.text


def test_ajeno_no_ve_una_liga_de_la_que_no_es_miembro(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Privada"}, headers=cab(duena)).json()

    ajeno = usuario()
    assert cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(ajeno)).status_code == 404
    # Ni siquiera se cuela entre «mis ligas».
    mias = cliente.get("/liga/ligas", headers=cab(ajeno)).json()
    assert liga["id"] not in {x["id"] for x in mias}


def _alias_de(cliente, cab, uid: str, liga_id: str) -> str:  # noqa: ANN001
    detalle = cliente.get(f"/liga/ligas/{liga_id}", headers=cab(uid)).json()
    return next(m["alias"] for m in detalle["miembros"] if m["es_yo"])


def test_duena_expulsa_a_un_miembro(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Expulsable"}, headers=cab(duena)).json()

    amigo = usuario(pro=True)
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    alias_amigo = _alias_de(cliente, cab, amigo, liga["id"])

    r = cliente.delete(f"/liga/ligas/{liga['id']}/miembros/{alias_amigo}", headers=cab(duena))
    assert r.status_code == 204, r.text
    assert cliente.get(f"/liga/ligas/{liga['id']}", headers=cab(amigo)).status_code == 404

    # Puede volver a unirse con el mismo código: expulsar no lo veta.
    r = cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    assert r.status_code == 200, r.text


def test_expulsar_solo_lo_puede_la_duena_y_no_a_si_misma(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Blindada"}, headers=cab(duena)).json()

    amigo = usuario(pro=True)
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    alias_duena = _alias_de(cliente, cab, duena, liga["id"])

    # Un miembro cualquiera no puede expulsar a otro (ni siquiera a sí mismo por esta puerta).
    otro = usuario(pro=True)
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(otro))
    alias_otro = _alias_de(cliente, cab, otro, liga["id"])
    r = cliente.delete(f"/liga/ligas/{liga['id']}/miembros/{alias_otro}", headers=cab(amigo))
    assert r.status_code == 404, r.text

    # Ni la dueña se expulsa a sí misma.
    r = cliente.delete(f"/liga/ligas/{liga['id']}/miembros/{alias_duena}", headers=cab(duena))
    assert r.status_code == 404, r.text

    # Alias que no existe en la liga: también 404, sin filtrar si el alias existe en otro sitio.
    r = cliente.delete(f"/liga/ligas/{liga['id']}/miembros/no-existe", headers=cab(duena))
    assert r.status_code == 404, r.text


def test_expulsado_puede_volver_a_unirse_pero_no_tras_rotar_el_codigo(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Rotada"}, headers=cab(duena)).json()

    amigo = usuario(pro=True)
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    alias_amigo = _alias_de(cliente, cab, amigo, liga["id"])
    codigo_viejo = liga["codigo"]

    assert cliente.delete(f"/liga/ligas/{liga['id']}/miembros/{alias_amigo}",
                          headers=cab(duena)).status_code == 204
    nueva = cliente.post(f"/liga/ligas/{liga['id']}/codigo", headers=cab(duena)).json()
    assert nueva["codigo"] != codigo_viejo

    r = cliente.post("/liga/ligas/unirse", json={"codigo": codigo_viejo}, headers=cab(amigo))
    assert r.status_code == 422, r.text


def test_solo_la_duena_rota_el_codigo(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    duena = usuario(pro=True)
    liga = cliente.post("/liga/ligas", json={"nombre": "Rotable"}, headers=cab(duena)).json()

    amigo = usuario(pro=True)
    cliente.post("/liga/ligas/unirse", json={"codigo": liga["codigo"]}, headers=cab(amigo))
    assert cliente.post(f"/liga/ligas/{liga['id']}/codigo",
                        headers=cab(amigo)).status_code == 404

    r = cliente.post(f"/liga/ligas/{liga['id']}/codigo", headers=cab(duena))
    assert r.status_code == 200, r.text
    assert r.json()["codigo"] != liga["codigo"]


# ---- copiar una estrategia (Pro) --------------------------------------------------------------


def test_copiar_es_de_pro_y_no_copia_lo_de_otro_sin_publicar(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    autora = usuario(pro=True)
    eid = _crear_estrategia(cliente, cab, autora, "Original")
    _receta(cliente, cab, autora, eid, n_empresas=7)

    otro_gratis = usuario()
    # De un gratis: aunque fuera suya, copiar es de Pro.
    r = cliente.post(f"/liga/estrategias/{eid}/copiar", headers=cab(otro_gratis))
    assert r.status_code == 403, r.text

    otro_pro = usuario(pro=True)
    # Aún borrador: RLS ni siquiera la deja ver, así que no hay qué copiar.
    r = cliente.post(f"/liga/estrategias/{eid}/copiar", headers=cab(otro_pro))
    assert r.status_code == 404, r.text

    r = cliente.patch(f"/liga/estrategias/{eid}", json={"visibilidad": "publicada",
                                                        "declara_posiciones": "no"},
                      headers=cab(autora))
    assert r.status_code == 200, r.text
    # Publicada no basta: mientras siga en borrador, RLS tampoco la deja ver a un ajeno.
    r = cliente.post(f"/liga/estrategias/{eid}/copiar", headers=cab(otro_pro))
    assert r.status_code == 404, r.text
    assert cliente.post(f"/liga/estrategias/{eid}/apuntar",
                        headers=cab(autora)).status_code == 200

    r = cliente.post(f"/liga/estrategias/{eid}/copiar", headers=cab(otro_pro))
    assert r.status_code == 201, r.text
    copia = r.json()
    assert copia["id"] != eid and copia["nombre"] == "Original (copia)"
    assert copia["estado"] == "borrador"

    receta_copia = cliente.get(f"/liga/estrategias/{copia['id']}",
                               headers=cab(otro_pro)).json()
    assert receta_copia["receta_id"] is not None
    ficha_copia = cliente.get(f"/liga/fichas/{copia['id']}", headers=cab(otro_pro)).json()
    id_receta_copia = ficha_copia["receta"]["id"]
    assert ficha_copia["receta"]["n_empresas"] == 7

    # Cambiar la receta original crea una versión nueva y deja intacta la copia del Pro.
    receta_original_nueva = _receta(cliente, cab, autora, eid, n_empresas=10)
    assert receta_original_nueva["id"] != id_receta_copia
    ficha_copia_despues = cliente.get(f"/liga/fichas/{copia['id']}",
                                      headers=cab(otro_pro)).json()
    assert ficha_copia_despues["receta"]["id"] == id_receta_copia
    assert ficha_copia_despues["receta"]["n_empresas"] == 7

    # La copia es del que copia, no de la autora: la autora no la ve entre las suyas.
    ids_autora = {e["id"] for e in cliente.get("/liga/estrategias", headers=cab(autora)).json()}
    assert copia["id"] not in ids_autora


# ---- créditos: solo los propios -----------------------------------------------------------------


def test_creditos_son_privados(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    uid = usuario()
    r = cliente.get("/liga/creditos", headers=cab(uid))
    assert r.status_code == 200, r.text
    assert r.json() == {"saldo": "0", "total": 0, "movimientos": []}

    otro = usuario()
    assert cliente.get("/liga/creditos", headers=cab(otro)).json()["total"] == 0


# ---- reportes ---------------------------------------------------------------------------------


def test_reportar_y_limite_de_frecuencia(api) -> None:  # noqa: ANN001
    cliente, cab, usuario = api
    uid = usuario()
    r = cliente.post("/liga/reportes", json={"tipo": "alias", "objeto_id": "algo",
                                             "motivo": "Nombre ofensivo"}, headers=cab(uid))
    assert r.status_code == 201, r.text
    assert r.json()["estado"] == "abierto"

    otro = usuario()
    r = cliente.post("/liga/reportes", json={"tipo": "estrategia", "objeto_id": str(uuid.uuid4()),
                                             "motivo": "Copia sin más"}, headers=cab(otro))
    assert r.status_code == 201, r.text
