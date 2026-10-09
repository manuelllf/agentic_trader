"""Políticas de RLS de los pagos, ejercidas con la identidad de cada usuario: cada cuenta solo ve
sus compras y sus derechos de pago, y ningún usuario ve el registro de webhooks. Todo se hace en
una transacción que se deshace al final. Se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import json
import os
import uuid

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def cx():  # noqa: ANN201
    psycopg = pytest.importorskip("psycopg")
    conexion = psycopg.connect(URL)
    try:
        yield conexion
    finally:
        conexion.rollback()
        conexion.close()


def _sistema(cx) -> None:  # noqa: ANN001
    cx.execute("reset role")
    cx.execute("select set_config('request.jwt.claims', '', true)")


def _como(cx, uid: uuid.UUID | None) -> None:  # noqa: ANN001
    _sistema(cx)
    if uid is None:
        cx.execute("set local role anon")
        return
    claims = json.dumps({"sub": str(uid), "role": "authenticated", "aal": "aal1"})
    cx.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    cx.execute("set local role authenticated")


def _usuario(cx) -> uuid.UUID:  # noqa: ANN001
    _sistema(cx)
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
               (str(uid), f"rls-{uid.hex[:8]}@pruebas.invalid"))
    return uid


def _compra(cx, uid: uuid.UUID, lemon_id: str) -> None:  # noqa: ANN001
    _sistema(cx)
    cx.execute("insert into liga.compras_pago (lemon_id, usuario_id, producto, estado, "
               "actualizado_lemon) values (%s, %s, 'mensual', 'active', now())",
               (lemon_id, str(uid)))
    cx.execute("insert into liga.planes_usuario (usuario_id, plan, hasta, origen, compra_lemon_id)"
               " values (%s, 'pro', now() + interval '30 days', 'pago', %s)", (str(uid), lemon_id))


def test_cada_cuenta_solo_ve_sus_compras(cx):  # noqa: ANN001
    ana, bruno = _usuario(cx), _usuario(cx)
    _compra(cx, ana, f"ana-{uuid.uuid4().hex[:6]}")
    _compra(cx, bruno, f"bruno-{uuid.uuid4().hex[:6]}")
    _como(cx, ana)
    filas = cx.execute("select usuario_id::text from liga.compras_pago").fetchall()
    assert filas and all(f[0] == str(ana) for f in filas)


def test_cada_cuenta_solo_ve_sus_derechos_de_pago(cx):  # noqa: ANN001
    ana, bruno = _usuario(cx), _usuario(cx)
    _compra(cx, ana, f"ana-{uuid.uuid4().hex[:6]}")
    _compra(cx, bruno, f"bruno-{uuid.uuid4().hex[:6]}")
    _como(cx, bruno)
    filas = cx.execute("select usuario_id::text from liga.planes_usuario "
                       "where origen = 'pago'").fetchall()
    assert filas and all(f[0] == str(bruno) for f in filas)


def test_nadie_lee_el_registro_de_webhooks(cx):  # noqa: ANN001
    _sistema(cx)
    cx.execute("insert into liga.eventos_pago (clave, evento, estado) "
               "values (%s, 'subscription_created', 'aplicado')", (uuid.uuid4().hex,))
    _como(cx, _usuario(cx))
    with pytest.raises(Exception, match="permission denied"):  # noqa: PT011
        cx.execute("select count(*) from liga.eventos_pago")
    cx.rollback()
    _como(cx, None)
    with pytest.raises(Exception, match="permission denied"):  # noqa: PT011
        cx.execute("select count(*) from liga.eventos_pago")


def test_anonimo_no_ve_compras(cx):  # noqa: ANN001
    _compra(cx, _usuario(cx), f"anon-{uuid.uuid4().hex[:6]}")
    _como(cx, None)
    with pytest.raises(Exception, match="permission denied"):  # noqa: PT011
        cx.execute("select count(*) from liga.compras_pago")
