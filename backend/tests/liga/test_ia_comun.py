"""Ayuda común de IA (`app.liga.ia.comun`, plan §10 y F6): interruptor por finalidad, tope
mensual, la fila de `llm_call` sin texto, la auditoría, el tope diario contado y el libro de
créditos. Contra el Postgres de pruebas; se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest

psycopg = pytest.importorskip("psycopg")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
from app.liga import db as liga_db  # noqa: E402
from app.liga.ia import comun  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def entorno(monkeypatch):  # noqa: ANN001, ANN201
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    # `comun.py` abre su propia sesión de sistema en cada llamada (`app.db.SessionLocal`); las
    # rutas usarían además `app.liga.db.SessionLocal`, aquí no hace falta pero se parchea igual
    # por si algún camino la usa.
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)

    cx = psycopg.connect(URL, autocommit=True)
    creado: dict[str, list] = {"usuarios": []}

    def usuario() -> str:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                  (uid, f"{uid.hex[:12]}@prueba.local"))
        creado["usuarios"].append(uid)
        return str(uid)

    try:
        yield cx, usuario
    finally:
        # `creditos_movimientos` y `auditoria` son de solo añadir (disparador `solo_anadir`):
        # limpiar de pruebas necesita saltárselo, nunca en producción.
        cx.execute("set session_replication_role = replica")
        for uid in creado["usuarios"]:  # objetos uuid.UUID, no cadenas (ver `usuario()`)
            cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
            cx.execute("delete from liga.auditoria where actor_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from llm_call where stage like 'liga_%'")
        cx.execute("delete from liga.ajustes where clave like 'ia.%'")
        for uid in creado["usuarios"]:
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def test_interruptor_apagado_da_503(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    settings_enable_llm = settings.enable_llm
    settings.enable_llm = True
    try:
        with pytest.raises(HTTPException) as exc:
            comun.verificar_disponible("conversor")
        assert exc.value.status_code == 503
    finally:
        settings.enable_llm = settings_enable_llm


def test_interruptor_encendido_sin_tope_no_lanza(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    cx, _ = entorno
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    settings_enable_llm = settings.enable_llm
    settings.enable_llm = True
    try:
        comun.verificar_disponible("conversor")  # no lanza
    finally:
        settings.enable_llm = settings_enable_llm


def test_tope_mensual_gastado_apaga_la_finalidad(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    cx, _ = entorno
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.tope_mensual_usd', '0.01')")
    cx.execute("""
        insert into llm_call (at, stage, model, prompt_cache_hit_tokens,
                              prompt_cache_miss_tokens, completion_tokens, cost_usd, ok)
        values (now(), 'liga_conversor', 'deepseek-flash', 0, 100, 50, 0.02, true)
    """)
    settings_enable_llm = settings.enable_llm
    settings.enable_llm = True
    try:
        with pytest.raises(HTTPException) as exc:
            comun.verificar_disponible("conversor")
        assert exc.value.status_code == 503
    finally:
        settings.enable_llm = settings_enable_llm


def test_registrar_llamada_escribe_llm_call_y_auditoria_sin_texto(entorno) -> None:  # noqa: ANN001
    cx, usuario = entorno
    uid = usuario()
    llamada = comun.LlamadaIA(modelo="deepseek-flash", tokens_entrada=120, tokens_salida=40,
                              coste_usd=0.0007, latencia_ms=850, ok=True)
    llm_call_id = comun.registrar_llamada(finalidad="conversor", usuario_id=uid, llamada=llamada)
    assert llm_call_id is not None
    fila = cx.execute(
        "select stage, model, cost_usd, content, reasoning, ok from llm_call where id = %s",
        (llm_call_id,)).fetchone()
    assert fila[0] == "liga_conversor"
    assert fila[1] == "deepseek-flash"
    assert fila[3] is None
    assert fila[4] is None
    assert fila[5] is True
    aud = cx.execute(
        "select accion, detalle from liga.auditoria where actor_id = %s order by id desc limit 1",
        (uuid.UUID(uid),)).fetchone()
    assert aud[0] == "ia.conversor"
    assert aud[1]["cache"] is False
    assert "coste_usd" in aud[1]


def test_registrar_llamada_de_cache_no_escribe_llm_call(entorno) -> None:  # noqa: ANN001
    cx, usuario = entorno
    uid = usuario()
    llamada = comun.LlamadaIA(modelo="deepseek-flash", tokens_entrada=0, tokens_salida=0,
                              coste_usd=0.0, latencia_ms=0, ok=True)
    llm_call_id = comun.registrar_llamada(finalidad="pregunta", usuario_id=uid, llamada=llamada,
                                         cache=True)
    assert llm_call_id is None
    total = cx.execute("select count(*) from llm_call where stage = 'liga_pregunta'").fetchone()[0]
    assert total == 0
    aud = cx.execute(
        "select detalle from liga.auditoria where actor_id = %s and accion = 'ia.pregunta'",
        (uuid.UUID(uid),)).fetchone()
    assert aud[0]["cache"] is True


def test_veces_hoy_cuenta_solo_las_de_hoy_y_de_esa_finalidad(entorno) -> None:  # noqa: ANN001
    cx, usuario = entorno
    uid = usuario()
    assert comun.veces_hoy("conversor", uid) == 0
    for _ in range(3):
        llamada = comun.LlamadaIA(modelo="deepseek-flash", tokens_entrada=1, tokens_salida=1,
                                  coste_usd=0.0001, latencia_ms=1, ok=True)
        comun.registrar_llamada(finalidad="conversor", usuario_id=uid, llamada=llamada)
    assert comun.veces_hoy("conversor", uid) == 3
    assert comun.veces_hoy("lectura", uid) == 0


def test_reserva_y_devolucion_de_creditos(entorno) -> None:  # noqa: ANN001
    cx, usuario = entorno
    uid = usuario()
    uid_obj = uuid.UUID(uid)
    cx.execute("select liga.cargar_creditos(%s, 100, 'regalo', %s)",
              (uid_obj, uuid.uuid4().hex))
    comun.reservar_creditos(uid, Decimal(10), "reserva:prueba-1")
    saldo = cx.execute(
        "select saldo from liga.v_saldo where usuario_id = %s", (uid_obj,)).fetchone()[0]
    assert saldo == Decimal("90")
    comun.devolver_reserva(uid, Decimal(10), "prueba-1")
    saldo = cx.execute(
        "select saldo from liga.v_saldo where usuario_id = %s", (uid_obj,)).fetchone()[0]
    assert saldo == Decimal("100")
    # Repetir la MISMA reserva (misma clave) no descuenta dos veces: un reintento no cobra dos.
    comun.reservar_creditos(uid, Decimal(15), "reserva:prueba-2")
    comun.reservar_creditos(uid, Decimal(15), "reserva:prueba-2")
    saldo = cx.execute(
        "select saldo from liga.v_saldo where usuario_id = %s", (uid_obj,)).fetchone()[0]
    assert saldo == Decimal("85")


def test_reserva_sin_saldo_da_402(entorno) -> None:  # noqa: ANN001
    cx, usuario = entorno
    uid = usuario()
    with pytest.raises(HTTPException) as exc:
        comun.reservar_creditos(uid, Decimal(10), "reserva:sin-saldo")
    assert exc.value.status_code == 402


# ---- razon_no_disponible: el motivo que enseña el panel de ajustes al admin (plan §10, F6) ------


def test_razon_falta_enable_llm(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    previo = settings.enable_llm
    settings.enable_llm = False
    try:
        assert comun.razon_no_disponible("conversor") == "Falta ENABLE_LLM en Railway"
    finally:
        settings.enable_llm = previo


def test_razon_sin_clave_deepseek(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    previo_llm, previa_key = settings.enable_llm, settings.deepseek_api_key
    settings.enable_llm, settings.deepseek_api_key = True, ""
    try:
        assert comun.razon_no_disponible("conversor") == "Sin clave de DeepSeek"
    finally:
        settings.enable_llm, settings.deepseek_api_key = previo_llm, previa_key


def test_razon_sin_clave_jev(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    previo_llm, previa_key = settings.enable_llm, settings.typesafe_api_key
    settings.enable_llm, settings.typesafe_api_key = True, ""
    try:
        assert comun.razon_no_disponible("pregunta") == "Sin clave de Jev"
    finally:
        settings.enable_llm, settings.typesafe_api_key = previo_llm, previa_key


def test_razon_apagado_aqui(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    _cx, _usuario = entorno
    previo_llm, previa_key = settings.enable_llm, settings.deepseek_api_key
    settings.enable_llm, settings.deepseek_api_key = True, "sk-lo-que-sea"
    try:
        # Sin fila en `liga.ajustes`: el interruptor de la finalidad está ausente = apagado.
        assert comun.razon_no_disponible("conversor") == "Apagado aquí"
    finally:
        settings.enable_llm, settings.deepseek_api_key = previo_llm, previa_key


def test_razon_tope_del_mes_alcanzado(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    cx, _usuario = entorno
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.tope_mensual_usd', '0.01')")
    cx.execute("""
        insert into llm_call (at, stage, model, prompt_cache_hit_tokens,
                              prompt_cache_miss_tokens, completion_tokens, cost_usd, ok)
        values (now(), 'liga_conversor', 'deepseek-flash', 0, 100, 50, 0.02, true)
    """)
    previo_llm, previa_key = settings.enable_llm, settings.deepseek_api_key
    settings.enable_llm, settings.deepseek_api_key = True, "sk-lo-que-sea"
    try:
        assert comun.razon_no_disponible("conversor") == "Tope del mes alcanzado"
    finally:
        settings.enable_llm, settings.deepseek_api_key = previo_llm, previa_key


def test_tope_mal_guardado_para_la_ia_y_lo_dice_sin_romper_el_panel(entorno) -> None:  # noqa: ANN001
    """Un `true` en el tope (visto en producción) no es un tope de 1 $ ni un 500 en Ajustes."""
    from app.config import settings
    from app.liga import gestion

    cx, _usuario = entorno
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.tope_mensual_usd', 'true')")
    previo_llm, previa_key = settings.enable_llm, settings.deepseek_api_key
    settings.enable_llm, settings.deepseek_api_key = True, "sk-lo-que-sea"
    try:
        assert comun.razon_no_disponible("conversor") == "Tope mensual mal configurado"
        estado = gestion.estado_ia()
        assert estado["tope_mensual_usd"] is None
        assert next(f for f in estado["finalidades"]
                    if f["finalidad"] == "conversor")["razon"] == "Tope mensual mal configurado"
    finally:
        settings.enable_llm, settings.deepseek_api_key = previo_llm, previa_key


def test_razon_ninguna_cuando_funciona(entorno) -> None:  # noqa: ANN001
    from app.config import settings

    cx, _usuario = entorno
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.conversor.activo', 'true')")
    previo_llm, previa_key = settings.enable_llm, settings.deepseek_api_key
    settings.enable_llm, settings.deepseek_api_key = True, "sk-lo-que-sea"
    try:
        assert comun.razon_no_disponible("conversor") is None
    finally:
        settings.enable_llm, settings.deepseek_api_key = previo_llm, previa_key
