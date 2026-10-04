"""Límites de frecuencia persistentes (`app.liga.limites`, plan §14): contra el Postgres de
pruebas, igual que `test_coste_ia.py` — se salta sin `LIGA_TEST_DATABASE_URL`. Comprueban que el
tope se lee de BD (no en memoria) y sobrevive a que se "reinicie" el proceso de pruebas."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
from app.liga import limites  # noqa: E402

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
        # `liga.auditoria` y `liga.creditos_movimientos` son de solo añadir (disparador
        # `solo_anadir`): limpiar de pruebas necesita saltárselo, nunca en producción.
        cx.execute("set session_replication_role = replica")
        cx.execute("delete from liga.auditoria where actor_id = %s", (uid,))
        cx.execute("delete from liga.pruebas where usuario_id = %s", (uid,))
        cx.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


# ---- Alias: 3 cada 30 días ------------------------------------------------------------------


def test_cambios_alias_cuenta_solo_los_del_usuario_en_30_dias(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    otro = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
              (otro, f"{otro.hex[:12]}@prueba.local"))
    try:
        for i in range(2):
            limites.auditar_cambio_alias(str(uid), f"alias{i}")
        limites.auditar_cambio_alias(str(otro), "ajeno")
        # Uno de hace 40 días (insertado ya viejo: `auditoria` es de solo añadir, ni un UPDATE
        # se le puede hacer sin saltarse el disparador): no cuenta en la ventana de 30.
        viejo = datetime.now(UTC) - timedelta(days=40)
        cx.execute("insert into liga.auditoria (actor_id, accion, detalle, creada) "
                  "values (%s, 'cuenta.alias', '{}', %s)", (uid, viejo))
        assert limites.cambios_alias_recientes(str(uid)) == 2
    finally:
        cx.execute("delete from auth.users where id = %s", (otro,))


def test_exigir_cambio_alias_dispara_429_al_llegar_al_tope(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    for i in range(limites.TOPE_ALIAS_30_DIAS):
        limites.exigir_cambio_alias_disponible(str(uid))
        limites.auditar_cambio_alias(str(uid), f"alias{i}")
    with pytest.raises(HTTPException) as exc:
        limites.exigir_cambio_alias_disponible(str(uid))
    assert exc.value.status_code == 429


# ---- Pruebas: 30 al día ---------------------------------------------------------------------


def test_pruebas_hoy_cuenta_liga_pruebas_del_usuario(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    eid = cx.execute(
        "insert into liga.estrategias (dueno_id, nombre, forma, dibujo, color1, color2) "
        "values (%s, 'E', 'escudo', 'liso', '#0B6E68', '#FFFFFF') returning id",
        (uid,)).fetchone()[0]
    rid = cx.execute(
        "insert into liga.recetas (estrategia_id, reglas, catalogo_version, peso_negocio, "
        "peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, "
        "max_por_sector) values (%s, '[]', 1, 30, 20, 20, 0, 0, 5, 'igual', 2) returning id",
        (eid,)).fetchone()[0]
    assert limites.pruebas_hoy(str(uid)) == 0
    for _ in range(3):
        cx.execute(
            "insert into liga.pruebas (usuario_id, receta_id, foto_id, n_evaluadas, "
            "idempotencia) values (%s, %s, 1, 0, %s)", (uid, rid, uuid.uuid4().hex))
    assert limites.pruebas_hoy(str(uid)) == 3
    with pytest.raises(HTTPException):
        for _ in range(limites.TOPE_PRUEBAS_DIA):
            limites.exigir_prueba_disponible(str(uid))
            cx.execute(
                "insert into liga.pruebas (usuario_id, receta_id, foto_id, n_evaluadas, "
                "idempotencia) values (%s, %s, 1, 0, %s)", (uid, rid, uuid.uuid4().hex))


# ---- Lecturas: 50 al día, contadas por lo comprado ------------------------------------------


def test_lecturas_hoy_cuenta_solo_el_motivo_lectura(entorno) -> None:  # noqa: ANN001
    cx, uid = entorno
    assert limites.lecturas_hoy(str(uid)) == 0
    for motivo in ("lectura", "lectura", "prueba", "regalo"):
        cx.execute(
            "insert into liga.creditos_movimientos (usuario_id, importe, motivo, "
            "idempotencia) values (%s, -5, %s, %s)", (uid, motivo, uuid.uuid4().hex))
    assert limites.lecturas_hoy(str(uid)) == 2
