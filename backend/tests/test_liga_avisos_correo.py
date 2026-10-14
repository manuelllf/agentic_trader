from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.liga import rutas


class _Db:
    """Recoge los parámetros del `update` y responde como si la fila existiera."""

    def __init__(self, fila: tuple | None = (1,)) -> None:
        self.fila = fila
        self.params: dict | None = None

    def execute(self, _sql, params):  # noqa: ANN001, ANN202
        self.params = params
        return SimpleNamespace(one_or_none=lambda: self.fila)


@pytest.mark.parametrize(("entrada", "guardada"), [
    (None, None), ("", None), ("   ", None), (" otra@ejemplo.com ", "otra@ejemplo.com")])
def test_guarda_la_direccion_limpia_o_la_de_la_cuenta(entrada, guardada) -> None:  # noqa: ANN001
    db = _Db()
    respuesta = rutas.cambiar_avisos_correo(rutas.AvisosCorreo(activo=True, correo=entrada), db=db)
    assert respuesta == rutas.AvisosCorreo(activo=True, correo=guardada)
    assert db.params == {"activo": True, "correo": guardada}


@pytest.mark.parametrize("mala", ["sin-arroba", "ana@ejemplo", "ana @ejemplo.com",
                                  "a" * 250 + "@x.es"])
def test_rechaza_una_direccion_mala_sin_tocar_la_bd(mala) -> None:  # noqa: ANN001
    db = _Db()
    with pytest.raises(HTTPException) as error:
        rutas.cambiar_avisos_correo(rutas.AvisosCorreo(activo=True, correo=mala), db=db)
    assert error.value.status_code == 422
    assert db.params is None


def test_sin_perfil_responde_404() -> None:
    with pytest.raises(HTTPException) as error:
        rutas.cambiar_avisos_correo(rutas.AvisosCorreo(activo=False), db=_Db(fila=None))
    assert error.value.status_code == 404


def test_no_admite_campos_de_mas() -> None:
    with pytest.raises(ValueError):
        rutas.AvisosCorreo(activo=True, correo=None, otra=1)
