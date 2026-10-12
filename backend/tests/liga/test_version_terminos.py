"""La version vigente exige otra aceptacion y conserva el historial anterior."""

import json
import os
import uuid

import pytest

from app.liga.registro import VERSION_TERMINOS

psycopg = pytest.importorskip("psycopg")
URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def cx():  # noqa: ANN201
    conn = psycopg.connect(URL)
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def test_version_y_permisos(cx):  # noqa: ANN001
    assert VERSION_TERMINOS == "2"
    assert cx.execute("select liga.version_terminos()").fetchone() == (VERSION_TERMINOS,)
    for rol, permitido in [("anon", False), ("authenticated", True)]:
        assert cx.execute("select has_function_privilege(%s, 'liga.version_terminos()', "
                          "'EXECUTE')", (rol,)).fetchone() == (permitido,)
    assert cx.execute("select exists (select 1 from pg_proc p, "
                      "lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a "
                      "where p.oid = 'liga.version_terminos()'::regprocedure "
                      "and a.grantee = 0 and a.privilege_type = 'EXECUTE')").fetchone() == (False,)


def test_aceptar_version_vigente_conserva_historial(cx):  # noqa: ANN001
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
               (uid, f"{uid.hex}@prueba.local"))
    cx.execute("insert into liga.consentimientos (usuario_id, documento, version) "
               "values (%s, 'terminos', '1')", (uid,))
    cx.execute("select set_config('request.jwt.claims', %s, true)",
               (json.dumps({"sub": str(uid), "role": "authenticated", "aal": "aal1"}),))
    cx.execute("set local role authenticated")
    assert cx.execute("select liga.cuenta_pendiente()").fetchone() == (True,)
    cx.execute("select liga.aceptar_terminos()")
    assert cx.execute("select liga.cuenta_pendiente()").fetchone() == (False,)
    cx.execute("select liga.aceptar_terminos()")
    assert cx.execute("select documento, version from liga.consentimientos "
                      "where usuario_id = %s order by documento, version", (uid,)).fetchall() == [
        ("privacidad", "2"), ("terminos", "1"), ("terminos", "2")]


@pytest.mark.parametrize("version", ["1", "2"])
def test_alta_exige_version_vigente(cx, version):  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('liga.registro.abierto', 'true') "
               "on conflict (clave) do update set valor = excluded.valor")
    uid = uuid.uuid4()
    sql = "insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)"
    params = (uid, f"{uid.hex}@prueba.local",
              json.dumps({"alias": "u_" + uid.hex[:12], "terminos_version": version}))
    if version == "1":
        with pytest.raises(psycopg.errors.CheckViolation, match="Acepta los"), cx.transaction():
            cx.execute(sql, params)
        assert cx.execute("select id from auth.users where id = %s", (uid,)).fetchall() == []
    else:
        cx.execute(sql, params)
        assert cx.execute("select documento, version from liga.consentimientos "
                          "where usuario_id = %s order by documento", (uid,)).fetchall() == [
            ("privacidad", "2"), ("terminos", "2")]
