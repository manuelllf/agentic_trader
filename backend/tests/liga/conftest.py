"""Fixtures comunes de las pruebas de la liga contra el Postgres de pruebas."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _sin_regalo_de_bienvenida(request):  # noqa: ANN001, ANN201
    """Las cuentas nuevas reciben créditos de bienvenida (sql 015); casi todas las pruebas de
    créditos parten de saldo 0, así que el regalo se apaga salvo en las marcadas con
    `@pytest.mark.con_bienvenida`."""
    url = os.environ.get("LIGA_TEST_DATABASE_URL")
    if not url or request.node.get_closest_marker("con_bienvenida"):
        yield
        return
    psycopg = pytest.importorskip("psycopg")
    with psycopg.connect(url, autocommit=True) as cx:
        cx.execute("insert into liga.ajustes (clave, valor) values ('creditos.bienvenida', '0') "
                   "on conflict (clave) do update set valor = '0'")
    try:
        yield
    finally:
        with psycopg.connect(url, autocommit=True) as cx:
            cx.execute("delete from liga.ajustes where clave = 'creditos.bienvenida'")
