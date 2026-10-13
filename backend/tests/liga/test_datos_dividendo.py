import json

import pytest

from app.liga.motor.catalogo import CATALOGO, EmpresaFoto
from app.liga.procesos.datos import _metricas_catalogo


def test_dividendo_en_porcentaje():
    datos = _metricas_catalogo({"dividendRate": 2.12}, 88.0)
    assert datos["dividend_yield_pct"] == pytest.approx(2.409090909)


def test_dividend_yield_sin_dividend_rate_no_da_dato():
    assert "dividend_yield_pct" not in _metricas_catalogo({"dividendYield": 0.0241}, 88.0)


@pytest.mark.parametrize("dividendo", [0, -2.12, True, None, "2.12"])
def test_dividendo_no_valido_no_da_dato(dividendo):
    assert "dividend_yield_pct" not in _metricas_catalogo({"dividendRate": dividendo}, 88.0)


@pytest.mark.parametrize("precio", [0, None, -88.0])
def test_precio_no_positivo_no_da_dato(precio):
    assert "dividend_yield_pct" not in _metricas_catalogo({"dividendRate": 2.12}, precio)


def test_metricas_en_json_se_leen_igual():
    metricas = {"dividendRate": 2.12, "returnOnEquity": 0.18}
    assert _metricas_catalogo(json.dumps(metricas), 88.0) == _metricas_catalogo(metricas, 88.0)


def test_otras_metricas_conservan_su_escala():
    assert _metricas_catalogo({
        "revenueGrowth": -0.1,
        "operatingMargins": 0.0,
        "returnOnEquity": 0.18,
        "totalDebt": 200,
        "totalCash": 100,
        "ebitda": 50,
    }, 88.0) == {
        "crecimiento_ventas": -0.1,
        "margen_operativo": 0.0,
        "roe": 0.18,
        "deuda_total": 200.0,
        "caja_total": 100.0,
        "ebitda": 50.0,
    }


@pytest.mark.parametrize("dividendo, precio, pasa", [(2.12, 88.0, False), (3.0, 100.0, True)])
def test_motor_aplica_el_umbral_en_porcentaje(dividendo, precio, pasa):
    empresa = EmpresaFoto("X", **_metricas_catalogo({"dividendRate": dividendo}, precio))
    motivo = CATALOGO["dividendo"].evaluar(empresa, {"dividendo_pct": 2.5})
    assert (motivo is None) is pasa
