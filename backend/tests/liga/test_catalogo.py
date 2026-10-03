"""Catálogo de reglas: qué deja pasar cada una y cómo explica en castellano por qué no."""

from __future__ import annotations

import pytest

from app.liga.motor.catalogo import (
    CATALOGO,
    EmpresaFoto,
    RecetaNoValida,
    fallo,
    preparar,
    regla_por_defecto,
    validar_reglas,
)
from app.liga.motor.formato import NBSP
from app.liga.procesos.datos import _metricas_catalogo

M = 1_000_000


def ev(clave: str, **datos) -> str | None:
    params = regla_por_defecto(clave)["params"]
    if clave in ("solo_sectores", "sin_sectores"):
        params = {"sectores": ["Technology", "Industrials"]}
    return CATALOGO[clave].evaluar(EmpresaFoto("X", **datos), params)


@pytest.mark.parametrize("clave", sorted(CATALOGO))
def test_un_dato_que_falta_nunca_pasa_y_la_regla_lo_dice(clave):
    motivo = ev(clave)
    assert motivo and motivo.startswith("no ")


def test_capitalizacion_con_sus_cifras():
    assert ev("medianas", market_cap_usd=1_900 * M) == (
        f"vale 1.900{NBSP}M$ y pides más de 2.000{NBSP}M$")
    assert ev("medianas", market_cap_usd=1_999.6 * M) == (
        f"vale 1.999,6{NBSP}M$ y pides más de 2.000{NBSP}M$")
    assert ev("medianas", market_cap_usd=2_000 * M) is not None       # «más de»: estricto
    assert ev("medianas", market_cap_usd=2_001 * M) is None
    assert ev("grandes", market_cap_usd=3_400_000 * M) is None
    assert ev("grandes", market_cap_usd=9_000 * M) == (
        f"vale 9.000{NBSP}M$ y pides más de 10.000{NBSP}M$")
    assert ev("grandes", market_cap_usd=-5.0) == "no hay dato de capitalización"


def test_pequenas_incluye_los_extremos():
    assert ev("pequenas", market_cap_usd=300 * M) is None
    assert ev("pequenas", market_cap_usd=2_000 * M) is None
    assert ev("pequenas", market_cap_usd=2_500 * M) == (
        f"vale 2.500{NBSP}M$ y pides entre 300 y 2.000{NBSP}M$")


def test_deuda_como_multiplo_de_ebitda():
    assert ev("deuda", deuda_total=100.0, caja_total=200.0) is None       # caja neta
    assert CATALOGO["deuda"].evaluar(
        EmpresaFoto("X", deuda_total=250.0, caja_total=0.0, ebitda=100.0), {"anios": 2}) == (
        "su deuda neta equivale a 2,5 veces su EBITDA y pides menos de 2 veces")
    assert CATALOGO["deuda"].evaluar(
        EmpresaFoto("X", deuda_total=150.0, caja_total=0.0, ebitda=100.0), {"anios": 2}) is None
    assert ev("deuda", deuda_total=150.0, caja_total=0.0, ebitda=-1.0) == (
        "no tiene EBITDA positivo con el que comparar su deuda neta")
    assert ev("deuda", deuda_total=150.0, caja_total=0.0) == "no hay dato de EBITDA"


def test_deuda_en_el_umbral_no_pasa():
    assert CATALOGO["deuda"].evaluar(
        EmpresaFoto("X", deuda_total=200.0, caja_total=0.0, ebitda=100.0), {"anios": 2}) == (
        "su deuda neta equivale a 2 veces su EBITDA y pides menos de 2 veces")
    casi = CATALOGO["deuda"].evaluar(
        EmpresaFoto("X", deuda_total=204.0, caja_total=0.0, ebitda=100.0), {"anios": 2})
    assert "equivale a 2,04 veces" in casi


def test_caja_neta():
    assert ev("caja_neta", deuda_total=1.0, caja_total=2.0) is None
    assert ev("caja_neta", deuda_total=2.0, caja_total=2.0) == "tiene tanta deuda como caja"
    assert ev("caja_neta", deuda_total=3.0, caja_total=2.0) == "tiene más deuda que caja"


def test_per():
    assert ev("barata", per=12.0) is None
    assert ev("barata", per=18.0) == "tiene un PER de 18 y pides menos de 18"
    assert ev("barata", per=17.96) is None
    assert ev("barata", per=18.04) == "tiene un PER de 18,04 y pides menos de 18"
    assert ev("barata", per=-4.0) == "tiene un PER negativo: pierde dinero"


