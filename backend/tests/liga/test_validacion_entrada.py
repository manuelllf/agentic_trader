"""Lo que entra por la API se acota en la puerta: nada de lo que mande un cliente llega a la BD con
un tamaño o un rango que la BD no admita (columna `numeric(12,4)`, textos, listas)."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.liga.db import db_usuario
from app.liga.rutas_estrategias import RecetaIn, ReglaIn
from app.liga.rutas_gestion import CreditoIn

_RECETA = {"pesos": {"negocio": 100}, "n_empresas": 5, "reparto": "igual", "max_por_sector": 0}


@pytest.mark.parametrize("importe", ["0", "-1", "1000001", "99999999.9999", "1.00001"])
def test_el_importe_de_un_regalo_no_puede_desbordar_la_columna(importe: str) -> None:
    with pytest.raises(ValidationError):
        CreditoIn(usuario_id=uuid.uuid4(), importe=Decimal(importe), idempotencia="regalo-uno")


def test_un_importe_normal_vale() -> None:
    assert CreditoIn(usuario_id=uuid.uuid4(), importe=Decimal("15.5"),
                     idempotencia="regalo-uno").importe == Decimal("15.5")


@pytest.mark.parametrize("campo, valor", [
    ("reglas", [{"clave": "x"}] * 31),
    ("excluidas", ["AAPL"] * 101),
    ("excluidas", ["A" * 17]),
    ("reparto", "x" * 21),
])
def test_la_receta_acota_listas_y_textos(campo: str, valor: object) -> None:
    with pytest.raises(ValidationError):
        RecetaIn(**{**_RECETA, campo: valor})


def test_una_regla_acota_su_clave() -> None:
    with pytest.raises(ValidationError):
        ReglaIn(clave="x" * 41)


def test_el_ticker_de_la_ruta_tiene_largo_maximo() -> None:
    from app.liga.rutas_estrategias import router

    app = FastAPI()
    app.include_router(router, prefix="/liga")
    app.dependency_overrides[db_usuario] = lambda: None   # la validación va antes que la BD
    r = TestClient(app).post(f"/liga/estrategias/{uuid.uuid4()}/exclusiones/{'A' * 17}")
    assert r.status_code == 422
