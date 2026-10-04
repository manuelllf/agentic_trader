"""Registro con proveedor simulado: cierre, límites y destinos sin acceso a producción."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.liga import acceso, registro


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setattr(registro.settings, "supabase_url", "https://auth.invalid")
    monkeypatch.setattr(registro.settings, "supabase_publishable_key", "publica-prueba")
    monkeypatch.setattr(registro.settings, "cors_origins", "http://localhost:3000")
    monkeypatch.setattr(registro.gestion, "registro_abierto", lambda: True)
    monkeypatch.setattr(registro, "_limite", acceso.LimiteFrecuencia(5, 900))
    monkeypatch.setattr(registro, "_global", acceso.LimiteFrecuencia(100, 900))
    pedidos = []
    def enviar(url, **kwargs):
        pedidos.append((url, kwargs))
        return httpx.Response(200, json={"id": "usuario", "access_token": "privado-no-devolver"})
    monkeypatch.setattr(registro.httpx, "post", enviar)
    app = FastAPI()
    app.include_router(registro.router)
    return TestClient(app), pedidos


def datos(**cambios):
    return {"email": "Usuario@correo.es", "origen": "http://localhost:3000",
            "alias": "usuario", "clave": "Segura!123", "acepta_terminos": True, **cambios}


def test_alta_no_devuelve_tokens_y_envia_solo_metadata_de_perfil(cliente):
    client, pedidos = cliente
    assert client.post("/registro", json=datos()).json() == {"ok": True}
    url, llamada = pedidos[0]
    assert url.endswith("/signup")
    assert llamada["params"] == {}
    assert llamada["json"]["email"] == "usuario@correo.es"
    assert llamada["json"]["data"] == {"alias": "usuario", "terminos_version": "1"}
    assert "Authorization" not in llamada["headers"]


@pytest.mark.parametrize("cambios", [
    {"clave": "corta!"}, {"clave": "sinmayuscula!"}, {"clave": "SinSimbolo123"},
    {"clave": "Mayuscula "}, {"clave": "A!" * 101}, {"alias": "admin"},
    {"alias": "nombre con espacios"}, {"email": "no-es-email"},
    {"acepta_terminos": False}, {"origen": "https://atacante.example"},
    {"origen": "http://localhost:3000@atacante.example"},
    {"origen": "http://localhost:3000/otra"},
    {"origen": "http://["},
])
def test_datos_invalidos_no_llegan_al_proveedor(cliente, cambios):
    client, pedidos = cliente
    assert client.post("/registro", json=datos(**cambios)).status_code == 422
    assert not pedidos


def test_cierre_bloquea_alta_y_correos_pospuestos(cliente, monkeypatch):
    client, pedidos = cliente
    monkeypatch.setattr(registro.gestion, "registro_abierto", lambda: False)
    assert client.post("/registro", json=datos()).status_code == 403
    for ruta in ("/recuperar", "/reenviar"):
        assert client.post("/registro" + ruta, json=datos()).status_code == 404
    assert not pedidos


def test_limite_frena_altas_repetidas(cliente):
    client, pedidos = cliente
    for _ in range(5):
        assert client.post("/registro", json=datos()).status_code == 200
    assert client.post("/registro", json=datos()).status_code == 429
    assert len(pedidos) == 5


def test_fallo_del_proveedor_no_filtra_sus_datos(cliente, monkeypatch):
    client, _ = cliente
    monkeypatch.setattr(registro.httpx, "post", lambda *a, **k: httpx.Response(
        400, json={"message": "Cuenta existente: privado@correo.es"}))
    respuesta = client.post("/registro", json=datos())
    assert respuesta.status_code == 503
    assert "privado" not in respuesta.text


def test_confirmacion_activa_no_se_presenta_como_alta_completa(cliente, monkeypatch):
    client, _ = cliente
    monkeypatch.setattr(registro.httpx, "post", lambda *a, **k: httpx.Response(
        200, json={"id": "pendiente"}))
    assert client.post("/registro", json=datos()).status_code == 503


def test_auth_sin_configuracion_no_envia_correo(cliente, monkeypatch):
    client, pedidos = cliente
    monkeypatch.setattr(registro.settings, "supabase_url", "")
    assert client.post("/registro", json=datos()).status_code == 503
    assert not pedidos
    assert client.get("/registro").json() == {
        "correo_disponible": False, "registro_abierto": False,
    }
