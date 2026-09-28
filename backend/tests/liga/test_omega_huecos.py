"""Huecos virtuales de Omega: asignación por orden de llegada y rentabilidad del mes."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.liga.motor.omega_huecos import (
    CAPITAL_TOTAL_USD,
    N_HUECOS,
    Alerta,
    Hueco,
    asignar_huecos,
    rentabilidad_hueco,
    rentabilidad_mes,
)
from app.precios import Cierre

BASE = date(2026, 9, 30)
D1, D5, D10, D20, DFIN = (date(2026, 10, 1), date(2026, 10, 5), date(2026, 10, 10),
                          date(2026, 10, 20), date(2026, 10, 30))


def _t(dia: date, hora: int = 12) -> datetime:
    return datetime(dia.year, dia.month, dia.day, hora)


def test_constantes_2000_dolares_en_4_huecos_de_500():
    assert N_HUECOS == 4
    assert CAPITAL_TOTAL_USD == Decimal(2000)


def test_asigna_por_orden_de_llegada_y_dejan_huecos_vacios():
    alertas = [
        Alerta("BBB", _t(D5), Decimal("10")),
        Alerta("AAA", _t(D1), Decimal("20")),
        Alerta("CCC", _t(D10), Decimal("5")),
    ]
    huecos = asignar_huecos(alertas)
    assert [h.ticker for h in huecos] == ["AAA", "BBB", "CCC", None]
    assert huecos[0].entrada == _t(D1)
    assert huecos[3].entrada is None
    assert [h.numero for h in huecos] == [1, 2, 3, 4]


def test_quinta_alerta_del_mes_se_queda_fuera():
    alertas = [Alerta(f"T{i}", _t(D1, i), Decimal("10")) for i in range(5)]
    huecos = asignar_huecos(alertas)
    assert len(huecos) == 4
    assert {h.ticker for h in huecos} == {"T0", "T1", "T2", "T3"}


def test_una_alerta_repetida_del_mismo_ticker_no_ocupa_dos_huecos():
    alertas = [
        Alerta("AAA", _t(D1), Decimal("10")),
        Alerta("AAA", _t(D5), Decimal("30")),  # misma acción, otra alerta el mismo mes
        Alerta("BBB", _t(D10), Decimal("5")),
    ]
    huecos = asignar_huecos(alertas)
    assert [h.ticker for h in huecos] == ["AAA", "BBB", None, None]
    assert huecos[0].entrada == _t(D1)  # se queda con la primera, no con la segunda


@pytest.mark.parametrize(("alertas", "primero"), [
    # Mismo instante: gana la caída más fuerte (mayor caida_pct).
    ([Alerta("AAA", _t(D1), Decimal("10")), Alerta("BBB", _t(D1), Decimal("25"))], "BBB"),
    # Mismo instante y misma caída: gana la mayor capitalización.
    ([Alerta("AAA", _t(D1), Decimal("10"), Decimal("1000")),
      Alerta("BBB", _t(D1), Decimal("10"), Decimal("5000"))], "BBB"),
    # Mismo instante, misma caída, sin capitalización de ninguna: gana el ticker alfabético.
    ([Alerta("BBB", _t(D1), Decimal("10")), Alerta("AAA", _t(D1), Decimal("10"))], "AAA"),
    # Con capitalización solo en una: la que la tiene gana el empate (sin dato, al final).
    ([Alerta("AAA", _t(D1), Decimal("10")),
      Alerta("BBB", _t(D1), Decimal("10"), Decimal("1"))], "BBB"),
])
def test_desempate_nunca_al_azar(alertas, primero):
    assert asignar_huecos(alertas)[0].ticker == primero


def test_ningun_hueco_se_asigna_al_azar_con_muchos_empates_deterministas():
    # Da igual el orden en que llegan las alertas dentro de la lista: el resultado es el mismo.
    alertas = [Alerta("ZZZ", _t(D1), Decimal("10")), Alerta("AAA", _t(D1), Decimal("10")),
              Alerta("MMM", _t(D1), Decimal("10"))]
    orden1 = [h.ticker for h in asignar_huecos(alertas)]
    orden2 = [h.ticker for h in asignar_huecos(list(reversed(alertas)))]
    assert orden1 == orden2 == ["AAA", "MMM", "ZZZ", None]


# --- Rentabilidad del mes -------------------------------------------------------------------------

CIERRES = {
    "AAA": [Cierre(D1, 100.0), Cierre(D5, 100.0), Cierre(D10, 100.0), Cierre(D20, 100.0),
            Cierre(DFIN, 110.0)],   # entra el D1: +10 % al cierre del mes
    "BBB": [Cierre(D10, 50.0), Cierre(D20, 50.0), Cierre(DFIN, 45.0)],   # entra el D10: −10 %
    "CCC": [Cierre(D20, 20.0), Cierre(DFIN, 20.0, dividendo=0.2)],       # entra el D20: +1 %
}


def _huecos() -> list[Hueco]:
    return [Hueco(1, "AAA", _t(D1)), Hueco(2, "BBB", _t(D10)), Hueco(3, "CCC", _t(D20)),
            Hueco(4, None, None)]


def test_rentabilidad_de_cada_hueco_desde_su_propia_entrada():
    huecos = _huecos()
    assert rentabilidad_hueco(huecos[0], CIERRES["AAA"], DFIN) == Decimal("10.0000")
    assert rentabilidad_hueco(huecos[1], CIERRES["BBB"], DFIN) == Decimal("-10.0000")
    assert rentabilidad_hueco(huecos[2], CIERRES["CCC"], DFIN) == Decimal("1.0000")
    assert rentabilidad_hueco(huecos[3], (), DFIN) == Decimal("0.0000")  # nunca se llenó: caja


def test_rentabilidad_del_mes_es_25_por_ciento_de_cada_hueco_caja_incluida():
    r = rentabilidad_mes(_huecos(), CIERRES, DFIN)
    # 25 · 0,10 + 25 · (−0,10) + 25 · 0,01 + 25 · 0 = 0,25
    assert r == Decimal("0.2500")


def test_un_mes_sin_ninguna_alerta_rinde_0():
    huecos = [Hueco(i, None, None) for i in range(1, 5)]
    assert rentabilidad_mes(huecos, {}, DFIN) == Decimal("0.0000")


def test_falta_el_cierre_de_entrada_es_un_error():
    huecos = [Hueco(1, "AAA", _t(D5))]  # entra el D5, pero solo hay cierre del D1 en adelante
    with pytest.raises(ValueError):
        rentabilidad_mes(huecos, {"AAA": [Cierre(D1, 100.0)]}, DFIN)


def test_entrada_despues_del_cierre_del_mes_es_un_error():
    huecos = [Hueco(1, "AAA", _t(DFIN, 23))]
    with pytest.raises(ValueError):
        rentabilidad_hueco(huecos[0], [Cierre(DFIN, 100.0)], D1)
