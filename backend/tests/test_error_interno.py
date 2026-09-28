"""Un error no controlado llega al navegador como un 500 con cabeceras CORS, no como «sin
conexión» (fetch rechaza la respuesta si no las lleva), y un tope de IA mal guardado no rompe el
panel ni deja pasar gasto."""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.liga.ia.comun import tope_mensual
from app.main import app


def test_un_error_interno_responde_500_con_cabeceras_cors() -> None:
    async def _boom() -> None:
        raise RuntimeError("fallo de prueba")

    app.add_api_route("/__boom", _boom, methods=["GET"])
    try:
        origen = settings.cors_origins_list[0]
        cliente = TestClient(app, raise_server_exceptions=False)
        r = cliente.get("/__boom", headers={"Origin": origen})
        assert r.status_code == 500
        codigo = r.json()["codigo"]
        assert len(codigo) == 6
        assert r.json()["detail"] == f"Algo ha fallado. Puedes reintentarlo o avisarnos. (código {codigo})"
        assert "fallo de prueba" not in r.text            # nada interno llega a la persona
        assert r.headers.get("access-control-allow-origin") == origen
    finally:
        app.router.routes = [x for x in app.router.routes if getattr(x, "path", "") != "/__boom"]


@pytest.mark.parametrize("valor, esperado", [
    (None, None), (0, Decimal(0)), (25, Decimal(25)), (12.5, Decimal("12.5")),
    ("30", Decimal(30)),
])
def test_tope_mensual_valido(valor, esperado) -> None:  # noqa: ANN001
    assert tope_mensual(valor) == esperado


@pytest.mark.parametrize("valor", [True, False, "abc", -1, float("inf"), [], {}])
def test_tope_mensual_mal_guardado_no_se_interpreta_como_un_importe(valor) -> None:  # noqa: ANN001
    with pytest.raises(ValueError):
        tope_mensual(valor)
