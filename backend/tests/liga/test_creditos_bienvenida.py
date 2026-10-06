"""Regalo único de bienvenida al crearse una cuenta (`liga.alta_usuario`, sql 015 y 030): 30
créditos por defecto, configurable desde `liga.ajustes` (`creditos.bienvenida`) y 0 lo apaga.
Contra el Postgres de pruebas; todo se limpia al final."""

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
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
               (uid, f"{uid.hex[:12]}@prueba.local"))
    cx.creados.append(uid)
    return uid


def _movimientos(cx, uid: uuid.UUID) -> list[tuple]:  # noqa: ANN001
    return cx.execute("select importe, motivo, idempotencia from liga.creditos_movimientos "
                      "where usuario_id = %s", (uid,)).fetchall()


def test_cuenta_nueva_recibe_30_de_bienvenida_una_sola_vez(cx) -> None:  # noqa: ANN001
    uid = _nueva_cuenta(cx)
    assert [(float(i), m, k) for i, m, k in _movimientos(cx, uid)] == [
        (30.0, "regalo", "bienvenida")]
    # Repetir la concesión (mismo disparador, misma clave) no regala otra vez.
    cx.execute("select liga.cargar_creditos(%s, 30, 'regalo', 'bienvenida')", (uid,))
    assert len(_movimientos(cx, uid)) == 1


def test_el_importe_se_cambia_desde_ajustes_y_cero_lo_apaga(cx) -> None:  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', '50')")
    assert [float(i) for i, _m, _k in _movimientos(cx, _nueva_cuenta(cx))] == [50.0]

    cx.execute("update liga.ajustes set valor = '0' where clave = 'creditos.bienvenida'")
    assert _movimientos(cx, _nueva_cuenta(cx)) == []


def test_un_valor_que_no_es_numero_no_rompe_el_alta_y_usa_el_defecto(cx) -> None:  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', 'true')")
    assert [float(i) for i, _m, _k in _movimientos(cx, _nueva_cuenta(cx))] == [30.0]


def test_registro_reserva_alias_y_regala_solo_al_confirmar(cx) -> None:  # noqa: ANN001
    uid = uuid.uuid4()
    nombre = "u_" + uid.hex[:12]
    cx.execute("insert into liga.ajustes (clave, valor) values ('liga.registro.abierto', 'true') "
               "on conflict (clave) do update set valor = 'true'")
    try:
        cx.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                   (uid, f"{uid.hex}@prueba.local",
                    '{"alias": "' + nombre + '", "terminos_version": "1"}'))
        cx.creados.append(uid)
        perfil = cx.execute("select alias from liga.perfiles where id = %s", (uid,)).fetchone()
        assert perfil[0] == nombre
        assert _movimientos(cx, uid) == []
        import psycopg

        with pytest.raises(psycopg.errors.UniqueViolation):
            cx.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                       (uuid.uuid4(), f"duplicado_{uid.hex}@prueba.local",
                        '{"alias": "' + nombre + '", "terminos_version": "1"}'))
        assert cx.execute("select count(*) from liga.consentimientos where usuario_id = %s",
                          (uid,)).fetchone()[0] == 2
        cx.execute("update auth.users set email_confirmed_at = now() where id = %s", (uid,))
        cx.execute("update auth.users set email_confirmed_at = now() where id = %s", (uid,))
        assert len(_movimientos(cx, uid)) == 1
        assert float(_movimientos(cx, uid)[0][0]) == 30
    finally:
        cx.execute("delete from liga.ajustes where clave = 'liga.registro.abierto'")


def test_registro_cerrado_rechaza_alta_directa_en_auth(cx) -> None:  # noqa: ANN001
    import psycopg

    cx.execute("insert into liga.ajustes (clave, valor) values ('liga.registro.abierto', 'false') "
               "on conflict (clave) do update set valor = 'false'")
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cx.execute("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                       (uuid.uuid4(), "cerrado@prueba.local",
                        '{"alias": "cerrado", "terminos_version": "1"}'))
    finally:
        cx.execute("delete from liga.ajustes where clave = 'liga.registro.abierto'")
