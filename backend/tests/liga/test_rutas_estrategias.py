"""API de estrategias (`/liga`) contra el Postgres de pruebas (se salta sin
`LIGA_TEST_DATABASE_URL`). La foto y el escaneo se crean como sistema (psycopg directo, igual que
`test_liga_publico.py`); las peticiones pasan por un JWT verificado como el usuario, para que RLS
decida de verdad quién ve y quién toca qué. Al final se borra todo lo creado."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.liga.motor.catalogo import regla_por_defecto

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

EMISOR = "https://proyecto.supabase.co"

RECETA_BASICA = {
    "reglas": [regla_por_defecto("sin_tabaco")], "excluidas": [], "pregunta": None,
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
    from app.liga import auth
    from app.liga import db as liga_db
    from app.liga.rutas import router

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    # `db_usuario`/`db_anon` leen `app.liga.db.SessionLocal`; los servicios de sistema de
    # `estrategias.py` (`fabrica_sistema`) importan `app.db.SessionLocal` en cada llamada: hacen
    # falta los dos parches para que ambos caminos usen la BD de pruebas.
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
    creado: dict[str, list] = {"usuarios": [], "fotos": [], "jornadas": [], "temporadas": []}

    def usuario(pro: bool = False) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creado["usuarios"].append(uid)  # ya se limpia aunque falle lo de abajo
        if pro:
            cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                      "values (%s, 'pro', 'demo')", (uid,))
        return str(uid)

    def foto_con_escaneo(empresas: list[tuple[str, str, str, tuple[int, int, int, int]]]
                         ) -> tuple[int, int]:
        fin = datetime.now(UTC) - timedelta(hours=1)
        fid = cx.execute(
            "insert into foto (alcance, inicio, fin, estado) values "
            "('nasdaq', %s, %s, 'completa') returning id",
            (fin - timedelta(hours=1), fin)).fetchone()[0]
        for t, sector, industria, _ in empresas:
            cx.execute(
                "insert into fundamentals_snapshot (ticker, captured_at, sector, industry, name, "
                "price, market_cap_usd, pe_trailing, high_52w, foto_id) values "
                "(%s, %s, %s, %s, %s, 50, 1e9, 15, 60, %s)",
                (t, fin, sector, industria, f"Empresa {t}", fid))
        scan_at = fin + timedelta(minutes=15)
        rid = cx.execute(
            "insert into scan_runs (scan_at, cadence, decide, foto_id) values "
            "(%s, 'decisión/full', true, %s) returning id", (scan_at, fid)).fetchone()[0]
        for t, _, _, notas in empresas:
            cx.execute(
                "insert into scan_audit (scan_at, ticker, scan_run_id, decide, jev_fundamentals, "
                "jev_valuation, jev_financing, jev_catalyst) values (%s,%s,%s,true,%s,%s,%s,%s)",
                (scan_at, t, rid, *notas))
        creado["fotos"].append(fid)
        return fid, rid

    def jornada_con_posicion(estrategia_id: str, receta_id: int, ticker: str, peso: str) -> None:
        tid = cx.execute(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta, estado) values "
            "('T. de prueba', 12, true, 'en_juego') returning id").fetchone()[0]
        creado["temporadas"].append(tid)
        hoy = datetime.now(UTC).date()
        jid = cx.execute(
            "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin, "
            "cierre_inscripcion, estado) values (%s, 1, %s, %s, %s, %s, 'formada') returning id",
            (tid, hoy - timedelta(days=1), hoy, hoy + timedelta(days=27),
             datetime.now(UTC) - timedelta(days=1))).fetchone()[0]
        creado["jornadas"].append(jid)
        iid = cx.execute(
            "insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado) "
            "values (%s, %s, %s, 'formada') returning id", (jid, estrategia_id, receta_id)
        ).fetchone()[0]
        cx.execute("insert into liga.posiciones (inscripcion_id, ticker, peso) values (%s, %s, %s)",
                  (iid, ticker, peso))

    try:
        yield cliente, cab, usuario, foto_con_escaneo, jornada_con_posicion, cx
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.pruebas where usuario_id = %s", (uid,))
            cx.execute("update liga.estrategias set receta_id = null where dueno_id = %s", (uid,))
            cx.execute("delete from liga.recetas where estrategia_id in "
                      "(select id from liga.estrategias where dueno_id = %s)", (uid,))
        cx.execute("set session_replication_role = origin")
        for tid in creado["temporadas"]:
            cx.execute("delete from liga.inscripciones where jornada_id in "
                      "(select id from liga.jornadas where temporada_id = %s)", (tid,))
            cx.execute("delete from liga.jornadas where temporada_id = %s", (tid,))
            cx.execute("delete from liga.temporadas where id = %s", (tid,))
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from liga.planes_usuario where usuario_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        for fid in creado["fotos"]:
            cx.execute("delete from scan_audit where scan_run_id in "
                      "(select id from scan_runs where foto_id = %s)", (fid,))
            cx.execute("delete from scan_runs where foto_id = %s", (fid,))
            cx.execute("delete from fundamentals_snapshot where foto_id = %s", (fid,))
            cx.execute("delete from foto where id = %s", (fid,))
        cx.close()
        motor.dispose()


def _crear(cliente, cab, uid: str, nombre: str = "Foso ancho") -> str:  # noqa: ANN001
    escudo = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68", "color2": "#FFFFFF"}
    r = cliente.post("/liga/estrategias", json={"nombre": nombre, "escudo": escudo},
                     headers=cab(uid))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _receta(cliente, cab, uid: str, eid: str, **cambios) -> dict:  # noqa: ANN001
    body = {**RECETA_BASICA, **cambios}
    return cliente.post(f"/liga/estrategias/{eid}/receta", json=body, headers=cab(uid))


# ---- catálogo ------------------------------------------------------------------------------------


def test_catalogo_es_publico(api) -> None:  # noqa: ANN001
    cliente, *_ = api
    r = cliente.get("/liga/catalogo")
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["version"] >= 1
    assert any(x["clave"] == "deuda" for x in cuerpo["reglas"])
    assert set(cuerpo["pesos"]["claves"]) == {"negocio", "precio", "deuda", "pronto", "pregunta"}
    reglas = {x["clave"]: x for x in cuerpo["reglas"]}
    crecimiento = next(p for p in reglas["crecen"]["parametros"]
                       if p["nombre"] == "crecimiento_pct")
    assert crecimiento["opcional"] is True and crecimiento["defecto"] == 5
    deuda = next(p for p in reglas["deuda"]["parametros"] if p["nombre"] == "anios")
    assert deuda["opcional"] is False


# ---- crear → receta → apuntar --------------------------------------------------------------------


def test_flujo_crear_receta_apuntar(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_ = api
    uid = usuario()
    eid = _crear(cliente, cab, uid)
    assert cliente.get("/liga/estrategias", headers=cab(uid)).json()[0]["id"] == eid

    r = _receta(cliente, cab, uid, eid)
    assert r.status_code == 201, r.text
    receta = r.json()
    assert receta["n_empresas"] == 5 and receta["pesos"]["negocio"] == 50

    ficha = cliente.get(f"/liga/estrategias/{eid}", headers=cab(uid)).json()
    assert ficha["receta_id"] == receta["id"] and ficha["estado"] == "borrador"

    r = cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(uid))
    assert r.status_code == 200 and r.json()["estado"] == "apuntada"

    r = cliente.post(f"/liga/estrategias/{eid}/desapuntar", headers=cab(uid))
    assert r.status_code == 200 and r.json()["estado"] == "borrador"

    r = cliente.post(f"/liga/estrategias/{eid}/cada-dia-1", json={"opcion": "mantener"},
                     headers=cab(uid))
    assert r.status_code == 200 and r.json()["cada_dia_1"] == "mantener"

    # Borrar solo vale con un borrador; una vez apuntada, no.
    cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(uid))
    assert cliente.delete(f"/liga/estrategias/{eid}", headers=cab(uid)).status_code == 409
    cliente.post(f"/liga/estrategias/{eid}/desapuntar", headers=cab(uid))
    assert cliente.delete(f"/liga/estrategias/{eid}", headers=cab(uid)).status_code == 204
    assert cliente.get(f"/liga/estrategias/{eid}", headers=cab(uid)).status_code == 404


# ---- límites de plan y lo que es de Pro ----------------------------------------------------------


def test_limite_gratis_una_en_juego_y_pro_hasta_tres(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_ = api
    gratis = usuario()
    e1 = _crear(cliente, cab, gratis, "Uno")
    _receta(cliente, cab, gratis, e1)
    assert cliente.post(f"/liga/estrategias/{e1}/apuntar", headers=cab(gratis)).status_code == 200

    e2 = _crear(cliente, cab, gratis, "Dos")
    _receta(cliente, cab, gratis, e2)
    r = cliente.post(f"/liga/estrategias/{e2}/apuntar", headers=cab(gratis))
    assert r.status_code == 422 and "plan" in r.json()["detail"].lower()

    pro = usuario(pro=True)
    ids = [_crear(cliente, cab, pro, f"Pro {i}") for i in range(3)]
    for eid in ids:
        _receta(cliente, cab, pro, eid)
        r = cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(pro))
        assert r.status_code == 200, r.text


def test_pregunta_propia_y_publicar_son_de_pro(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_ = api
    gratis = usuario()
    eid = _crear(cliente, cab, gratis)
    r = _receta(cliente, cab, gratis, eid, pregunta="¿Tiene ventaja?",
               pesos={"negocio": 30, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 30})
    assert r.status_code == 403, r.text

    r = cliente.patch(f"/liga/estrategias/{eid}", json={"visibilidad": "publicada",
                                                        "declara_posiciones": "no"},
                      headers=cab(gratis))
    assert r.status_code == 403, r.text

    pro = usuario(pro=True)
    eid_pro = _crear(cliente, cab, pro, "Con pregunta")
    r = _receta(cliente, cab, pro, eid_pro, pregunta="¿Tiene ventaja?",
               pesos={"negocio": 30, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 30})
    assert r.status_code == 201, r.text
    r = cliente.patch(f"/liga/estrategias/{eid_pro}", json={"visibilidad": "publicada",
                                                            "declara_posiciones": "no"},
                      headers=cab(pro))
    assert r.status_code == 200, r.text


def test_preview_exige_cuenta_activa_y_pro_para_pregunta(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, _jornada, cx = api
    foto_con_escaneo(_EMPRESAS)
    cuerpo = {
        **RECETA_BASICA,
        "pregunta": "¿Tiene ventaja competitiva?",
        "pesos": {"negocio": 30, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 30},
    }

    assert cliente.post("/liga/seleccion/preview", json=RECETA_BASICA).status_code == 401

    # A cryptographically valid JWT for a deleted/non-created account is not a player identity.
    sin_perfil = str(uuid.uuid4())
    assert cliente.post("/liga/seleccion/preview", json=RECETA_BASICA,
                        headers=cab(sin_perfil)).status_code == 403

    suspendido = usuario()
    cx.execute("delete from liga.roles_usuario where usuario_id = %s and rol = 'usuario'",
               (suspendido,))
    assert cliente.post("/liga/seleccion/preview", json=RECETA_BASICA,
                        headers=cab(suspendido)).status_code == 403

    gratis = usuario()
    r = cliente.post("/liga/seleccion/preview", json=cuerpo, headers=cab(gratis))
    assert r.status_code == 403 and "Pro" in r.json()["detail"]

    pro = usuario(pro=True)
    r = cliente.post("/liga/seleccion/preview", json=cuerpo, headers=cab(pro))
    assert r.status_code == 200, r.text
    vista = r.json()
    assert vista["estado"] == "incompleto" and vista["sin_respuesta"] == len(_EMPRESAS)
    assert vista["seleccionadas"] == 0


# ---- otro no puede leer ni tocar lo que no es suyo (IDOR) ----------------------------------------


def test_otro_usuario_no_lee_ni_toca_mi_borrador(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_ = api
    a, b = usuario(), usuario()
    eid = _crear(cliente, cab, a)
    _receta(cliente, cab, a, eid)

    assert cliente.get(f"/liga/estrategias/{eid}", headers=cab(b)).status_code == 404
    assert cliente.patch(f"/liga/estrategias/{eid}", json={"nombre": "Robada"},
                         headers=cab(b)).status_code == 404
    assert cliente.delete(f"/liga/estrategias/{eid}", headers=cab(b)).status_code in (403, 404)
    r = _receta(cliente, cab, b, eid)
    assert r.status_code == 403, r.text
    assert cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(b)).status_code == 404

    # Sigue intacta para su dueña.
    assert cliente.get(f"/liga/estrategias/{eid}", headers=cab(a)).status_code == 200


# ---- exclusiones crean versión nueva -------------------------------------------------------------


def test_excluir_crea_una_version_nueva_de_la_receta(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, *_ = api
    uid = usuario()
    eid = _crear(cliente, cab, uid)
    r1 = _receta(cliente, cab, uid, eid).json()

    r = cliente.post(f"/liga/estrategias/{eid}/exclusiones/zqx", headers=cab(uid))
    assert r.status_code == 200, r.text
    r2 = r.json()
    assert r2["id"] != r1["id"] and r2["excluidas"] == ["ZQX"]

    # Repetir la misma exclusión no crea una tercera versión.
    r = cliente.post(f"/liga/estrategias/{eid}/exclusiones/ZQX", headers=cab(uid))
    assert r.json()["id"] == r2["id"]

    r = cliente.delete(f"/liga/estrategias/{eid}/exclusiones/zqx", headers=cab(uid))
    assert r.status_code == 200
    r3 = r.json()
    assert r3["id"] not in (r1["id"], r2["id"]) and r3["excluidas"] == []


# ---- «ver qué entraría hoy», su histórico, «por qué» y el buscador -------------------------------


_EMPRESAS = [
    ("ZPA", "Technology", "Software - Application", (900, 800, 700, 600)),
    ("ZPB", "Healthcare", "Biotechnology", (850, 750, 650, 550)),
    ("ZPC", "Energy", "Oil & Gas E&P", (800, 700, 600, 500)),
    ("ZPD", "Industrials", "Airlines", (750, 650, 550, 450)),
    ("ZPE", "Utilities", "Utilities - Regulated Electric", (700, 600, 500, 400)),
]


def test_prueba_por_que_y_buscador(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, _jornada, _cx = api
    foto_id, scan_id = foto_con_escaneo(_EMPRESAS)
    uid = usuario()
    eid = _crear(cliente, cab, uid)
    _receta(cliente, cab, uid, eid, n_empresas=3)

    r = cliente.post(f"/liga/estrategias/{eid}/pruebas", headers=cab(uid))
    assert r.status_code == 200, r.text
    prueba = r.json()
    assert (prueba["foto_id"], prueba["scan_run_id"]) == (foto_id, scan_id)
    assert [e["ticker"] for e in prueba["elegidas"]] == ["ZPA", "ZPB", "ZPC"]
    assert prueba["evaluadas"] == len(_EMPRESAS) and prueba["pasan"] == len(_EMPRESAS)

    r2 = cliente.get(f"/liga/pruebas/{prueba['id']}", headers=cab(uid))
    assert r2.status_code == 200 and r2.json()["elegidas"] == prueba["elegidas"]

    otro = usuario()
    assert cliente.get(f"/liga/pruebas/{prueba['id']}", headers=cab(otro)).status_code == 404

    r = cliente.get(f"/liga/estrategias/{eid}/por-que/ZPD", headers=cab(uid))
    assert r.status_code == 200
    assert "entran las 3 primeras" in r.json()["motivo"]

    r = cliente.get("/liga/universo/buscar", params={"q": "ZP"}, headers=cab(uid))
    assert r.status_code == 200
    tickers = {f["ticker"] for f in r.json()}
    assert tickers == {t for t, *_ in _EMPRESAS}
    assert set(r.json()[0]) == {"ticker", "nombre", "sector"}


# ---- ficha: qué ve cada uno ----------------------------------------------------------------------


def test_ventana_de_cambios_por_la_api(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, _jornada, cx = api
    uid = usuario()
    eid = _crear(cliente, cab, uid)
    receta = _receta(cliente, cab, uid, eid).json()
    assert cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(uid)).status_code == 200
    assert cliente.get("/liga/estrategias/ventana", headers=cab(uid)).json() == []

    # Una jornada ya formada cuyo corte pasó y que empieza mañana, con los cierres del día base.
    foto_id, scan_id = foto_con_escaneo(_EMPRESAS)
    hoy = datetime.now(UTC).date()
    tid = cx.execute("insert into liga.temporadas (nombre, n_jornadas, cuenta, estado) values "
                     "('T. de ventana', 12, true, 'en_juego') returning id").fetchone()[0]
    jid = cx.execute(
        "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin, "
        "cierre_inscripcion, estado, foto_id, scan_run_id) "
        "values (%s, 1, %s, %s, %s, %s, 'formada', %s, %s) returning id",
        (tid, hoy, hoy + timedelta(days=1), hoy + timedelta(days=28),
         datetime.now(UTC) - timedelta(hours=1), foto_id, scan_id)).fetchone()[0]
    iid = cx.execute("insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, "
                     "estado) values (%s, %s, %s, 'formada') returning id",
                     (jid, eid, receta["id"])).fetchone()[0]
    for t, *_ in _EMPRESAS:
        cx.execute("insert into liga.posiciones (inscripcion_id, ticker, peso) values (%s, %s, 20)",
                   (iid, t))
        cx.execute("insert into precio_cierre (ticker, dia, cierre, fuente) "
                   "values (%s, %s, 50, 'prueba')", (t, hoy))

    def posiciones() -> set[str]:
        return {f[0] for f in cx.execute(
            "select ticker from liga.posiciones where inscripcion_id = %s", (iid,)).fetchall()}

    try:
        [v] = cliente.get("/liga/estrategias/ventana", headers=cab(uid)).json()
        assert (v["estrategia_id"], v["fase"], v["quitadas_formacion"]) == (eid, "cambios", [])
        assert {e["ticker"] for e in v["cartera"]} == {t for t, *_ in _EMPRESAS}
        assert {e["nombre"] for e in v["cartera"]} == {f"Empresa {t}" for t, *_ in _EMPRESAS}
        assert v["quitadas"] == []
        # Hasta que abra la jornada solo Cambiar y Recuperar: lo demás se rechaza.
        assert _receta(cliente, cab, uid, eid).status_code == 409
        assert cliente.post(f"/liga/estrategias/{eid}/cada-dia-1", json={"opcion": "mantener"},
                            headers=cab(uid)).status_code == 409

        r = cliente.post(f"/liga/estrategias/{eid}/exclusiones/zpa", headers=cab(uid))
        assert r.status_code == 200, r.text
        assert r.json()["excluidas"] == ["ZPA"]
        assert posiciones() == {"ZPB", "ZPC", "ZPD", "ZPE"}
        [v] = cliente.get("/liga/estrategias/ventana", headers=cab(uid)).json()
        assert v["quitadas_formacion"] == []           # la de la formación sigue sin quitadas
        assert v["quitadas"] == [{"ticker": "ZPA", "nombre": "Empresa ZPA"}]
        assert {e["ticker"] for e in v["cartera"]} == {"ZPB", "ZPC", "ZPD", "ZPE"}

        r = cliente.post(f"/liga/estrategias/{eid}/formacion/volver", headers=cab(uid))
        assert r.status_code == 200 and r.json()["id"] == receta["id"]
        assert posiciones() == {t for t, *_ in _EMPRESAS}
        # Otro usuario no toca la estrategia ajena.
        otro = usuario()
        assert cliente.post(f"/liga/estrategias/{eid}/formacion/volver",
                            headers=cab(otro)).status_code == 404
    finally:
        cx.execute("delete from precio_cierre where dia = %s and fuente = 'prueba'", (hoy,))
        cx.execute("delete from liga.inscripciones where jornada_id = %s", (jid,))
        cx.execute("delete from liga.jornadas where id = %s", (jid,))
        cx.execute("delete from liga.temporadas where id = %s", (tid,))


def test_ficha_segun_quien_mira(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, jornada_con_posicion, cx = api
    foto_con_escaneo(_EMPRESAS)
    duena = usuario(pro=True)  # publicar es de Pro (plan §2.1)
    eid = _crear(cliente, cab, duena, "Publicada")
    receta = _receta(cliente, cab, duena, eid).json()
    jornada_con_posicion(eid, receta["id"], "ZPA", "50.0000")
    # Un borrador no lo ve nadie más que su dueña (plan §7.3): que juegue para que sea visible.
    assert cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(duena)).status_code == 200
    temporada, dia_base = cx.execute("""
        select j.temporada_id, j.dia_fin
        from liga.jornadas j join liga.inscripciones i on i.jornada_id = j.id
        where i.estrategia_id = %s order by j.id desc limit 1
    """, (eid,)).fetchone()
    jornada_pendiente = cx.execute("""
        insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                   cierre_inscripcion, estado)
        values (%s, 2, %s, %s, %s, %s, 'programada') returning id
    """, (temporada, dia_base, dia_base + timedelta(days=1), dia_base + timedelta(days=28),
          datetime.now(UTC) + timedelta(days=28))).fetchone()[0]
    cx.execute("""
        insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado)
        values (%s, %s, %s, 'inscrita')
    """, (jornada_pendiente, eid, receta["id"]))

    propia = cliente.get(f"/liga/fichas/{eid}", headers=cab(duena)).json()
    assert propia["es_dueno"] is True
    assert propia["receta"]["id"] == receta["id"]
    assert propia["posiciones"] == [{"ticker": "ZPA", "peso": "50.0000"}]

    libre = usuario()
    ajena = cliente.get(f"/liga/fichas/{eid}", headers=cab(libre)).json()
    assert ajena["nombre"] == "Publicada" and ajena["es_dueno"] is False
    assert ajena["receta"] is None and ajena["posiciones"] == []
    assert ajena["rendimiento"]["estado"] == "privado"
    assert ajena["rendimiento"]["serie"] == []

    # Publicada, la ve un Pro; un Gratis sigue sin verla.
    r = cliente.patch(f"/liga/estrategias/{eid}", json={"visibilidad": "publicada",
                                                        "declara_posiciones": "si"},
                     headers=cab(duena))
    assert r.status_code == 200, r.text
    pro = usuario(pro=True)
    con_pro = cliente.get(f"/liga/fichas/{eid}", headers=cab(pro)).json()
    assert con_pro["receta"]["id"] == receta["id"]
    assert con_pro["posiciones"] == [{"ticker": "ZPA", "peso": "50.0000"}]
    assert con_pro["rendimiento"]["estado"] == "sin_datos"

    sin_pro = cliente.get(f"/liga/fichas/{eid}", headers=cab(libre)).json()
    assert sin_pro["receta"] is None
