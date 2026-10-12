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
    monkeypatch.setattr(registro, "_altas", acceso.LimiteFrecuencia(100, 900))
    monkeypatch.setattr(registro, "_ultimo_aviso_pico", float("-inf"))
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
    assert llamada["json"]["data"] == {
        "alias": "usuario", "terminos_version": registro.VERSION_TERMINOS, "idioma": "es"}
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


def test_cierre_bloquea_alta_pero_permite_correos(cliente, monkeypatch):
    client, pedidos = cliente
    monkeypatch.setattr(registro.gestion, "registro_abierto", lambda: False)
    assert client.post("/registro", json=datos()).status_code == 403
    assert not pedidos
    for ruta, proveedor, cuerpo, enlace in (
        ("/recuperar", "recover", {"email": "usuario@correo.es"}, registro.ENLACE_CLAVE),
        ("/reenviar", "resend", {"type": "signup", "email": "usuario@correo.es"},
         registro.ENLACE_ENTRADA),
    ):
        respuesta = client.post("/registro" + ruta, json=datos())
        assert respuesta.status_code == 200
        assert respuesta.json() == {"ok": True}
        url, llamada = pedidos[-1]
        assert url == "https://auth.invalid/auth/v1/" + proveedor
        assert llamada["json"] == cuerpo
        assert llamada["params"] == {"redirect_to": "http://localhost:3000" + enlace}
    assert len(pedidos) == 2


@pytest.mark.parametrize("idioma", ["en", "EN-US,en;q=0.9"])
def test_alta_guarda_idioma_ingles(cliente, idioma):
    client, pedidos = cliente
    respuesta = client.post("/registro", json=datos(), headers={"Accept-Language": idioma})
    assert respuesta.status_code == 200
    assert pedidos[0][1]["json"]["data"] == {
        "alias": "usuario", "terminos_version": registro.VERSION_TERMINOS, "idioma": "en"}


@pytest.mark.parametrize("ruta", ["/recuperar", "/reenviar"])
def test_correo_oculta_rechazo_del_proveedor(cliente, monkeypatch, ruta):
    client, _ = cliente
    monkeypatch.setattr(registro.httpx, "post", lambda *a, **k: httpx.Response(
        400, json={"message": "Cuenta existente: privado@correo.es"}))
    respuesta = client.post("/registro" + ruta, json=datos())
    assert respuesta.status_code == 200
    assert respuesta.json() == {"ok": True}


@pytest.mark.parametrize("estado, esperado", [(429, 429), (500, 503), (401, 503), (403, 503)])
def test_recuperacion_conserva_errores_del_proveedor(cliente, monkeypatch, estado, esperado):
    client, _ = cliente
    monkeypatch.setattr(registro.httpx, "post", lambda *a, **k: httpx.Response(estado))
    assert client.post("/registro/recuperar", json=datos()).status_code == esperado


@pytest.mark.parametrize("ruta", ["/recuperar", "/reenviar"])
@pytest.mark.parametrize("cambios", [
    {"email": "no-es-email"}, {"origen": "https://atacante.example"},
])
def test_correo_invalido_no_llega_al_proveedor(cliente, ruta, cambios):
    client, pedidos = cliente
    assert client.post("/registro" + ruta, json=datos(**cambios)).status_code == 422
    assert not pedidos


def test_limite_frena_altas_repetidas(cliente):
    client, pedidos = cliente
    for _ in range(5):
        assert client.post("/registro", json=datos()).status_code == 200
    assert client.post("/registro", json=datos()).status_code == 429
    assert len(pedidos) == 5


def test_un_pico_de_altas_avisa_una_vez_y_no_bloquea(cliente, monkeypatch):
    client, pedidos = cliente
    avisos = []
    monkeypatch.setattr(registro, "_limite", acceso.LimiteFrecuencia(50, 900))
    monkeypatch.setattr(registro, "_altas", acceso.LimiteFrecuencia(3, 900))
    monkeypatch.setattr("app.push.send_to_all", lambda *a, **k: avisos.append(k["title"]))
    monkeypatch.setattr("app.liga.procesos.comun.fabrica_sistema",
                        lambda: type("Db", (), {"close": lambda self: None})())
    for _ in range(8):
        assert client.post("/registro", json=datos()).status_code == 200
    assert len(pedidos) == 8
    assert avisos == ["Vennett: pico de altas"]


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
