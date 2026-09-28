"""Regalo único de bienvenida al crearse una cuenta (`liga.alta_usuario`, sql 015): 15 créditos por
defecto, configurable desde `liga.ajustes` (`creditos.bienvenida`) y 0 lo apaga. Contra el
Postgres de pruebas; todo se limpia al final."""

from __future__ import annotations

import os
import uuid

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = [pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)"),
              pytest.mark.con_bienvenida]


@pytest.fixture
def cx():
    psycopg = pytest.importorskip("psycopg")
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
        conn.execute("delete from liga.ajustes where clave = 'creditos.bienvenida'")
        conn.close()


def _nueva_cuenta(cx) -> uuid.UUID:  # noqa: ANN001
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email) values (%s, %s)",
               (uid, f"{uid.hex[:12]}@prueba.local"))
    cx.creados.append(uid)
    return uid


def _movimientos(cx, uid: uuid.UUID) -> list[tuple]:  # noqa: ANN001
    return cx.execute("select importe, motivo, idempotencia from liga.creditos_movimientos "
                      "where usuario_id = %s", (uid,)).fetchall()


def test_cuenta_nueva_recibe_15_de_bienvenida_una_sola_vez(cx) -> None:  # noqa: ANN001
    uid = _nueva_cuenta(cx)
    assert [(float(i), m, k) for i, m, k in _movimientos(cx, uid)] == [
        (15.0, "regalo", "bienvenida")]
    # Repetir la concesión (mismo disparador, misma clave) no regala otra vez.
    cx.execute("select liga.cargar_creditos(%s, 15, 'regalo', 'bienvenida')", (uid,))
    assert len(_movimientos(cx, uid)) == 1


def test_el_importe_se_cambia_desde_ajustes_y_cero_lo_apaga(cx) -> None:  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', '30')")
    assert [float(i) for i, _m, _k in _movimientos(cx, _nueva_cuenta(cx))] == [30.0]

    cx.execute("update liga.ajustes set valor = '0' where clave = 'creditos.bienvenida'")
    assert _movimientos(cx, _nueva_cuenta(cx)) == []


def test_un_valor_que_no_es_numero_no_rompe_el_alta_y_usa_el_defecto(cx) -> None:  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', 'true')")
    assert [float(i) for i, _m, _k in _movimientos(cx, _nueva_cuenta(cx))] == [15.0]
