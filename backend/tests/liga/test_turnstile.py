"""Turnstile sin llamadas reales al proveedor."""

from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.config import settings
from app.i18n import MESSAGES, translate
from app.liga import registro, turnstile


def test_sin_clave_no_llama(monkeypatch):
    monkeypatch.setattr(settings, "turnstile_secret_key", "")
    post = Mock()
    monkeypatch.setattr(httpx, "post", post)
    turnstile.verificar("x", "1.2.3.4")
    post.assert_not_called()


def test_verificacion_correcta(monkeypatch):
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-prueba")
    post = Mock(return_value=httpx.Response(200, json={"success": True}))
    monkeypatch.setattr(httpx, "post", post)
    turnstile.verificar("x", "1.2.3.4")
    post.assert_called_once_with(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data={"secret": "secreto-prueba", "response": "x", "remoteip": "1.2.3.4"},
        timeout=5,
    )


@pytest.mark.parametrize("respuesta", [
    httpx.Response(200, json={"success": False}),
    httpx.Response(500, json={"success": True}),
    httpx.Response(200, json={}),
    httpx.Response(200, content=b"invalid"),
    httpx.Response(200, json={"success": 1}),
])
def test_verificacion_rechazada(monkeypatch, respuesta):
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-prueba")
    monkeypatch.setattr(httpx, "post", Mock(return_value=respuesta))
    with pytest.raises(HTTPException) as error:
        turnstile.verificar("x", None)
    assert error.value.status_code == 403
    assert error.value.detail == translate("api_error_captcha_invalido")


@pytest.mark.parametrize("token", [None, ""])
def test_token_vacio_no_llama(monkeypatch, token):
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-prueba")
    post = Mock()
    monkeypatch.setattr(httpx, "post", post)
    with pytest.raises(HTTPException) as error:
        turnstile.verificar(token, None)
    assert error.value.status_code == 403
    assert error.value.detail == translate("api_error_captcha_invalido")
    post.assert_not_called()


def test_timeout(monkeypatch):
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-prueba")
    monkeypatch.setattr(httpx, "post", Mock(side_effect=httpx.TimeoutException("timeout")))
    with pytest.raises(HTTPException) as error:
        turnstile.verificar("x", None)
    assert error.value.status_code == 503
    assert error.value.detail == translate("api_error_captcha_no_disponible")


@pytest.mark.parametrize("ruta", ["", "/recuperar", "/reenviar"])
def test_ruta_sin_token_no_produce_efectos(monkeypatch, ruta):
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-prueba")
    post = Mock()
    preparar = Mock()
    abierto = Mock()
    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(registro, "_preparar", preparar)
    monkeypatch.setattr(registro.gestion, "registro_abierto", abierto)
    app = FastAPI()
    app.include_router(registro.router)
    with TestClient(app) as cliente:
        respuesta = cliente.post("/registro" + ruta, json={
            "email": "usuario@correo.es", "origen": "http://localhost:3000",
            "alias": "usuario", "clave": "Segura!123", "acepta_terminos": True,
        })
    assert respuesta.status_code == 403
    assert respuesta.json()["detail"] == translate("api_error_captcha_invalido")
    post.assert_not_called()
    preparar.assert_not_called()
    abierto.assert_not_called()


def test_claves_en_ambos_idiomas(monkeypatch):
    monkeypatch.setattr(settings, "turnstile_secret_key", "")
    for idioma in ("es", "en"):
        for clave in ("api_error_captcha_invalido", "api_error_captcha_no_disponible"):
            assert MESSAGES[idioma][clave]
