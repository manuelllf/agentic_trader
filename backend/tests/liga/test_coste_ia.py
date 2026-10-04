"""Panel de coste de IA (`gestion.coste_ia`, plan §10.5 y §16, F6.5): números exactos sobre filas
sembradas a mano, por finalidad y mes — nunca estimados. Contra el Postgres de pruebas; se salta
sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta

import pytest

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
from app.liga import gestion  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def entorno(monkeypatch):  # noqa: ANN001, ANN201
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)

    cx = psycopg.connect(URL, autocommit=True)
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
              (uid, f"{uid.hex[:12]}@prueba.local"))

    try:
        yield cx, uid
    finally:
        # `liga.creditos_movimientos` es de solo añadir (disparador `solo_anadir`): limpiar de
        # pruebas necesita saltárselo, nunca en producción.
        cx.execute("set session_replication_role = replica")
        cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from llm_call where stage like 'liga_%'")
        cx.execute("delete from liga.ajustes where clave like 'ia.%'")
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def _llm_call(cx, stage: str, cuando: datetime, coste: float) -> None:  # noqa: ANN001
    cx.execute("""
        insert into llm_call (at, stage, model, prompt_cache_hit_tokens,
                              prompt_cache_miss_tokens, completion_tokens, cost_usd, ok)
        values (%s, %s, 'deepseek-flash', 0, 10, 5, %s, true)
    """, (cuando, stage, coste))


def test_pagado_y_cobrado_por_finalidad_en_el_mes(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    # El mes de la BASE (UTC), no el del ordenador: entre las 00:00 y las 02:00 de Madrid del día 1
    # el ordenador ya está en el mes nuevo y la base todavía en el anterior.
    mes = cx.execute("select date_trunc('month', now())::date").fetchone()[0]
    dentro = datetime.combine(mes, datetime.min.time()) + timedelta(days=1, hours=12)
    fuera = datetime.combine(mes, datetime.min.time()) - timedelta(days=5)

    _llm_call(cx, "liga_pregunta", dentro, 0.01)
    _llm_call(cx, "liga_pregunta", dentro, 0.02)
    _llm_call(cx, "liga_pregunta", fuera, 100.0)   # fuera del mes: no cuenta
    _llm_call(cx, "liga_conversor", dentro, 0.001)

    cx.execute("select liga.cargar_creditos(%s, 100, 'regalo', %s)", (uid, uuid.uuid4().hex))
    cx.execute(
        "select liga.cargar_creditos(%s, -20, 'prueba', %s)", (uid, uuid.uuid4().hex))
    cx.execute(
        "select liga.cargar_creditos(%s, 5, 'devolucion', %s)", (uid, uuid.uuid4().hex))

    r = gestion.coste_ia(mes)
    por_finalidad = {f["finalidad"]: f for f in r["filas"]}

    pregunta = por_finalidad["pregunta"]
    assert round(float(pregunta["pagado_usd"]), 4) == 0.03
    assert round(float(pregunta["cobrado_usd"]), 4) == 0.20   # 20 créditos = 0,20 $
    assert pregunta["llamadas"] == 2

    conversor_fila = por_finalidad["conversor"]
    assert round(float(conversor_fila["pagado_usd"]), 4) == 0.001
    assert conversor_fila["cobrado_usd"] == 0   # el conversor nunca cobra

    assert round(float(r["total_pagado_usd"]), 4) == round(0.03 + 0.001, 4)


def test_bajo_objetivo_cuando_el_ratio_no_llega_al_margen(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    mes = date.today().replace(day=1)
    dentro = datetime.combine(mes, datetime.min.time()) + timedelta(hours=1)
    _llm_call(cx, "liga_lectura", dentro, 1.0)
    cx.execute("select liga.cargar_creditos(%s, 100, 'regalo', %s)", (uid, uuid.uuid4().hex))
    cx.execute("select liga.cargar_creditos(%s, -5, 'lectura', %s)", (uid, uuid.uuid4().hex))
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.margen_objetivo', '3')")

    r = gestion.coste_ia(mes)
    lectura = next(f for f in r["filas"] if f["finalidad"] == "lectura")
    # cobrado = 5 * 0.01 = 0.05 $; pagado = 1.0 $ -> ratio 0.05, muy por debajo de 3.
    assert lectura["bajo_objetivo"] is True
    assert r["margen_objetivo"] == 3
