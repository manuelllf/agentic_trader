"""Pregunta propia con Jev (F6-B): mapeo de probabilidad, caché compartida, reserva/liquidación
de créditos y el tope de candidatas. Proveedor simulado (`app.llm.jev.preguntar_noul`), nunca IA
real. Contra el Postgres de pruebas; se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest

psycopg = pytest.importorskip("psycopg")

from app.liga.ia import pregunta  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")

RECETA_CON_PREGUNTA = {
    "reglas": [], "excluidas": [], "pregunta": "¿Tiene ventaja competitiva clara?",
    "pesos": {"negocio": 30, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 30},
    "n_empresas": 3, "reparto": "igual", "max_por_sector": 0,
}

_EMPRESAS = [
    ("ZRA", "Technology", "Software - Application", (900, 800, 700, 600)),
    ("ZRB", "Healthcare", "Biotechnology", (850, 750, 650, 550)),
    ("ZRC", "Energy", "Oil & Gas E&P", (800, 700, 600, 500)),
    ("ZRD", "Industrials", "Airlines", (750, 650, 550, 450)),
]


# ---- mapeo puro (sin BD) ---------------------------------------------------------------------


def test_mapeo_de_probabilidad_a_si_no_y_seguridad() -> None:
    assert pregunta._seguridad(0.9) == (True, "alta")
    assert pregunta._seguridad(0.85) == (True, "alta")
    assert pregunta._seguridad(0.7) == (True, "media")
    assert pregunta._seguridad(0.55) == (True, "baja")
    assert pregunta._seguridad(0.45) == (False, "baja")
    assert pregunta._seguridad(0.2) == (False, "media")
    assert pregunta._seguridad(0.05) == (False, "alta")


# ---- flujo completo contra la BD de pruebas --------------------------------------------------


@pytest.fixture
def api(monkeypatch):  # noqa: ANN001, ANN201
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    import app.llm.jev as jev_mod
    from app.config import settings
    from app.liga import auth
    from app.liga import db as liga_db
    from app.liga.rutas import router

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):  # noqa: ANN001, ANN202
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", "https://proyecto.supabase.co")
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())
    monkeypatch.setattr(settings, "enable_llm", True)
    monkeypatch.setattr(settings, "typesafe_api_key", "clave-de-prueba")

    # Jev simulado: sí con seguridad alta para todas, sin llamar a nada real.
    llamadas: list[str] = []

    def _preguntar_noul(*, api_key, model, stage, state, pregunta, recorder=None, timeout=30.0):  # noqa: ANN001
        llamadas.append(state)
        info = {"tokens_entrada": 50, "tokens_salida": 0, "coste_usd": 0.000002,
               "latencia_ms": 80, "ok": True, "error": None}
        return (0.9, 0.95), info

    monkeypatch.setattr(jev_mod, "preguntar_noul", _preguntar_noul)

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
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.pregunta.activo', 'true')")
    creado: dict[str, list] = {"usuarios": [], "fotos": []}

    def usuario(creditos: int = 0) -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        cx.execute("insert into liga.planes_usuario (usuario_id, plan, origen) "
                  "values (%s, 'pro', 'demo')", (uid,))
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

    try:
        yield cliente, cab, usuario, foto_con_escaneo, cx, llamadas
    finally:
        cx.execute("set session_replication_role = replica")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.pruebas where usuario_id = %s", (uid,))
            cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
            cx.execute("delete from liga.auditoria where actor_id = %s", (uid,))
            cx.execute("update liga.estrategias set receta_id = null where dueno_id = %s", (uid,))
            cx.execute("delete from liga.recetas where estrategia_id in "
                      "(select id from liga.estrategias where dueno_id = %s)", (uid,))
        cx.execute("set session_replication_role = origin")
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from liga.planes_usuario where usuario_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        for fid in creado["fotos"]:
            cx.execute("delete from liga.respuestas_ia where foto_id = %s", (fid,))
            cx.execute("delete from llm_call where stage = 'liga_pregunta'")
            cx.execute("delete from scan_audit where scan_run_id in "
                      "(select id from scan_runs where foto_id = %s)", (fid,))
            cx.execute("delete from scan_runs where foto_id = %s", (fid,))
            cx.execute("delete from fundamentals_snapshot where foto_id = %s", (fid,))
            cx.execute("delete from foto where id = %s", (fid,))
        cx.execute("delete from liga.ajustes where clave like 'ia.%'")
        cx.close()
        motor.dispose()


def _crear_con_pregunta(cliente, cab, uid: str) -> str:  # noqa: ANN001
    escudo = {"forma": "escudo", "dibujo": "liso", "color1": "#0B6E68", "color2": "#FFFFFF"}
    r = cliente.post("/liga/estrategias", json={"nombre": "Con pregunta", "escudo": escudo},
                     headers=cab(uid))
    eid = r.json()["id"]
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=RECETA_CON_PREGUNTA, headers=cab(uid))
    assert r.status_code == 201, r.text
    return eid


def test_coste_antes_de_probar_dice_cuantas_faltan(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, _cx, _llamadas = api
    foto_con_escaneo()
    uid = usuario()
    eid = _crear_con_pregunta(cliente, cab, uid)
    r = cliente.get(f"/liga/estrategias/{eid}/pruebas/coste", headers=cab(uid))
    assert r.status_code == 200, r.text
    coste = r.json()
    assert coste["evaluadas"] == len(_EMPRESAS)
    assert coste["en_cache"] == 0 and coste["faltan"] == len(_EMPRESAS)
    assert coste["creditos"] == str(max(1, len(_EMPRESAS) * 10 // 1000 or 1))


def test_probar_con_pregunta_cobra_evalua_y_cachea(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, cx, llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)

    idem = uuid.uuid4().hex
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": idem}, headers=cab(uid))
    assert r.status_code == 200, r.text
    prueba = r.json()
    assert prueba["pregunta_desde_cache"] == 0
    assert prueba["pregunta_nuevas"] == len(_EMPRESAS)
    assert len(llamadas) == len(_EMPRESAS)

    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 99  # 100 - 1 crédito (precio_pregunta de 4 evaluadas = ceil(4*10/1000) = 1)

    llamadas.clear()
    r2 = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                      json={"con_pregunta": True, "idempotencia": uuid.uuid4().hex},
                      headers=cab(uid))
    assert r2.status_code == 200, r2.text
    # Ya está todo en caché: la segunda vez no llama a Jev, pero D16 igual cobra.
    assert r2.json()["pregunta_desde_cache"] == len(_EMPRESAS)
    assert r2.json()["pregunta_nuevas"] == 0
    assert not llamadas

    saldo2 = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                       (uuid.UUID(uid),)).fetchone()[0]
    assert saldo2 == 98


def test_reintentar_con_la_misma_clave_no_cobra_dos_veces(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, cx, _llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)
    idem = uuid.uuid4().hex
    for _ in range(2):
        r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                         json={"con_pregunta": True, "idempotencia": idem}, headers=cab(uid))
        assert r.status_code == 200, r.text
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 99


def test_misma_clave_con_otra_receta_es_un_gasto_nuevo(api) -> None:  # noqa: ANN001
    """Reutilizar la clave con otra pregunta no puede lanzar llamadas sin reservar ni cobrar."""
    cliente, cab, usuario, foto_con_escaneo, cx, llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)
    idem = uuid.uuid4().hex
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": idem}, headers=cab(uid))
    assert r.status_code == 200, r.text

    otra = {**RECETA_CON_PREGUNTA, "pregunta": "¿Genera caja de forma recurrente?"}
    r = cliente.post(f"/liga/estrategias/{eid}/receta", json=otra, headers=cab(uid))
    assert r.status_code == 201, r.text
    llamadas.clear()
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": idem}, headers=cab(uid))
    assert r.status_code == 200, r.text
    assert llamadas, "la pregunta nueva sí llama al proveedor"
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 98


def test_con_el_saldo_justo_se_puede_pagar_la_prueba(api) -> None:  # noqa: ANN001
    """Con exactamente el precio en saldo, reservar deja 0 y liquidar no puede fallar por ello."""
    cliente, cab, usuario, foto_con_escaneo, cx, _llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=1)
    eid = _crear_con_pregunta(cliente, cab, uid)
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 200, r.text
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 0


def test_sin_creditos_suficientes_da_402(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, _cx, _llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=0)
    eid = _crear_con_pregunta(cliente, cab, uid)
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 402, r.text


def test_jev_falla_para_todas_no_cobra_nada(api, monkeypatch) -> None:  # noqa: ANN001
    """Hallazgo de dinero #4: si el proveedor falla para TODAS las candidatas que faltaban (0
    entregadas), no se cobra el precio entero -- la reserva se devuelve entera."""
    cliente, cab, usuario, foto_con_escaneo, cx, _llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)

    import app.llm.jev as jev_mod

    def _fallo(*, api_key, model, stage, state, pregunta, recorder=None, timeout=30.0):  # noqa: ANN001
        info = {"tokens_entrada": 10, "tokens_salida": 0, "coste_usd": 0.0000001,
               "latencia_ms": 50, "ok": False, "error": "TimeoutError: el proveedor no responde"}
        return None, info

    monkeypatch.setattr(jev_mod, "preguntar_noul", _fallo)

    r = cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["pregunta_nuevas"] == 0
    assert cuerpo["creditos_cobrados"] == "0"
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 100  # nada entregado -> nada cobrado, la reserva vuelve entera


def test_fallo_tras_responder_la_pregunta_devuelve_la_reserva_entera(api, monkeypatch) -> None:  # noqa: ANN001
    """Hallazgo CRÍTICO de dinero #1: si algo revienta DESPUÉS de responder la pregunta (créditos
    ya reservados) pero ANTES de liquidar (aquí, `crear_prueba_sistema`), la reserva no debe
    quedarse descontada para siempre -- tiene que devolverse entera."""
    cliente, cab, usuario, foto_con_escaneo, cx, llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)

    from app.liga import estrategias as estrategias_mod

    def _revienta(*_args, **_kwargs):  # noqa: ANN003, ANN202
        raise RuntimeError("fallo simulado tras responder la pregunta")

    monkeypatch.setattr(estrategias_mod, "crear_prueba_sistema", _revienta)

    with pytest.raises(RuntimeError):
        cliente.post(f"/liga/estrategias/{eid}/pruebas",
                     json={"con_pregunta": True, "idempotencia": uuid.uuid4().hex},
                     headers=cab(uid))
    # La pregunta SÍ se respondió (créditos reservados y gastados en la llamada a Jev)...
    assert llamadas
    # ...pero como todo lo posterior está en el mismo `try`, la reserva entera vuelve al usuario.
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 100


def test_sin_con_pregunta_no_cobra_ni_llama(api) -> None:  # noqa: ANN001
    cliente, cab, usuario, foto_con_escaneo, cx, llamadas = api
    foto_con_escaneo()
    uid = usuario(creditos=100)
    eid = _crear_con_pregunta(cliente, cab, uid)
    r = cliente.post(f"/liga/estrategias/{eid}/pruebas", headers=cab(uid))
    assert r.status_code == 200, r.text
    assert r.json()["pregunta_desde_cache"] is None
    assert not llamadas
    saldo = cx.execute("select saldo from liga.v_saldo where usuario_id = %s",
                      (uuid.UUID(uid),)).fetchone()[0]
    assert saldo == 100
