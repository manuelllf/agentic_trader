"""Las cabeceras de seguridad salen en todas las respuestas: las normales, las de error y las que
fabrica CORS, sin quitarles sus cabeceras de CORS."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

ESPERADAS = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}


def _con_cabeceras(respuesta) -> None:  # noqa: ANN001
    for nombre, valor in ESPERADAS.items():
        assert respuesta.headers.get(nombre) == valor, nombre


def test_health_lleva_las_cabeceras_de_seguridad() -> None:
    respuesta = TestClient(app).get("/health")
    assert respuesta.status_code == 200
    _con_cabeceras(respuesta)


def test_un_404_lleva_las_cabeceras_de_seguridad() -> None:
    respuesta = TestClient(app).get("/no-existe")
    assert respuesta.status_code == 404
    _con_cabeceras(respuesta)


def test_el_preflight_de_cors_las_lleva_y_conserva_las_suyas() -> None:
    origen = settings.cors_origins_list[0]
    respuesta = TestClient(app).options(
        "/health", headers={"Origin": origen, "Access-Control-Request-Method": "GET"})
    assert respuesta.status_code == 200
    assert respuesta.headers["access-control-allow-origin"] == origen
    _con_cabeceras(respuesta)


def test_un_error_interno_las_lleva_junto_a_las_de_cors() -> None:
    async def _boom() -> None:
        raise RuntimeError("fallo de prueba")

    app.add_api_route("/__boom", _boom, methods=["GET"])
    try:
        origen = settings.cors_origins_list[0]
        respuesta = TestClient(app, raise_server_exceptions=False).get(
            "/__boom", headers={"Origin": origen})
        assert respuesta.status_code == 500
        assert respuesta.headers["access-control-allow-origin"] == origen
        _con_cabeceras(respuesta)
    finally:
        app.router.routes = [x for x in app.router.routes if getattr(x, "path", "") != "/__boom"]
