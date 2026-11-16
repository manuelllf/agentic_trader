"""Valoración por escenarios: cuentas del código sobre supuestos del agente. Sin base ni red."""

from __future__ import annotations

import pytest

from app.agente import valoracion as v


def _uno(eps: float = 10, pe: float = 20) -> list[v.Escenario]:
    return v.leer_escenarios([{"name": "base", "eps": eps, "pe": pe}])


def test_un_escenario_cuentas_a_mano() -> None:
    r = v.valorar(100, _uno(), 5, 0.10)
    # 10 × 20 = 200 dentro de 5 años; 200 / 1,1^5 = 124,18 hoy.
    assert r["scenarios"][0]["price_final"] == 200
    assert r["expected_value_today"] == pytest.approx(124.18, abs=0.01)
    assert r["margin_of_safety"] == pytest.approx(0.1947, abs=0.0001)
    assert r["expected_return_annual"] == pytest.approx(0.1487, abs=0.0001)
    assert r["price_for_target_margin"] is None


def test_sin_probabilidades_pesos_iguales() -> None:
    es = v.leer_escenarios([{"eps": 5, "pe": 10}, {"eps": 15, "pe": 10}])
    assert [e.probabilidad for e in es] == [0.5, 0.5]
    assert v.valorar(100, es, 1, 0.10)["expected_price_final"] == 100


def test_probabilidades_explicitas_y_margen_objetivo() -> None:
    es = v.leer_escenarios([{"name": "fracaso", "eps": -1, "pe": 10, "probability": 0.25},
                            {"name": "base", "eps": 10, "pe": 20, "probability": 0.75}])
    r = v.valorar(100, es, 5, 0.10, margen_objetivo=0.25)
    fracaso = r["scenarios"][0]
    # Un beneficio negativo no da precio negativo: suelo en cero y pérdida total.
    assert fracaso["price_final"] == 0 and fracaso["return_annual"] == -1.0
    assert r["worst_scenario"] == "fracaso"
    assert r["expected_value_today"] == pytest.approx(0.75 * 124.18, abs=0.02)
    assert r["price_for_target_margin"] == pytest.approx(r["expected_value_today"] * 0.75, abs=0.01)


def test_el_dividendo_suma_valor_y_retorno() -> None:
    sin = v.valorar(100, _uno(), 5, 0.10)
    con = v.valorar(100, _uno(), 5, 0.10, dividendo=2)
    assert con["expected_value_today"] > sin["expected_value_today"]
    assert con["expected_return_annual"] == pytest.approx(sin["expected_return_annual"] + 0.02,
                                                          abs=0.0001)


@pytest.mark.parametrize("crudos", [
    [], [{"eps": 1, "pe": 10}] * 7, ["x"], [{"eps": 1, "pe": 0}], [{"eps": "a", "pe": 10}],
    [{"eps": 1, "pe": 10, "probability": 0.5}, {"eps": 1, "pe": 10}],
    [{"eps": 1, "pe": 10, "probability": 0.5}, {"eps": 1, "pe": 10, "probability": 0.3}],
    [{"eps": True, "pe": 10}], [{"eps": float("nan"), "pe": 10}],
])
def test_escenarios_mal_formados_se_rechazan(crudos: list) -> None:
    with pytest.raises(ValueError):
        v.leer_escenarios(crudos)


@pytest.mark.parametrize(("anios", "tasa", "div", "margen"), [
    (0, 0.10, 0, None), (11, 0.10, 0, None), (5, 0.01, 0, None), (5, 0.5, 0, None),
    (5, 0.10, -1, None), (5, 0.10, 0, 0.95)])
def test_parametros_fuera_de_rango(anios: int, tasa: float, div: float,
                                   margen: float | None) -> None:
    with pytest.raises(ValueError):
        v.valorar(100, _uno(), anios, tasa, div, margen)
