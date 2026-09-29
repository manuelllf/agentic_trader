"""Una reserva de créditos que nunca se liquida ni se devuelve (el proceso murió a mitad de la
prueba) se devuelve sola pasado un rato; y la clave de cobro cabe siempre en el límite de la BD,
venga la clave del cliente como venga. Contra el Postgres de pruebas."""

from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest

from app.liga.ia import comun

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def cx(monkeypatch):  # noqa: ANN001, ANN201
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import db as liga_db

    psycopg = pytest.importorskip("psycopg")
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    conn = psycopg.connect(URL, autocommit=True)
    creados: list[uuid.UUID] = []
    conn.creados = creados  # type: ignore[attr-defined]
    try:
        yield conn
    finally:
        conn.execute("set session_replication_role = replica")
        for uid in creados:
            conn.execute("delete from liga.creditos_movimientos where usuario_id = %s", (uid,))
        conn.execute("set session_replication_role = origin")
        for uid in creados:
            conn.execute("delete from auth.users where id = %s", (uid,))
        conn.close()


def _cuenta_con_saldo(cx, saldo: int) -> uuid.UUID:  # noqa: ANN001
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email) values (%s, %s)",
               (uid, f"{uid.hex[:12]}@prueba.local"))
    cx.creados.append(uid)
    cx.execute("select liga.cargar_creditos(%s, %s, 'regalo', 'saldo-inicial')", (uid, saldo))
    return uid


def _saldo(cx, uid: uuid.UUID) -> Decimal:  # noqa: ANN001
    return cx.execute("select coalesce(sum(importe), 0) from liga.creditos_movimientos "
                      "where usuario_id = %s", (uid,)).fetchone()[0]


def _reservar_hace(cx, uid: uuid.UUID, clave: str, minutos: int, importe: int = 10) -> None:  # noqa: ANN001
    """Deja una reserva como si el proceso hubiera muerto hace `minutos` sin cerrarla."""
    comun.reservar_creditos(str(uid), Decimal(importe), f"reserva:{clave}")
    cx.execute("set session_replication_role = replica")  # el libro es de solo añadir
    cx.execute("update liga.creditos_movimientos set creado = now() - make_interval(mins => %s) "
               "where usuario_id = %s and idempotencia = %s", (minutos, uid, f"reserva:{clave}"))
    cx.execute("set session_replication_role = origin")


def test_la_reserva_abandonada_se_devuelve_y_no_se_toca_la_reciente(cx) -> None:  # noqa: ANN001
    uid = _cuenta_con_saldo(cx, 50)
    _reservar_hace(cx, uid, "pregunta:vieja", minutos=45)
    _reservar_hace(cx, uid, "pregunta:reciente", minutos=2)
    assert _saldo(cx, uid) == 30

    assert comun.devolver_reservas_huerfanas() == 1

    assert _saldo(cx, uid) == 40  # solo vuelven los 10 de la vieja; la reciente sigue en marcha
    # Idempotente: un segundo barrido (o dos procesos a la vez) no devuelve otra vez.
    assert comun.devolver_reservas_huerfanas() == 0
    assert _saldo(cx, uid) == 40


def test_una_reserva_ya_liquidada_no_se_devuelve_de_nuevo(cx) -> None:  # noqa: ANN001
    uid = _cuenta_con_saldo(cx, 50)
    _reservar_hace(cx, uid, "pregunta:cerrada", minutos=45)
    comun.liquidar_creditos(str(uid), Decimal(10), Decimal(4), "prueba", "pregunta:cerrada")
    assert _saldo(cx, uid) == 46

    assert comun.devolver_reservas_huerfanas() == 0
    assert _saldo(cx, uid) == 46


@pytest.mark.parametrize("cliente", ["a" * 8, uuid.uuid4().hex, "x" * 80])
def test_la_clave_de_cobro_cabe_en_el_limite_de_la_bd(cliente: str) -> None:
    clave = comun.clave_cobro("pregunta", cliente, 123456789012, 987654321098)
    # La más larga que se deriva de ella lleva el prefijo «devolucion:».
    assert len(f"devolucion:{clave}") <= 80
    # Determinista (un reintento repite la clave) y sensible a cada pieza.
    assert clave == comun.clave_cobro("pregunta", cliente, 123456789012, 987654321098)
    assert clave != comun.clave_cobro("pregunta", cliente, 123456789012, 987654321099)
    assert clave != comun.clave_cobro("pregunta", cliente, 1, 987654321098)
