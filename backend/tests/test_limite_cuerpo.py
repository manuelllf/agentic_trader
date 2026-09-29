"""Tope al tamaño del cuerpo de una petición: un JSON de decenas de MB se rechaza con 413 antes de
parsearlo, lo declare la cabecera o llegue troceado."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.limite_cuerpo import CuerpoAcotado


def _app(maximo: int = 1000) -> TestClient:
    app = FastAPI()

    @app.post("/liga/eco")
    @app.post("/admin/eco")
    async def eco(request: Request) -> dict:
        return {"bytes": len(await request.body())}

    app.add_middleware(CuerpoAcotado, maximo=maximo, prefijo="/liga")
    return TestClient(app)


def test_un_cuerpo_normal_pasa() -> None:
    assert _app().post("/liga/eco", content=b"x" * 1000).json() == {"bytes": 1000}


def test_fuera_del_prefijo_no_se_limita() -> None:
    # La subida de CSV del admin cuelga de otra ruta y pesa megas.
    assert _app().post("/admin/eco", content=b"x" * 5000).json() == {"bytes": 5000}


def test_un_cuerpo_que_declara_de_mas_se_rechaza_sin_leerlo() -> None:
    r = _app().post("/liga/eco", content=b"x" * 1001)
    assert r.status_code == 413
    assert "demasiado grande" in r.json()["detail"]


def test_un_cuerpo_troceado_sin_longitud_tambien_se_corta() -> None:
    def trozos():  # noqa: ANN202
        for _ in range(20):
            yield b"x" * 100

    r = _app().post("/liga/eco", content=trozos())
    assert r.status_code == 413
