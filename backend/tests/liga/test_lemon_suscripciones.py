"""Cancelaciones con respuestas dobles, sin llamadas de red."""

from unittest.mock import Mock

import httpx
import pytest

from app.liga import lemon_suscripciones as lemon


@pytest.fixture
def red(monkeypatch):  # noqa: ANN001, ANN201
    monkeypatch.setattr(lemon.settings, "lemon_api_key", "prueba")
    get = Mock(return_value=httpx.Response(
        200, json={"data": {"attributes": {"status": "active"}}}))
    delete = Mock(return_value=httpx.Response(204))
    monkeypatch.setattr(lemon.httpx, "get", get)
    monkeypatch.setattr(lemon.httpx, "delete", delete)
    return get, delete


@pytest.mark.parametrize("estado", ["cancelled", "expired"])
def test_terminada_no_cancela(red, estado: str) -> None:  # noqa: ANN001
    get, delete = red
    get.return_value = httpx.Response(200, json={"data": {"attributes": {"status": estado}}})
    lemon.cancelar_suscripciones(["1"])
    delete.assert_not_called()


def test_activa_cancela(red) -> None:  # noqa: ANN001
    get, delete = red
    lemon.cancelar_suscripciones(["1"])
    argumentos = (f"{lemon.LEMON_URL}/subscriptions/1",)
    get.assert_called_once_with(*argumentos, headers=lemon.cabeceras_lemon(), timeout=15)
    delete.assert_called_once_with(*argumentos, headers=lemon.cabeceras_lemon(), timeout=15)


def test_no_existe(red) -> None:  # noqa: ANN001
    get, delete = red
    get.return_value = httpx.Response(404)
    lemon.cancelar_suscripciones(["1"])
    delete.assert_not_called()


def test_error_de_red(red) -> None:  # noqa: ANN001
    get, delete = red
    get.side_effect = httpx.ConnectError("sin red")
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1"])
    delete.assert_not_called()


def test_delete_falla(red) -> None:  # noqa: ANN001
    _, delete = red
    delete.return_value = httpx.Response(500)
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1"])


@pytest.mark.parametrize("fallo_get", [True, False])
def test_intenta_todos_aunque_falle_el_primero(red, fallo_get: bool) -> None:  # noqa: ANN001
    get, delete = red
    if fallo_get:
        get.side_effect = [httpx.ConnectError("sin red"), get.return_value]
    else:
        delete.side_effect = [httpx.Response(500), httpx.Response(204)]
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1", "2"])
    assert get.call_count == 2
    assert delete.call_args.args == (f"{lemon.LEMON_URL}/subscriptions/2",)


def test_sin_clave(red, monkeypatch) -> None:  # noqa: ANN001
    get, delete = red
    monkeypatch.setattr(lemon.settings, "lemon_api_key", "")
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1"])
    get.assert_not_called()
    delete.assert_not_called()


def test_sin_ids_no_necesita_clave(red, monkeypatch) -> None:  # noqa: ANN001
    get, delete = red
    monkeypatch.setattr(lemon.settings, "lemon_api_key", "")
    lemon.cancelar_suscripciones([])
    get.assert_not_called()
    delete.assert_not_called()


@pytest.mark.parametrize("respuesta", [
    httpx.Response(500), httpx.Response(302), httpx.Response(200, text="no es JSON"),
    httpx.Response(200, json={}),
    httpx.Response(200, json={"data": {"attributes": {"status": None}}}),
])
def test_respuesta_no_interpretable(red, respuesta: httpx.Response) -> None:  # noqa: ANN001
    get, delete = red
    get.return_value = respuesta
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1"])
    delete.assert_not_called()


def test_error_de_red_en_delete(red) -> None:  # noqa: ANN001
    _, delete = red
    delete.side_effect = httpx.ReadTimeout("sin respuesta")
    with pytest.raises(lemon.CancelacionFallida):
        lemon.cancelar_suscripciones(["1"])
