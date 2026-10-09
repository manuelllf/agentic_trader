"""Ruta del webhook de Lemon: firma, formato y reparto a la capa de pagos. La capa de base de datos
se sustituye aquí; se prueba aparte contra el Postgres de pruebas."""

import hashlib
import hmac
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.liga import pagos
from app.liga.rutas_pagos import router

SECRETO = "130221-de-prueba"
USUARIO = "6f2c1e1a-0000-4000-8000-000000000001"


@pytest.fixture
def cliente(monkeypatch):  # noqa: ANN001, ANN201
    monkeypatch.setattr(settings, "lemon_webhook_secret", SECRETO)
    monkeypatch.setattr(settings, "lemon_modo", "test")
    monkeypatch.setattr(settings, "lemon_variantes", {"111": "mensual"})
    llamadas = []

    def registrar(cuerpo, accion, evento):  # noqa: ANN001, ANN202
        llamadas.append((accion, evento))
        return "aplicado"

    monkeypatch.setattr(pagos, "registrar", registrar)
    app = FastAPI()
    app.include_router(router)
    cli = TestClient(app)
    cli.llamadas = llamadas  # type: ignore[attr-defined]
    return cli


def _cuerpo(evento: str = "subscription_created", test: bool = True) -> bytes:
    return json.dumps({
        "meta": {"event_name": evento, "test_mode": test,
                 "custom_data": {"user_id": USUARIO}},
        "data": {"id": "98765", "type": "subscriptions", "attributes": {
            "variant_id": 111, "status": "active",
            "renews_at": "2027-01-10T00:00:00.000000Z",
            "updated_at": "2026-10-10T10:00:00.000000Z"}},
    }).encode()


def _firma(cuerpo: bytes, secreto: str = SECRETO) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


def test_firma_buena_aplica_y_responde_estado(cliente):  # noqa: ANN001
    cuerpo = _cuerpo()
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 200
    assert r.json() == {"estado": "aplicado"}
    accion, evento = cliente.llamadas[0]
    assert accion.tipo == "pro" and accion.producto == "mensual"
    assert evento == "subscription_created"


def test_firma_mala_responde_401_y_no_aplica(cliente):  # noqa: ANN001
    cuerpo = _cuerpo()
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo, "otro")})
    assert r.status_code == 401
    assert cliente.llamadas == []


def test_sin_firma_responde_401(cliente):  # noqa: ANN001
    r = cliente.post("/liga/pagos/lemon/webhook", content=_cuerpo())
    assert r.status_code == 401


def test_cuerpo_no_json_responde_400(cliente):  # noqa: ANN001
    cuerpo = b"no es json"
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 400


def test_evento_de_test_con_modo_live_no_aplica_pro(cliente, monkeypatch):  # noqa: ANN001
    monkeypatch.setattr(settings, "lemon_modo", "live")
    cuerpo = _cuerpo(test=True)
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 200
    assert cliente.llamadas[0][0].tipo == "ignorar"


def test_cuerpo_demasiado_grande_responde_413(cliente):  # noqa: ANN001
    cuerpo = b"{" + b" " * (70 * 1024) + b"}"
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 413
