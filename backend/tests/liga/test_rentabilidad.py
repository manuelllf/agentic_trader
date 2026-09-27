"""Compra y mantén con los pesos del día 1: dividendos, splits, caja y bajas de cotización."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.liga.motor.rentabilidad import (
    pesos_mantenidos,
    rentabilidad_cartera,
    rentabilidad_sp,
    serie_diaria,
)
from app.precios import Cierre, indice

ANTES, BASE = date(2026, 9, 29), date(2026, 9, 30)
D1, D2, D5 = date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5)

CIERRES = {
    # Split 2:1 el día 2: el cierre cae a 56, que son 112 de antes.
    "SPL": [Cierre(ANTES, 1.0), Cierre(BASE, 100.0), Cierre(D1, 110.0),
            Cierre(D2, 56.0, split=2.0), Cierre(D5, 55.0)],
    # El dividendo con fecha ex el día base no es nuestro; el del día 1, sí.
    "DIV": [Cierre(BASE, 50.0, dividendo=0.5), Cierre(D1, 50.0, dividendo=1.0),
            Cierre(D2, 51.0), Cierre(D5, 51.0)],
    # Deja de cotizar tras el día 1: se queda en −10 %.
    "FUERA": [Cierre(BASE, 100.0), Cierre(D1, 90.0)],
}
CARTERA = [("SPL", Decimal("40")), ("DIV", Decimal("30")), ("FUERA", Decimal("10"))]


def test_rentabilidad_total_con_split_dividendo_baja_y_caja_a_0():
    assert rentabilidad_cartera(CARTERA, CIERRES, BASE, D1) == Decimal("3.6000")
    # 40·12 % + 30·4,04 % + 10·(−10 %)
    assert rentabilidad_cartera(CARTERA, CIERRES, BASE, D2) == Decimal("5.0120")
    assert rentabilidad_cartera(CARTERA, CIERRES, BASE, D5) == Decimal("4.2120")


def test_el_dia_base_la_rentabilidad_es_0_y_un_festivo_repite_el_ultimo_cierre():
    assert rentabilidad_cartera(CARTERA, CIERRES, BASE, BASE) == Decimal("0.0000")
    sabado = date(2026, 10, 3)
    assert rentabilidad_cartera(CARTERA, CIERRES, BASE, sabado) == (
        rentabilidad_cartera(CARTERA, CIERRES, BASE, D2))


def test_usa_la_misma_cuenta_que_precios_indice():
    niveles = indice([c for c in CIERRES["SPL"] if c.dia >= BASE], dividendos=1.0)
    r = rentabilidad_cartera([("SPL", Decimal(100))], CIERRES, BASE, D5)
    assert r == Decimal(str(round((niveles[D5] - 1) * 100, 4)))


def test_serie_diaria_y_referencia():
    serie = serie_diaria(CARTERA, CIERRES, BASE, [D1, D2, D5])
    assert [r for _, r in serie] == [Decimal("3.6000"), Decimal("5.0120"), Decimal("4.2120")]
    spy = [Cierre(BASE, 500.0), Cierre(D1, 503.0, dividendo=2.0)]
    assert rentabilidad_sp(spy, BASE, D1) == Decimal("1.0000")


def test_todo_en_caja_rinde_0():
    assert rentabilidad_cartera([], {}, BASE, D5) == Decimal("0.0000")


@pytest.mark.parametrize(("posiciones", "cierres", "error"), [
    ([("SPL", Decimal(40))], {"SPL": CIERRES["SPL"][2:]}, ValueError),     # sin cierre base
    ([("NADA", Decimal(40))], {}, ValueError),
    ([("SPL", 40.0)], CIERRES, TypeError),
    ([("SPL", Decimal(-1))], CIERRES, ValueError),
    ([("SPL", Decimal(60)), ("DIV", Decimal(41))], CIERRES, ValueError),
    ([("SPL", Decimal(10)), ("SPL", Decimal(10))], CIERRES, ValueError),
    ([("SPL", Decimal(10))], {"SPL": [Cierre(BASE, 1.0), Cierre(BASE, 2.0)]}, ValueError),
])
def test_carteras_que_no_se_pueden_valorar(posiciones, cierres, error):
    with pytest.raises(error):
        rentabilidad_cartera(posiciones, cierres, BASE, D5)


def test_un_dia_anterior_al_base_es_un_error():
    with pytest.raises(ValueError):
        serie_diaria(CARTERA, CIERRES, BASE, [ANTES])


def test_mantener_crece_con_la_rentabilidad_y_lo_que_dejo_de_cotizar_pasa_a_caja():
    pesos = dict(pesos_mantenidos(CARTERA, CIERRES, BASE, D5))
    assert set(pesos) == {"SPL", "DIV"}
    # Valen 44 y 31,212; FUERA (9) y la caja (20) suman 29: total 104,212.
    assert float(pesos["SPL"]) == pytest.approx(44 / 104.212 * 100, abs=1e-4)
    assert float(pesos["DIV"]) == pytest.approx(31.212 / 104.212 * 100, abs=1e-4)
    assert all(p == p.quantize(Decimal("0.0001")) for p in pesos.values())
    assert sum(pesos.values()) <= 100


def test_mantener_una_cartera_llena_sin_bajas_suma_100():
    cartera = [("SPL", Decimal(50)), ("DIV", Decimal(50))]
    pesos = pesos_mantenidos(cartera, CIERRES, BASE, D5)
    assert sum(p for _, p in pesos) == Decimal(100)
