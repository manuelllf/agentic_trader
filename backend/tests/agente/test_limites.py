"""Pruebas de la capa inmutable de límites del agente (código puro, sin base ni red)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.agente.limites import (
    Cartera,
    Modo,
    Posicion,
    PropuestaCompra,
    PropuestaVenta,
    alertas_de_cartera,
    apertura_permite_compra,
    comprobar_compra,
    comprobar_venta,
    modo,
    puede_gastar_ia,
)
from app.config import settings
from app.ledger.money import D

HOY = date(2026, 11, 16)


@pytest.fixture(autouse=True)
def _comision_fija(monkeypatch):
    monkeypatch.setattr(settings, "commission_per_share", 0.005)
    monkeypatch.setattr(settings, "commission_min", 1)
    monkeypatch.setattr(settings, "commission_max_pct", 1)


def pos(ticker="AAA", acciones="10", coste="10", precio="10"):
    return Posicion(ticker, D(acciones), D(coste), D(precio))


def cartera(caja="1000", posiciones=(), maximo=None):
    c = Cartera(D(caja), tuple(posiciones), D("0"))
    return Cartera(D(caja), tuple(posiciones), D(maximo) if maximo is not None else c.valor_total)


def compra(ticker="NEW", importe="100", precio="10", salidas="stop", ruptura="rompe", evento=None):
    return PropuestaCompra(ticker, D(importe), D(precio), salidas, ruptura, evento)


def codigos(vs):
    return {v.codigo for v in vs}


# --- tipos ---------------------------------------------------------------

def test_posicion_valor_y_rentabilidad():
    p = pos(acciones="4", coste="10", precio="7")
    assert p.valor == D("28")
    assert p.rentabilidad == D("-0.3")


def test_cartera_valor_peso_y_caida():
    c = Cartera(D("500"), (pos("A", "10", "10", "10"),), D("1000"))
    assert c.valor_total == D("600")
    assert c.peso("A") == D("100") / D("600")
    assert c.peso("ZZZ") == D("0")
    assert c.caida_desde_maximo == D("-0.4")


def test_cartera_vacia_solo_caja():
    c = cartera("1000")
    assert c.valor_total == D("1000")
    assert c.peso("A") == D("0")
    assert c.caida_desde_maximo == D("0")
    assert modo(c, False) is Modo.NORMAL
    assert alertas_de_cartera(c) == []


def test_valor_maximo_cero_no_divide():
    c = Cartera(D("1000"), (), D("0"))
    assert c.caida_desde_maximo == D("0")
    assert modo(c, False) is Modo.NORMAL


def test_peso_con_total_cero():
    c = Cartera(D("0"), (pos("A", "0", "10", "10"),), D("100"))
    assert c.peso("A") == D("0")


# --- modo ----------------------------------------------------------------

@pytest.mark.parametrize("valor,esperado", [
    ("100", Modo.NORMAL),
    ("70.01", Modo.NORMAL),
    ("70", Modo.DEFENSIVO),      # justo -30 %
    ("50.01", Modo.DEFENSIVO),
    ("50", Modo.PAUSA),          # justo -50 %
    ("10", Modo.PAUSA),
])
def test_modo_por_caida(valor, esperado):
    assert modo(Cartera(D(valor), (), D("100")), False) is esperado


def test_parada_manda_sobre_todo():
    assert modo(Cartera(D("10"), (), D("100")), True) is Modo.PARADA


# --- compra --------------------------------------------------------------

def test_compra_valida_permitida():
    c = cartera("1000", [pos("A", "90", "10", "10")])  # total 1900
    assert comprobar_compra(compra(importe="100"), c, HOY, False) == []


def test_parada_y_pausa_bloquean_compra():
    c = cartera("1000")
    assert codigos(comprobar_compra(compra(), c, HOY, True)) == {"parada"}
    c2 = Cartera(D("1000"), (), D("5000"))
    assert "pausa" in codigos(comprobar_compra(compra(), c2, HOY, False))


def test_importe_y_precio_no_positivos():
    c = cartera("1000")
    assert "importe_no_positivo" in codigos(comprobar_compra(compra(importe="0"), c, HOY, False))
    assert "precio_no_positivo" in codigos(comprobar_compra(compra(precio="0"), c, HOY, False))
    assert "importe_no_positivo" in codigos(comprobar_compra(compra(importe="-5"), c, HOY, False))


@pytest.mark.parametrize("texto", ["", "   ", "\n\t"])
def test_sin_salidas_y_sin_ruptura(texto):
    c = cartera("1000", [pos("A", "90", "10", "10")])
    assert "sin_salidas" in codigos(comprobar_compra(compra(salidas=texto), c, HOY, False))
    assert "sin_ruptura" in codigos(comprobar_compra(compra(ruptura=texto), c, HOY, False))


@pytest.mark.parametrize("dias,bloquea", [(-1, False), (0, True), (7, True), (8, False)])
def test_evento_proximo_bordes(dias, bloquea):
    c = cartera("1000", [pos("A", "90", "10", "10")])
    p = compra(evento=HOY + timedelta(days=dias))
    assert ("evento_proximo" in codigos(comprobar_compra(p, c, HOY, False))) is bloquea


def test_max_posiciones_ticker_nuevo():
    ps = [pos(t, "10", "10", "10") for t in ("A", "B", "C", "D", "E")]
    c = cartera("1000", ps)
    assert "max_posiciones" in codigos(comprobar_compra(compra("NEW"), c, HOY, False))
    # ampliar una posición existente no abre una sexta
    assert "max_posiciones" not in codigos(comprobar_compra(compra("A"), c, HOY, False))


def test_importe_menor_que_una_accion_compra_una_fraccion():
    c = cartera("1000", [pos("A", "90", "10", "10")])
    assert codigos(comprobar_compra(compra(importe="5", precio="10"), c, HOY, False)) == set()


def test_importe_por_debajo_de_la_fraccion_minima():
    c = cartera("1000", [pos("A", "90", "10", "10")])
    assert "importe_demasiado_pequeno" in codigos(
        comprobar_compra(compra(importe="0.0001", precio="10"), c, HOY, False))


def test_acciones_por_importe_redondea_a_cuatro_decimales():
    from decimal import Decimal

    from app.agente.limites import acciones_por_importe
    assert acciones_por_importe(Decimal("300"), Decimal("517.99")) == Decimal("0.5791")
    assert acciones_por_importe(Decimal("0"), Decimal("10")) == Decimal("0")


def test_caja_insuficiente_simple():
    c = cartera("50", [pos("A", "90", "10", "10")])
    assert "caja_insuficiente" in codigos(comprobar_compra(compra(importe="100"), c, HOY, False))


def test_comision_cuenta_en_la_caja():
    # 100 acciones a 10, comisión 1: 1001 > 1000, pero 999 (99 acciones) cabe justo.
    c = cartera("1000", [pos("A", "900", "10", "10")])  # total 10000
    justo = comprobar_compra(compra(importe="1000"), c, HOY, False)
    assert "caja_insuficiente" in codigos(justo)
    cabe = comprobar_compra(compra(importe="999"), c, HOY, False)
    assert "caja_insuficiente" not in codigos(cabe)


def test_peso_justo_en_limite_permitido():
    c = cartera("10000")  # total 10000, 30 % = 3000
    assert comprobar_compra(compra(importe="3000", precio="1"), c, HOY, False) == []


def test_peso_ligeramente_sobre_el_limite():
    c = cartera("10000")
    vs = comprobar_compra(compra(importe="3001", precio="1"), c, HOY, False)
    assert codigos(vs) == {"peso_maximo"}


def test_peso_suma_la_posicion_existente():
    # A vale 2000 de 10000; comprar 1001 más lleva a 30,01 %
    c = cartera("8000", [pos("A", "200", "10", "10")])
    assert "peso_maximo" in codigos(comprobar_compra(compra("A", "1001", "1"), c, HOY, False))
    assert "peso_maximo" not in codigos(comprobar_compra(compra("A", "1000", "1"), c, HOY, False))


def test_peso_defensivo_mas_estricto():
    # total 7000 (caída -30 % sobre 10000): 15 % = 1050
    c = Cartera(D("7000"), (), D("10000"))
    assert modo(c, False) is Modo.DEFENSIVO
    assert comprobar_compra(compra(importe="1050", precio="1"), c, HOY, False) == []
    vs = comprobar_compra(compra(importe="1051", precio="1"), c, HOY, False)
    assert codigos(vs) == {"peso_maximo"}


def test_acumula_varias_violaciones():
    ps = [pos(t, "10", "10", "10") for t in ("A", "B", "C", "D", "E")]
    c = cartera("10", ps)
    p = compra("NEW", "500", "10", salidas=" ", ruptura="", evento=HOY)
    cs = codigos(comprobar_compra(p, c, HOY, False))
    assert {"sin_salidas", "sin_ruptura", "evento_proximo", "max_posiciones",
            "caja_insuficiente", "peso_maximo"} <= cs


# --- venta ---------------------------------------------------------------

def test_venta_valida():
    c = cartera("0", [pos("A", "10", "10", "10")])
    assert comprobar_venta(PropuestaVenta("A", D("10")), c, False) == []


def test_venta_permitida_en_defensivo():
    c = Cartera(D("0"), (pos("A", "10", "10", "7"),), D("100"))
    assert modo(c, False) is Modo.DEFENSIVO
    assert comprobar_venta(PropuestaVenta("A", D("5")), c, False) == []


def test_venta_bloqueada_por_parada_y_pausa():
    c = cartera("0", [pos("A", "10", "10", "10")])
    assert codigos(comprobar_venta(PropuestaVenta("A", D("1")), c, True)) == {"parada"}
    c2 = Cartera(D("0"), (pos("A", "10", "10", "4"),), D("100"))
    assert codigos(comprobar_venta(PropuestaVenta("A", D("1")), c2, False)) == {"pausa"}


def test_venta_errores():
    c = cartera("0", [pos("A", "10", "10", "10")])
    vs = comprobar_venta(PropuestaVenta("ZZZ", D("1")), c, False)
    assert codigos(vs) == {"no_en_cartera"}
    vs = comprobar_venta(PropuestaVenta("A", D("0")), c, False)
    assert "acciones_no_positivas" in codigos(vs)
    assert codigos(comprobar_venta(PropuestaVenta("A", D("10.5")), c, False)) == {
        "mas_acciones_que_las_que_hay"}
    # varias a la vez
    assert codigos(comprobar_venta(PropuestaVenta("ZZZ", D("-1")), c, False)) == {
        "no_en_cartera", "acciones_no_positivas"}


# --- apertura e IA -------------------------------------------------------

@pytest.mark.parametrize("cierre,apertura,esperado", [
    ("100", "103", True),      # justo +3 %
    ("100", "103.01", False),
    ("100", "90", True),
    ("0", "100", False),
    ("100", "0", False),
    ("-1", "-1", False),
])
def test_apertura_permite_compra(cierre, apertura, esperado):
    assert apertura_permite_compra(D(cierre), D(apertura)) is esperado


@pytest.mark.parametrize("gastado,estimado,esperado", [
    ("9", "1", True),          # justo 10
    ("9", "1.01", False),
    ("0", "0", True),
    ("10", "0", True),
])
def test_puede_gastar_ia(gastado, estimado, esperado):
    assert puede_gastar_ia(D(gastado), D(estimado)) is esperado


# --- alertas -------------------------------------------------------------

def test_alerta_caida_de_posicion_en_el_borde():
    c = cartera("1000", [pos("A", "1", "100", "70"), pos("B", "1", "100", "70.01")])
    al = [a for a in alertas_de_cartera(c) if a.codigo == "revision_caida_posicion"]
    assert [a.ticker for a in al] == ["A"]
    assert al[0].valor == D("-0.3")


def test_alerta_peso_en_el_borde():
    c = cartera("550", [pos("A", "45", "10", "10")])  # 450 de 1000 = 45 %
    al = [a for a in alertas_de_cartera(c) if a.codigo == "revision_peso"]
    assert [a.ticker for a in al] == ["A"]
    c2 = cartera("551", [pos("A", "45", "10", "10")])
    assert not [a for a in alertas_de_cartera(c2) if a.codigo == "revision_peso"]


def test_alerta_cartera_solo_la_mas_grave():
    defensiva = alertas_de_cartera(Cartera(D("70"), (), D("100")))
    assert [(a.codigo, a.ticker) for a in defensiva] == [("cartera_defensiva", None)]
    pausa = alertas_de_cartera(Cartera(D("50"), (), D("100")))
    assert [(a.codigo, a.ticker) for a in pausa] == [("cartera_pausa", None)]
    assert alertas_de_cartera(Cartera(D("71"), (), D("100"))) == []
