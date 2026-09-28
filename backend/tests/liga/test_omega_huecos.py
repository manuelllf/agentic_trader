"""Huecos virtuales de Omega: asignación por orden de llegada, salida objetivo/90 días, huecos
que se liberan y vuelven a llenarse, capital compuesto y persistencia entre jornadas (carry-over).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.liga.motor.omega_huecos import (
    CAPITAL_TOTAL_USD,
    N_HUECOS,
    Alerta,
    Operacion,
    detectar_salida,
    rentabilidad_mes,
    simular,
    valor_hueco,
)
from app.precios import Cierre

D0 = date(2026, 10, 1)


def _t(dia: date, hora: int = 12) -> datetime:
    return datetime(dia.year, dia.month, dia.day, hora)


def _dias(desde: date, n: int) -> list[date]:
    return [desde + timedelta(days=i) for i in range(n)]


def _serie_plana(desde: date, n: int, precio: float) -> list[Cierre]:
    return [Cierre(d, precio) for d in _dias(desde, n)]


def test_constantes_2000_dolares_en_4_huecos_de_500():
    assert N_HUECOS == 4
    assert CAPITAL_TOTAL_USD == 2000


# ---- asignación de huecos (simular sin ninguna salida) ---------------------------------------

def test_asigna_por_orden_de_llegada_y_deja_huecos_vacios():
    alertas = [
        Alerta("BBB", _t(D0 + timedelta(days=4)), 10),
        Alerta("AAA", _t(D0), 20),
        Alerta("CCC", _t(D0 + timedelta(days=9)), 5),
    ]
    cierres = {"AAA": _serie_plana(D0, 30, 100), "BBB": _serie_plana(D0, 30, 50),
              "CCC": _serie_plana(D0, 30, 20)}
    hoy = D0 + timedelta(days=9)
    ops = simular((), alertas, cierres, D0, hoy)
    abiertas = {o.numero: o.ticker for o in ops if o.abierta}
    assert abiertas == {1: "AAA", 2: "BBB", 3: "CCC"}
    assert 4 not in abiertas


def test_quinta_alerta_del_mes_se_queda_fuera():
    alertas = [Alerta(f"T{i}", _t(D0, 8 + i), 10) for i in range(5)]
    cierres = {f"T{i}": _serie_plana(D0, 30, 10 + i) for i in range(5)}
    ops = simular((), alertas, cierres, D0, D0)
    tickers = {o.ticker for o in ops}
    assert len(tickers) == 4
    assert "T4" not in tickers


def test_una_alerta_repetida_del_mismo_ticker_no_ocupa_dos_huecos():
    alertas = [
        Alerta("AAA", _t(D0), 10),
        Alerta("AAA", _t(D0 + timedelta(days=4)), 30),
        Alerta("BBB", _t(D0 + timedelta(days=9)), 5),
    ]
    cierres = {"AAA": _serie_plana(D0, 30, 100), "BBB": _serie_plana(D0, 30, 50)}
    ops = simular((), alertas, cierres, D0, D0 + timedelta(days=9))
    abiertas = {o.numero: (o.ticker, o.entrada_dia) for o in ops if o.abierta}
    assert abiertas[1] == ("AAA", D0)  # se queda con la primera, no con la segunda
    assert abiertas[2][0] == "BBB"


@pytest.mark.parametrize(("alertas", "primero"), [
    ([Alerta("AAA", _t(D0), 10), Alerta("BBB", _t(D0), 25)], "BBB"),
    ([Alerta("AAA", _t(D0), 10, 1000), Alerta("BBB", _t(D0), 10, 5000)], "BBB"),
    ([Alerta("BBB", _t(D0), 10), Alerta("AAA", _t(D0), 10)], "AAA"),
    ([Alerta("AAA", _t(D0), 10), Alerta("BBB", _t(D0), 10, 1)], "BBB"),
])
def test_desempate_nunca_al_azar(alertas, primero):
    cierres = {"AAA": _serie_plana(D0, 5, 100), "BBB": _serie_plana(D0, 5, 100)}
    ops = simular((), alertas, cierres, D0, D0)
    assert next(o.ticker for o in ops if o.numero == 1) == primero


# ---- salida (objetivo / 90 días) --------------------------------------------------------------

def test_detecta_salida_por_objetivo():
    # arranque flojo (<5% a 3 sesiones) -> objetivo +11%.
    serie = [Cierre(D0, 100), Cierre(D0 + timedelta(days=1), 100),
            Cierre(D0 + timedelta(days=2), 101), Cierre(D0 + timedelta(days=3), 102),
            Cierre(D0 + timedelta(days=4), 112)]  # +12% -> dispara el objetivo (11%)
    salida = detectar_salida(serie, D0, 100, D0 + timedelta(days=4))
    assert salida == (D0 + timedelta(days=4), 112, "objetivo")


def test_detecta_salida_por_tiempo():
    dias = _dias(D0, 95)
    serie = [Cierre(d, 100) for d in dias]  # sin movimiento -> nunca toca objetivo
    hasta = D0 + timedelta(days=94)
    salida = detectar_salida(serie, D0, 100, hasta)
    assert salida is not None
    assert salida[2] == "tiempo"
    assert (salida[0] - D0).days >= 90


def test_sin_cuatro_cierres_no_hay_salida_todavia():
    serie = [Cierre(D0, 100), Cierre(D0 + timedelta(days=1), 200)]
    assert detectar_salida(serie, D0, 100, D0 + timedelta(days=1)) is None


# ---- un hueco que sale libera el sitio para la siguiente alerta -------------------------------

def test_un_hueco_que_sale_se_libera_y_lo_ocupa_la_siguiente_alerta():
    # AAA entra el D0 y sube +12% al día 4 (dispara el objetivo flojo de +11%).
    aaa = [Cierre(D0, 100), Cierre(D0 + timedelta(days=1), 100),
          Cierre(D0 + timedelta(days=2), 101), Cierre(D0 + timedelta(days=3), 102),
          Cierre(D0 + timedelta(days=4), 112)]
    bbb = _serie_plana(D0 + timedelta(days=5), 10, 50)  # BBB llega justo después de la salida
    cierres = {"AAA": aaa, "BBB": bbb}
    alertas = [Alerta("AAA", _t(D0), 10), Alerta("BBB", _t(D0 + timedelta(days=5)), 10)]
    hoy = D0 + timedelta(days=6)
    ops = simular((), alertas, cierres, D0, hoy)
    cerradas = [o for o in ops if not o.abierta]
    abiertas = [o for o in ops if o.abierta]
    assert cerradas and cerradas[0].numero == 1 and cerradas[0].motivo == "objetivo"
    # BBB entra en el MISMO hueco 1 (el primero libre), no en el 2.
    assert any(o.numero == 1 and o.ticker == "BBB" for o in abiertas)


# ---- capital compuesto -------------------------------------------------------------------------

def test_el_hueco_reinvierte_su_capital_no_vuelve_a_500():
    # Una operación cerrada con +10% seguida de otra abierta: el factor debe multiplicar, no sumar.
    cerrada = Operacion(1, "AAA", D0, 100, D0 + timedelta(days=10), 110, "objetivo")
    abierta = Operacion(1, "BBB", D0 + timedelta(days=11), 50)
    cierres = {"AAA": [Cierre(D0, 100), Cierre(D0 + timedelta(days=10), 110)],
              "BBB": [Cierre(D0 + timedelta(days=11), 50),
                     Cierre(D0 + timedelta(days=14), 55)]}  # BBB +10% también
    dia = D0 + timedelta(days=14)
    valor = valor_hueco(1, [cerrada, abierta], cierres, dia)
    # 1.10 (AAA) * 1.10 (BBB) = 1.21, no 1.10 + 0.10.
    assert abs(valor - Decimal("1.21")) < Decimal("0.001")


# ---- rentabilidad del mes / jornada -------------------------------------------------------------

def test_hueco_vacio_todo_el_periodo_cuenta_como_caja_0():
    ops: list[Operacion] = []
    r = rentabilidad_mes(ops, {}, D0, D0 + timedelta(days=30))
    assert r == Decimal("0.0000")


def test_rentabilidad_del_mes_con_los_cuatro_huecos():
    ops = [
        Operacion(1, "AAA", D0, 100),
        Operacion(2, "BBB", D0, 50),
        Operacion(3, "CCC", D0, 20),
    ]
    dia_fin = D0 + timedelta(days=29)
    cierres = {
        "AAA": [Cierre(D0, 100), Cierre(dia_fin, 110)],   # +10%
        "BBB": [Cierre(D0, 50), Cierre(dia_fin, 45)],      # -10%
        "CCC": [Cierre(D0, 20), Cierre(dia_fin, 20.2, dividendo=0.0)],  # +1%
    }
    r = rentabilidad_mes(ops, cierres, D0, dia_fin)
    # (1.10 + 0.90 + 1.01 + 1) / 4 - 1 = 0.0025 -> 0.25%.
    assert r == Decimal("0.2500")


def test_falta_el_cierre_de_entrada_es_un_error():
    ops = [Operacion(1, "AAA", D0 + timedelta(days=4), 100)]
    with pytest.raises(ValueError):
        rentabilidad_mes(ops, {"AAA": [Cierre(D0, 100)]}, D0, D0 + timedelta(days=10))


# ---- carry-over entre jornadas -------------------------------------------------------------------

def test_una_posicion_abierta_pasa_a_la_jornada_siguiente():
    """Lo que `simular()` deja abierto en una jornada es el `carry_over` de la siguiente."""
    cierres = {"AAA": _serie_plana(D0, 20, 100)}
    ops_jornada1 = simular((), [Alerta("AAA", _t(D0), 10)], cierres, D0, D0 + timedelta(days=19))
    abiertas = [o for o in ops_jornada1 if o.abierta]
    assert len(abiertas) == 1 and abiertas[0].ticker == "AAA"

    dia2_inicio = D0 + timedelta(days=20)
    cierres2 = {"AAA": _serie_plana(dia2_inicio, 10, 100)}
    ops_jornada2 = simular(abiertas, [], cierres2, dia2_inicio, dia2_inicio + timedelta(days=9))
    # Sigue en el mismo hueco, con la MISMA fecha/precio de entrada original (no se reabre).
    assert any(o.numero == 1 and o.ticker == "AAA" and o.entrada_dia == D0
              for o in ops_jornada2)


def test_reconstruir_dos_veces_con_los_mismos_datos_da_el_mismo_resultado():
    alertas = [Alerta("AAA", _t(D0), 10), Alerta("BBB", _t(D0 + timedelta(days=2)), 5)]
    cierres = {"AAA": _serie_plana(D0, 15, 100), "BBB": _serie_plana(D0, 15, 50)}
    hoy = D0 + timedelta(days=9)
    ops1 = simular((), alertas, cierres, D0, hoy)
    ops2 = simular((), alertas, cierres, D0, hoy)
    assert ops1 == ops2
