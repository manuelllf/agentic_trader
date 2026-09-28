"""`mapear_error`: los mensajes propios de los disparadores llegan tal cual; lo demás no enseña nada
interno y, si no es culpa de la persona, le da un código con el que avisar."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import DBAPIError

from app.liga.estrategias import mapear_error


def _error(sqlstate: str, mensaje: str, constraint: str | None = None) -> DBAPIError:
    orig = SimpleNamespace(sqlstate=sqlstate, diag=SimpleNamespace(
        message_primary=mensaje, constraint_name=constraint), __str__=lambda s: mensaje)
    return DBAPIError("select 1", {}, orig)


def test_el_mensaje_propio_de_un_disparador_llega_tal_cual() -> None:
    assert mapear_error(_error("42501", "Solo el dueño edita su estrategia")).status_code == 403
    assert mapear_error(_error("23505", "Ese nombre ya existe")).status_code == 409
    h = mapear_error(_error("23514", "Para apuntarla hace falta su receta"))
    assert (h.status_code, h.detail) == (422, "Para apuntarla hace falta su receta")


def test_una_restriccion_nativa_no_enseña_tablas_ni_columnas() -> None:
    h = mapear_error(_error("23502", 'null value in column "x" of relation "liga.estrategias"',
                            constraint="estrategias_x_check"))
    assert (h.status_code, h.detail) == (422, "Esos datos no son válidos.")


@pytest.mark.parametrize("sqlstate", ["08006", "57014", "53300", "42601"])
def test_un_fallo_de_la_base_no_enseña_nada_interno_y_da_un_codigo(sqlstate: str) -> None:
    h = mapear_error(_error(sqlstate, "connection to server at aws-1-eu-west-1.pooler failed"))
    assert h.status_code == 503
    assert "aws-1" not in h.detail and "código" in h.detail