def test_dividendo_crecimiento_margen_y_rentabilidad():
    assert ev("dividendo", dividend_yield_pct=3.0) is None
    assert ev("dividendo", dividend_yield_pct=1.2) == (
        f"su dividendo es del 1,2{NBSP}% y pides más del 2,5{NBSP}%")
    assert ev("crecen", crecimiento_ventas=0.08) is None
    assert ev("crecen", crecimiento_ventas=-0.03) == (
        f"la última variación interanual de ventas es una caída del 3{NBSP}% y pides que crezcan "
        f"más de un 5{NBSP}%")
    assert ev("crecen", crecimiento_ventas=0.02) == (
        f"la última variación interanual de ventas es del 2{NBSP}% y pides más de un 5{NBSP}%")
    assert ev("margen", margen_operativo=0.10) == (
        f"su margen es del 10{NBSP}% y pides más del 15{NBSP}%")
    assert ev("rentables", roe=-0.2) == (
        f"pierde un 20{NBSP}% sobre su capital y pides que gane más del 15{NBSP}%")
    assert ev("rentables", roe=0.2) is None


def test_yahoo_stored_metrics_map_without_dropping_zero_or_negative_values():
    assert _metricas_catalogo({
        "revenueGrowth": -0.1,
        "operatingMargins": 0.0,
        "returnOnEquity": -0.2,
        "dividendYield": 0.0,
    }) == {
        "crecimiento_ventas": -0.1,
        "margen_operativo": 0.0,
        "roe": -0.2,
        "dividend_yield_pct": 0.0,
    }


def test_thresholds_are_configurable_and_strict():
    assert ev("crecen", crecimiento_ventas=0.10) is None
    assert CATALOGO["crecen"].evaluar(
        EmpresaFoto("X", crecimiento_ventas=0.10), {"crecimiento_pct": 10}) is not None
    assert CATALOGO["crecen"].evaluar(
        EmpresaFoto("X", crecimiento_ventas=0.101), {"crecimiento_pct": 10}) is None

    assert CATALOGO["margen"].evaluar(
        EmpresaFoto("X", margen_operativo=0.20), {"margen_pct": 20}) is not None
    assert CATALOGO["margen"].evaluar(
        EmpresaFoto("X", margen_operativo=0.201), {"margen_pct": 20}) is None
    assert CATALOGO["rentables"].evaluar(
        EmpresaFoto("X", roe=0.20), {"roe_pct": 20}) is not None
    assert CATALOGO["rentables"].evaluar(
        EmpresaFoto("X", roe=0.201), {"roe_pct": 20}) is None
    assert CATALOGO["dividendo"].evaluar(
        EmpresaFoto("X", dividend_yield_pct=5), {"dividendo_pct": 5}) is not None
    assert CATALOGO["dividendo"].evaluar(
        EmpresaFoto("X", dividend_yield_pct=5.1), {"dividendo_pct": 5}) is None


def test_zero_values_are_present_data_not_missing():
    assert ev("crecen", crecimiento_ventas=0.0).startswith(
        f"la última variación interanual de ventas es del 0{NBSP}%")
    assert ev("margen", margen_operativo=0.0).startswith("su margen es del")
    assert ev("rentables", roe=0.0).startswith("gana un")
    assert ev("dividendo", dividend_yield_pct=0.0).startswith("su dividendo es del")


def test_castigadas():
    assert ev("castigadas", precio=60.0, max_52s=100.0) is None
    assert ev("castigadas", precio=100.0, max_52s=100.0) == (
        f"está en su máximo del último año y pides que haya caído un 30{NBSP}% o más")
    assert ev("castigadas", precio=80.0, max_52s=100.0) == (
        f"está a un 20{NBSP}% de su máximo y pides un 30{NBSP}% o más")


def test_reglas_de_sector_e_industria():
    assert ev("sin_energia", sector="Energy") == "es del sector energético, que dejaste fuera"
    assert ev("sin_energia", sector="Utilities") is None
    assert ev("sin_bancos", industria="Banks - Regional") == (
        "es un banco, y dejaste fuera la banca")
    assert ev("sin_tabaco", industria="Tobacco") == "es tabaquera, y dejaste fuera el tabaco"
    assert ev("solo_chips", industria="Semiconductors") is None
    assert ev("solo_chips", industria="Software - Infrastructure") == "no es de chips"
    assert ev("solo_sectores", sector="Healthcare") == (
        "es de salud, que no está entre tus sectores")
    assert ev("solo_sectores", sector="Technology") is None
    assert ev("sin_sectores", sector="Industrials") == "es de industria, que dejaste fuera"


