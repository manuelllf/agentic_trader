"""El premio anual: el acumulado, los escalones y el reparto con empates. Sin base de datos."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.liga.motor.premio import IMPORTES, Cuenta, acumulada, escalon, repartir

D = Decimal
COMPLETO = IMPORTES[2]


def _cuentas(*rentabilidades: str) -> list[Cuenta]:
    return [Cuenta(f"c{i}", 12, D(r)) for i, r in enumerate(rentabilidades)]


def _por_cuenta(premios) -> dict[str, tuple[int, Decimal]]:  # noqa: ANN001
    return {p.cuenta: (p.puesto, p.importe) for p in premios}


def test_el_acumulado_se_compone_y_lo_no_jugado_vale_cero() -> None:
    assert acumulada([D(10), D(10)]) == D(21)
    assert acumulada([D(10), None, D(10)]) == acumulada([D(10), D(0), D(10)]) == D("21.0")
    assert acumulada([D(50), D(-50)]) == D(-25)
    assert acumulada([]) == D(0)


@pytest.mark.parametrize(("elegibles", "esperado"), [
    (0, 0), (99, 0), (100, 1), (249, 1), (250, 2), (5000, 2)])
def test_los_escalones_se_activan_con_los_umbrales(elegibles: int, esperado: int) -> None:
    assert escalon(elegibles) == esperado


def test_un_umbral_completo_menor_que_el_basico_no_se_salta_el_primer_escalon() -> None:
    assert escalon(150, umbral_basico=200, umbral_completo=100) == 0
    assert escalon(200, umbral_basico=200, umbral_completo=100) == 2


def test_sin_empates_cobran_los_tres_primeros() -> None:
    premios = repartir(_cuentas("5", "30", "12", "-2"), COMPLETO)
    assert _por_cuenta(premios) == {
        "c1": (1, D("300.00")), "c2": (2, D("150.00")), "c0": (3, D("50.00"))}


@pytest.mark.parametrize(("rentabilidades", "esperado"), [
    # dos en el 1.º: 225 cada una y la tercera cobra el 3.º
    (("20", "20", "10", "1"), {"c0": (1, D("225.00")), "c1": (1, D("225.00")),
                                "c2": (3, D("50.00"))}),
    # tres en el 1.º: los 500 entre tres, al céntimo hacia abajo, y nadie más
    (("20", "20", "20", "1"), {"c0": (1, D("166.66")), "c1": (1, D("166.66")),
                                "c2": (1, D("166.66"))}),
    # dos en el 2.º: 150 y 50 entre dos
    (("30", "20", "20", "1"), {"c0": (1, D("300.00")), "c1": (2, D("100.00")),
                                "c2": (2, D("100.00"))}),
    # cuatro o más en el 1.º: todo entre todas
    (("9", "9", "9", "9", "1"), {"c0": (1, D("125.00")), "c1": (1, D("125.00")),
                                  "c2": (1, D("125.00")), "c3": (1, D("125.00"))}),
    # varias en el 3.º: solo el 50
    (("30", "20", "10", "10", "10"), {"c0": (1, D("300.00")), "c1": (2, D("150.00")),
                                       "c2": (3, D("16.66")), "c3": (3, D("16.66")),
                                       "c4": (3, D("16.66"))}),
])
def test_las_empatadas_se_reparten_los_premios_de_sus_puestos(
        rentabilidades: tuple[str, ...], esperado: dict) -> None:
    assert _por_cuenta(repartir(_cuentas(*rentabilidades), COMPLETO)) == esperado


def test_hay_empate_con_los_decimales_que_se_ensenan() -> None:
    premios = repartir(_cuentas("12.341", "12.344", "3"), COMPLETO)
    assert _por_cuenta(premios)["c0"] == _por_cuenta(premios)["c1"] == (1, D("225.00"))
    distintas = repartir(_cuentas("12.34", "12.36", "3"), COMPLETO)
    assert _por_cuenta(distintas)["c1"] == (1, D("300.00"))


def test_con_menos_cuentas_que_premios_cobran_las_que_hay() -> None:
    assert _por_cuenta(repartir(_cuentas("4", "9"), COMPLETO)) == {
        "c1": (1, D("300.00")), "c0": (2, D("150.00"))}
    assert repartir([], COMPLETO) == []


def test_el_escalon_reducido_reparte_sus_importes() -> None:
    premios = repartir(_cuentas("3", "2", "1"), IMPORTES[1])
    assert [p.importe for p in premios] == [D("150.00"), D("75.00"), D("25.00")]


def test_nunca_se_paga_mas_que_el_premio() -> None:
    for tamano in range(1, 9):
        cuentas = _cuentas(*(["7"] * tamano))
        assert sum(p.importe for p in repartir(cuentas, COMPLETO)) <= sum(COMPLETO)
