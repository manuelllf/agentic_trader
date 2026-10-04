"""Conversor «Descríbelo» (plan §10, F6-A): descarta reglas y compañías que no debería devolver,
nunca nombra una empresa y respeta el tope de 5/día. Proveedor simulado, nunca IA real. Contra el
Postgres de pruebas; se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

psycopg = pytest.importorskip("psycopg")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
import app.llm as app_llm  # noqa: E402
from app.liga import db as liga_db  # noqa: E402
from app.liga.ia import conversor  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


class _FakeLLM:
    def __init__(self, contenido: str) -> None:
        self._contenido = contenido

    def chat(self, system: str, user: str, *, temperature: float = 0.0, top_p=None) -> str:  # noqa: ANN001
        return self._contenido


def _get_llm_de(contenido: str):  # noqa: ANN201
    def _get_llm(**kwargs) -> _FakeLLM:  # noqa: ANN003, ANN202
        return _FakeLLM(contenido)
    return _get_llm


@pytest.fixture
def entorno(monkeypatch):  # noqa: ANN001, ANN201
    from app.config import settings

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(settings, "enable_llm", True)

    cx = psycopg.connect(URL, autocommit=True)
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")

    fin = datetime.now(UTC) - timedelta(hours=1)
    fid = cx.execute(
        "insert into foto (alcance, inicio, fin, estado) values "
        "('nasdaq', %s, %s, 'completa') returning id",
        (fin - timedelta(hours=1), fin)).fetchone()[0]
    cx.execute(
        "insert into fundamentals_snapshot (ticker, captured_at, sector, industry, name, "
        "price, market_cap_usd, pe_trailing, high_52w, foto_id) values "
        "(%s, %s, %s, %s, %s, 180, 3e12, 30, 200, %s)",
        ("AAPL", fin, "Technology", "Consumer Electronics", "Apple Inc", fid))

    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
              (uid, f"{uid.hex[:12]}@prueba.local"))

    try:
        yield cx, str(uid)
    finally:
        # `liga.auditoria` es de solo añadir (disparador `solo_anadir`): limpiar de pruebas
        # necesita saltárselo, nunca en producción.
        cx.execute("set session_replication_role = replica")
        cx.execute("delete from liga.auditoria where actor_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from llm_call where stage = 'liga_conversor'")
        cx.execute("delete from fundamentals_snapshot where foto_id = %s", (fid,))
        cx.execute("delete from foto where id = %s", (fid,))
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.execute("delete from liga.ajustes where clave = 'ia.conversor.activo'")
        cx.close()
        motor.dispose()


def test_descarta_reglas_invalidas_y_conserva_las_validas(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, uid = entorno
    bruto = json.dumps({
        "reglas": [
            {"clave": "grandes", "params": {}},
            {"clave": "no_existe", "params": {}},
            {"clave": "deuda", "params": {"anios": 99}},   # fuera de rango: se descarta
            {"clave": "grandes", "params": {}},             # repetida: se descarta
        ],
        "pesos": None, "pregunta": None, "nombre": None,
    })
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    sugerencia, usos = conversor.convertir(uid, "empresas grandes")
    assert usos == 1
    assert sugerencia.reglas == [{"clave": "grandes", "params": {}}]


def test_nunca_nombra_una_empresa(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, uid = entorno
    bruto = json.dumps({
        "reglas": [], "pesos": None,
        "pregunta": "¿Compite Apple Inc con otras tecnológicas?",
        "nombre": "Como Apple Inc",
    })
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    sugerencia, _ = conversor.convertir(uid, "tecnología puntera")
    assert sugerencia.pregunta is None
    assert sugerencia.nombre is None


def test_pesos_fuera_de_catalogo_se_descartan(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, uid = entorno
    bruto = json.dumps({
        "reglas": [], "pesos": {"negocio": 37, "inventado": 10}, "pregunta": None, "nombre": None,
    })
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    sugerencia, _ = conversor.convertir(uid, "algo")
    assert sugerencia.pesos == {"negocio": 35}  # redondeado al paso de 5


def test_interpretacion_se_vincula_a_reglas_validadas_y_detalla_condicion(
    entorno, monkeypatch,  # noqa: ANN001
) -> None:
    _cx, uid = entorno
    bruto = json.dumps({
        "reglas": [
            {"clave": "grandes", "params": {}},
            {"clave": "deuda", "params": {"anios": 2}},
        ],
        "pesos": None, "pregunta": None, "nombre": None,
        "interpretacion": [
            {"intencion": "empresas muy grandes", "tipo": "exacta", "regla": "grandes",
             "motivo": "La intención coincide"},
            {"intencion": "poca deuda", "tipo": "aproximada", "regla": "deuda",
             "motivo": "No se usa el texto libre"},
            {"intencion": "sin energía", "tipo": "exacta", "regla": "sin_energia",
             "motivo": "La clave no está en reglas"},
            {"intencion": "precios exactos futuros", "tipo": "no_disponible", "regla": None,
             "motivo": "No hay regla para predecir precios"},
        ],
    })
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    sugerencia, _ = conversor.convertir(uid, "empresas muy grandes y poca deuda, sin energía")

    assert [(i.intencion, i.tipo, i.regla) for i in sugerencia.interpretacion] == [
        ("empresas muy grandes", "exacta", "grandes"),
        ("poca deuda", "aproximada", "deuda"),
        ("sin energía", "no_disponible", None),
        ("precios exactos futuros", "no_disponible", None),
    ]
    assert sugerencia.interpretacion[0].motivo == conversor.CATALOGO["grandes"].detalle({})
    assert sugerencia.interpretacion[1].motivo == conversor.CATALOGO["deuda"].detalle({"anios": 2})
    assert sugerencia.interpretacion[2].motivo == conversor._MOTIVO_NO_DISPONIBLE


def test_legacy_sin_interpretacion_no_inventa_exactitud(entorno, monkeypatch) -> None:  # noqa: ANN001
    _cx, uid = entorno
    bruto = json.dumps({"reglas": [{"clave": "grandes", "params": {}}], "pesos": None,
                        "pregunta": None, "nombre": None})
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    sugerencia, _ = conversor.convertir(uid, "empresas grandes")
    assert sugerencia.reglas == [{"clave": "grandes", "params": {}}]
    assert sugerencia.interpretacion == []


def test_sexta_llamada_del_dia_da_429(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, uid = entorno
    bruto = json.dumps({"reglas": [], "pesos": None, "pregunta": None, "nombre": None})
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    for _ in range(conversor.TOPE_DIARIO):
        conversor.convertir(uid, "algo")
    with pytest.raises(HTTPException) as exc:
        conversor.convertir(uid, "algo")
    assert exc.value.status_code == 429


def test_interruptor_apagado_da_503(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, uid = entorno
    cx.execute("update liga.ajustes set valor = 'false' where clave = 'ia.conversor.activo'")
    bruto = json.dumps({"reglas": [], "pesos": None, "pregunta": None, "nombre": None})
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(bruto))
    with pytest.raises(HTTPException) as exc:
        conversor.convertir(uid, "algo")
    assert exc.value.status_code == 503


def test_prompt_expone_condiciones_y_campos_reales_del_catalogo() -> None:
    prompt = conversor._catalogo_para_prompt()
    assert "deuda neta inferior a 2 veces el EBITDA" in prompt
    assert "última variación interanual de ventas superior al 5" in prompt
    assert "crecimiento_pct: el crecimiento interanual mínimo (%)" in prompt
    assert "default 5" in prompt
    assert "list of sector keys" in prompt