def test_detalles():
    assert CATALOGO["deuda"].detalle({"anios": 1}) == (
        "deuda neta inferior a 1 vez el EBITDA")
    assert CATALOGO["deuda"].detalle() == "deuda neta inferior a 2 veces el EBITDA"
    assert CATALOGO["crecen"].detalle({"crecimiento_pct": 10}) == (
        f"última variación interanual de ventas superior al 10{NBSP}%")
    assert CATALOGO["solo_sectores"].detalle({"sectores": ["Industrials", "Technology"]}) == (
        "industria y tecnología")
    assert CATALOGO["solo_sectores"].detalle({"sectores": ["Technology", "Industrials"]}) == (
        "industria y tecnología")
    assert CATALOGO["sin_sectores"].detalle({"sectores": ["Energy", "Industrials"]}) == (
        "energía e industria")
    with pytest.raises(ValueError):
        CATALOGO["solo_sectores"].detalle()


def test_parametros_opcionales_conservan_valores_por_defecto_legacy():
    empresa = EmpresaFoto("X", crecimiento_ventas=0.08, margen_operativo=0.18, roe=0.18,
                          dividend_yield_pct=3.0)
    assert CATALOGO["crecen"].evaluar(empresa, {}) is None
    assert CATALOGO["margen"].evaluar(empresa, {}) is None
    assert CATALOGO["rentables"].evaluar(empresa, {}) is None
    assert CATALOGO["dividendo"].evaluar(empresa, {}) is None
    assert validar_reglas([{"clave": "crecen", "params": {}}]) == []
    assert fallo(EmpresaFoto("Y", crecimiento_ventas=0.08), [
        {"clave": "crecen", "params": {"crecimiento_pct": 10}},
    ]) is not None
    assert fallo(EmpresaFoto("Y", crecimiento_ventas=0.08), [
        {"clave": "crecen", "params": {}},
    ]) is None


def test_fallo_devuelve_la_primera_regla_en_el_orden_de_la_receta():
    e = EmpresaFoto("X", market_cap_usd=1_000 * M, per=50.0)
    medianas, barata = regla_por_defecto("medianas"), regla_por_defecto("barata")
    assert fallo(e, [medianas, barata]).startswith("vale")
    assert fallo(e, [barata, medianas]).startswith("tiene un PER")
    assert fallo(EmpresaFoto("Y", market_cap_usd=5_000 * M, per=10.0), [medianas, barata]) is None
    assert fallo(e, []) is None


@pytest.mark.parametrize(("reglas", "error"), [
    ("medianas", "lista"),
    ([{"clave": "inventada"}], "no está en el catálogo"),
    ([{"clave": "grandes"}, {"clave": "grandes"}], "repetida"),
    ([{"clave": "grandes", "otra": 1}], "campos que no existen"),
    ([{"clave": "grandes", "params": {"x": 1}}], "no lleva el ajuste"),
    ([{"clave": "deuda", "params": {}}], "le falta el ajuste"),
    ([{"clave": "deuda", "params": {"anios": 6}}], "va de 0,5 a 5"),
    ([{"clave": "deuda", "params": {"anios": 1.2}}], "de 0,5 en 0,5"),
    ([{"clave": "deuda", "params": {"anios": True}}], "tiene que ser un número"),
    ([{"clave": "barata", "params": {"per": "18"}}], "tiene que ser un número"),
    ([{"clave": "deuda", "params": None}], "tienen que ser un objeto"),
    ([{"clave": "solo_sectores", "params": {"sectores": []}}], "al menos un sector"),
    ([{"clave": "solo_sectores", "params": {"sectores": ["Tech"]}}], "no es uno de los 11"),
    ([{"clave": "grandes"}, {"clave": "pequenas"}], "no pueden ir juntas"),
    ([{"clave": "solo_sectores", "params": {"sectores": ["Energy"]}}, {"clave": "sin_energia"}],
     "no queda ningún sector"),
    ([{"clave": "solo_chips"}, {"clave": "sin_sectores", "params": {"sectores": ["Technology"]}}],
     "necesita el sector tecnología"),
])
def test_reglas_que_no_valen(reglas, error):
    errores = validar_reglas(reglas)
    assert any(error in e for e in errores), errores


def test_preparar_levanta_con_todos_los_errores_y_acepta_las_validas():
    with pytest.raises(RecetaNoValida) as exc:
        preparar([{"clave": "inventada"}, {"clave": "deuda", "params": {"anios": 9}}])
    assert len(exc.value.errores) == 2
    reglas = [regla_por_defecto(c) for c in ("medianas", "deuda", "barata")]
    reglas.append({"clave": "solo_sectores", "params": {"sectores": ["Technology"]}})
    assert validar_reglas(reglas) == []
    assert len(preparar(reglas)) == 4
