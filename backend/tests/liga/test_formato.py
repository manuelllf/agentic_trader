"""Cifras en castellano y redondeo comercial (la mitad hacia fuera)."""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

import pytest

from app.liga.motor.formato import (
    MENOS,
    NBSP,
    a_decimal,
    cifra,
    millones_usd,
    porcentaje,
    redondear,
)


@pytest.mark.parametrize(("valor", "esperado"), [
    ("0.55", "0.6"), ("0.54", "0.5"), ("0.45", "0.5"), ("-0.55", "-0.6"), ("-0.45", "-0.5"),
])
def test_redondear_es_la_mitad_hacia_fuera(valor, esperado):
    assert redondear(Decimal(valor), 1) == Decimal(esperado)


def test_a_decimal_lee_el_float_por_su_cifra_corta_y_descarta_lo_que_no_es_dato():
    assert a_decimal(2.5) == Decimal("2.5")
    assert a_decimal(0.1) == Decimal("0.1")
    assert a_decimal(Fraction(1, 4)) == Decimal("0.25")
    assert a_decimal(None) is None
    assert a_decimal(float("nan")) is None
    assert a_decimal(Decimal("Infinity")) is None
    with pytest.raises(TypeError):
        a_decimal(True)
    with pytest.raises(TypeError):
        a_decimal("3")  # type: ignore[arg-type]


def test_cifra_con_coma_decimal_punto_de_miles_y_menos_tipografico():
    assert cifra(1900, 0) == "1.900"
    assert cifra(Decimal("2.50")) == "2,5"
    assert cifra(3.0) == "3"
    assert cifra(-0.3) == f"{MENOS}0,3"
    assert cifra(1234567.891, 2) == "1.234.567,89"


def test_una_cifra_no_se_confunde_con_su_umbral():
    assert cifra(1999.6, 0, (2000,)) == "1.999,6"
    assert cifra(2000, 0, (2000,)) == "2.000"            # es el umbral: no gana decimales
    assert millones_usd(1999.6, (2000,)) == f"1.999,6{NBSP}M$"


def test_porcentaje_y_millones():
    assert porcentaje(2.5) == f"2,5{NBSP}%"
    assert millones_usd(1900) == f"1.900{NBSP}M$"
    assert millones_usd(3_400_000) == f"3,4{NBSP}billones de $"
    assert millones_usd(1_000_000) == f"1{NBSP}billón de $"
