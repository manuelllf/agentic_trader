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
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
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


def test_ficha_segun_quien_mira(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, jornada_con_posicion, _cx = api
    foto_con_escaneo(_EMPRESAS)
    duena = usuario(pro=True)  # publicar es de Pro (plan §2.1)
    eid = _crear(cliente, cab, duena, "Publicada")
    receta = _receta(cliente, cab, duena, eid).json()
    jornada_con_posicion(eid, receta["id"], "ZPA", "50.0000")
    # Un borrador no lo ve nadie más que su dueña (plan §7.3): que juegue para que sea visible.
    assert cliente.post(f"/liga/estrategias/{eid}/apuntar", headers=cab(duena)).status_code == 200

    propia = cliente.get(f"/liga/fichas/{eid}", headers=cab(duena)).json()
    assert propia["es_dueno"] is True
    assert propia["receta"]["id"] == receta["id"]
    assert propia["posiciones"] == [{"ticker": "ZPA", "peso": "50.0000"}]

    libre = usuario()
    ajena = cliente.get(f"/liga/fichas/{eid}", headers=cab(libre)).json()
    assert ajena["nombre"] == "Publicada" and ajena["es_dueno"] is False
    assert ajena["receta"] is None and ajena["posiciones"] == []

    # Publicada, la ve un Pro; un Gratis sigue sin verla.
    r = cliente.patch(f"/liga/estrategias/{eid}", json={"visibilidad": "publicada",
                                                        "declara_posiciones": "si"},
                     headers=cab(duena))
    assert r.status_code == 200, r.text
    pro = usuario(pro=True)
    con_pro = cliente.get(f"/liga/fichas/{eid}", headers=cab(pro)).json()
    assert con_pro["receta"]["id"] == receta["id"]
    assert con_pro["posiciones"] == [{"ticker": "ZPA", "peso": "50.0000"}]

    sin_pro = cliente.get(f"/liga/fichas/{eid}", headers=cab(libre)).json()
    assert sin_pro["receta"] is None
