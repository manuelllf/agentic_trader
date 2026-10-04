"""«Leer a fondo» / «Leer mi cartera» (F6-B): caché, reuso del informe de Alpha sin llamar a
nada, cobro de créditos idempotente y qué puede leer cada usuario. Proveedor simulado siempre
que hace falta un LLM; contra el Postgres de pruebas, se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest

psycopg = pytest.importorskip("psycopg")

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

RECETA_BASICA = {
    "reglas": [], "excluidas": [], "pregunta": None,
    "pesos": {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
    "n_empresas": 3, "reparto": "igual", "max_por_sector": 0,
}

_EMPRESAS = [
    ("ZSA", "Technology", "Software - Application", (900, 800, 700, 600)),
    ("ZSB", "Healthcare", "Biotechnology", (850, 750, 650, 550)),
    ("ZSC", "Energy", "Oil & Gas E&P", (800, 700, 600, 500)),
]


@pytest.fixture(autouse=True)
def sin_llm_real(monkeypatch):  # noqa: ANN001, ANN201
    from app.liga.ia import comun

    def prohibida(**_kwargs):  # noqa: ANN003, ANN202
        raise AssertionError("Este fichero no puede llamar a una API LLM.")

    monkeypatch.setattr(comun, "llamar_ia", prohibida)


@pytest.fixture
def api(monkeypatch):  # noqa: ANN001, ANN201
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

    monkeypatch.setattr(auth.settings, "supabase_url", "https://proyecto.supabase.co")
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    def token(uid: str, aal: str = "aal1") -> str:
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                 "iss": "https://proyecto.supabase.co/auth/v1", "exp": ahora + 3600,
                 "iat": ahora, "aal": aal}
        return jwt.encode(claims, clave, algorithm="ES256")

    def cab(uid: str) -> dict:
        return {"Authorization": f"Bearer {token(uid)}"}

    app = FastAPI()
    app.include_router(router)
    cliente = TestClient(app)

    cx = psycopg.connect(URL, autocommit=True)
    creado: dict[str, list] = {"usuarios": [], "fotos": []}

    def usuario(creditos: int = 0) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creado["usuarios"].append(uid)
        if creditos:
            cx.execute("select liga.cargar_creditos(%s, %s, 'regalo', %s)",
                      (uid, creditos, uuid.uuid4().hex))
        return str(uid)

    def foto_con_escaneo() -> tuple[int, int]:
        fin = datetime.now(UTC) - timedelta(hours=1)
        fid = cx.execute(
            "insert into foto (alcance, inicio, fin, estado) values "
            "('nasdaq', %s, %s, 'completa') returning id",
            (fin - timedelta(hours=1), fin)).fetchone()[0]
        for t, sector, industria, _ in _EMPRESAS:
            cx.execute(
                "insert into fundamentals_snapshot (ticker, captured_at, sector, industry, "
                "name, price, market_cap_usd, pe_trailing, high_52w, foto_id) values "
                "(%s, %s, %s, %s, %s, 50, 1e9, 15, 60, %s)",
                (t, fin, sector, industria, f"Empresa {t}", fid))
        scan_at = fin + timedelta(minutes=15)
        rid = cx.execute(
            "insert into scan_runs (scan_at, cadence, decide, foto_id) values "
            "(%s, 'decisión/full', true, %s) returning id", (scan_at, fid)).fetchone()[0]
        for t, _, _, notas in _EMPRESAS:
            cx.execute(
                "insert into scan_audit (scan_at, ticker, scan_run_id, decide, jev_fundamentals, "
                "jev_valuation, jev_financing, jev_catalyst) values (%s,%s,%s,true,%s,%s,%s,%s)",
                (scan_at, t, rid, *notas))
        creado["fotos"].append(fid)
        return fid, rid

    def finalista(scan_run_id: int, ticker: str, texto: str) -> None:
        cx.execute(
            "insert into scan_run_finalist (scan_run_id, posicion, ticker, report) "
            "values (%s, 1, %s, %s)", (scan_run_id, ticker, texto))

    try:
        yield cliente, cab, usuario, foto_con_escaneo, finalista, cx
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.pruebas where usuario_id = %s", (uid,))
            cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
            cx.execute("update liga.estrategias set receta_id = null where dueno_id = %s", (uid,))
            cx.execute("delete from liga.recetas where estrategia_id in "
                      "(select id from liga.estrategias where dueno_id = %s)", (uid,))
        cx.execute("set session_replication_role = origin")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        for fid in creado["fotos"]:
            cx.execute("delete from liga.lecturas where foto_id = %s", (fid,))
            cx.execute("delete from scan_run_finalist where scan_run_id in "
                      "(select id from scan_runs where foto_id = %s)", (fid,))
            cx.execute("delete from scan_audit where scan_run_id in "
                      "(select id from scan_runs where foto_id = %s)", (fid,))
            cx.execute("delete from scan_runs where foto_id = %s", (fid,))
            cx.execute("delete from fundamentals_snapshot where foto_id = %s", (fid,))
            cx.execute("delete from foto where id = %s", (fid,))
        cx.close()
        motor.dispose()


def _crear_y_probar(cliente, cab, uid: str) -> tuple[str, dict]:  # noqa: ANN001
    escudo = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68", "color2": "#FFFFFF"}
    r = cliente.post("/liga/estrategias", json={"nombre": "Lectora", "escudo": escudo},
                     headers=cab(uid))
    eid = r.json()["id"]
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=RECETA_BASICA, headers=cab(uid))
    assert r.status_code == 201, r.text
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas", headers=cab(uid))
    assert r.status_code == 200, r.text
    return eid, r.json()


def test_lectura_solo_de_una_elegida_reusa_el_informe_de_alpha_sin_llamar(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, finalista, cx = api
    _fid, rid = foto_con_escaneo()
    finalista(rid, "ZSA", "Informe profundo real de ZSA, ya escrito por Alpha.")
    uid = usuario(creditos=100)
    _eid, prueba = _crear_y_probar(cliente, cab, uid)
    assert "ZSA" in [e["ticker"] for e in prueba["elegidas"]]

    r = cliente.post("/liga/lecturas/ZSA", json={"idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["texto"] == "Informe profundo real de ZSA, ya escrito por Alpha."
    assert cuerpo["creditos_cobrados"] == "5"

    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 95

    # Volver a comprarla no cobra otra vez (ya es suya) y sirve la misma de caché.
    r2 = cliente.post("/liga/lecturas/ZSA", json={"idempotencia": uuid.uuid4().hex},
                      headers=cab(uid))
    assert r2.status_code == 200
    assert r2.json()["creditos_cobrados"] == "0"
    saldo2 = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                       (uuid.UUID(uid),)).fetchone()[0]
    assert saldo2 == 95


def test_lectura_de_empresa_ajena_es_404(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, finalista, _cx = api
    _fid, rid = foto_con_escaneo()
    finalista(rid, "ZSA", "Informe de ZSA.")
    uid = usuario(creditos=100)
    _crear_y_probar(cliente, cab, uid)
    # ZSD no existe en la foto de este mundo -- nunca puede ser una elegida ni una posición.
    r = cliente.post("/liga/lecturas/ZSD", json={"idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 404, r.text


def test_contexto_explicito_y_recuperacion_solo_del_dueno(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, finalista, _cx = api
    _fid, rid = foto_con_escaneo()
    finalista(rid, "ZSA", "Informe comprado de la prueba original.")
    uid = usuario(creditos=100)
    eid, prueba = _crear_y_probar(cliente, cab, uid)
    ruta = f"/liga/estrategias/{eid}/lecturas?prueba_id={prueba['id']}"
    assert cliente.get(ruta, headers=cab(uid)).json() == []
    compra = cliente.post("/liga/lecturas/ZSA", headers=cab(uid), json={
        "idempotencia": uuid.uuid4().hex, "estrategia_id": eid, "prueba_id": prueba["id"]})
    assert compra.status_code == 200, compra.text
    recuperadas = cliente.get(ruta, headers=cab(uid))
    assert recuperadas.status_code == 200
    assert recuperadas.json()[0]["id"] == compra.json()["id"]
    assert recuperadas.json()[0]["creditos_cobrados"] == "0"
    assert cliente.get(ruta, headers=cab(usuario())).status_code == 404


def test_ver_lectura_solo_si_la_compraste(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, finalista, _cx = api
    _fid, rid = foto_con_escaneo()
    finalista(rid, "ZSA", "Informe de ZSA.")
    compradora = usuario(creditos=100)
    _crear_y_probar(cliente, cab, compradora)
    r = cliente.post("/liga/lecturas/ZSA", json={"idempotencia": uuid.uuid4().hex},
                     headers=cab(compradora))
    lectura_id = r.json()["id"]

    otro = usuario()
    assert cliente.get(f"/liga/lecturas/{lectura_id}", headers=cab(otro)).status_code == 404
    r2 = cliente.get(f"/liga/lecturas/{lectura_id}", headers=cab(compradora))
    assert r2.status_code == 200 and r2.json()["ticker"] == "ZSA"


def test_comprar_la_misma_lectura_a_la_vez_no_duplica_el_cobro(api) -> None:  # noqa: ANN001
    """Hallazgo de dinero #5: dos peticiones casi simultáneas al MISMO ticker (doble click,
    reintento de red, dos pestañas) no deben cobrar dos veces -- la idempotencia se deriva en el
    servidor de (usuario, lectura), no de una clave que manda el cliente distinta en cada click."""
    import threading

    from app.liga.ia import lectura as lectura_mod

    cliente, cab, usuario, foto_con_escaneo, finalista, cx = api
    fid, rid = foto_con_escaneo()
    finalista(rid, "ZSA", "Informe de ZSA.")
    uid = usuario(creditos=100)
    _crear_y_probar(cliente, cab, uid)
    # La fila de `liga.lecturas` se crea aparte, fuera de la carrera: la creación concurrente de
    # la MISMA lectura nueva es una carrera distinta (de creación, no de dinero) y no es lo que
    # este test comprueba -- aquí solo importa que el COBRO no se duplique.
    assert lectura_mod.obtener_o_crear("ZSA", fid, rid, uid) is not None

    respuestas: list = []
    lock = threading.Lock()

    def _pedir() -> None:
        r = cliente.post("/liga/lecturas/ZSA", json={"idempotencia": uuid.uuid4().hex},
                         headers=cab(uid))
        with lock:
            respuestas.append(r)

    hilos = [threading.Thread(target=_pedir) for _ in range(6)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()

    assert all(r.status_code == 200 for r in respuestas), [r.text for r in respuestas]
    total_cobrado = sum(int(r.json()["creditos_cobrados"]) for r in respuestas)
    assert total_cobrado == 5  # una sola vez, sea cual sea el orden real de llegada

    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 95
    n_movimientos = cx.execute(
        "select count(*) from liga.creditos_movimientos "
        "where usuario_id = %s and motivo = 'lectura'",
        (uuid.UUID(uid),)).fetchone()[0]
    assert n_movimientos == 1


def test_leer_mi_cartera_cobra_solo_las_no_compradas(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, finalista, cx = api
    _fid, rid = foto_con_escaneo()
    for t in ("ZSA", "ZSB", "ZSC"):
        finalista(rid, t, f"Informe de {t}.")
    uid = usuario(creditos=100)
    eid, prueba = _crear_y_probar(cliente, cab, uid)
    tickers = [e["ticker"] for e in prueba["elegidas"]]
    assert len(tickers) == 3

    # Ya compró una antes de pedir «leer mi cartera»: esa no debe cobrarse de nuevo.
    cliente.post(f"/liga/lecturas/{tickers[0]}", json={"idempotencia": uuid.uuid4().hex},
                headers=cab(uid))
    saldo_tras_una = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                              (uuid.UUID(uid),)).fetchone()[0]
    assert saldo_tras_una == 95

    r = cliente.post(f"/liga/estrategias/{eid}/lecturas", json={"idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert len(cuerpo["lecturas"]) == 3
    assert cuerpo["creditos_cobrados"] == "10"  # 2 nuevas x 5, la primera ya era suya

    saldo_final = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                           (uuid.UUID(uid),)).fetchone()[0]
    assert saldo_final == 85
