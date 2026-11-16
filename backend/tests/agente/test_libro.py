"""Libro de papel del agente contra la base real de pruebas."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import libro
from app.agente.libro import Accion, PrecioApertura
from app.agente.models import Decision, MovimientoCaja
from app.config import settings

NY = ZoneInfo("America/New_York")
D1, D2, D3 = date(2026, 11, 17), date(2026, 11, 18), date(2026, 11, 19)


@pytest.fixture(autouse=True)
def _comision_fija(monkeypatch):
    monkeypatch.setattr(settings, "commission_per_share", 0.005)
    monkeypatch.setattr(settings, "commission_min", 1)
    monkeypatch.setattr(settings, "commission_max_pct", 1)


def _ahora(dia: date) -> datetime:
    return datetime(dia.year, dia.month, dia.day, 9, 30, tzinfo=NY)


def _px(ticker: str, precio: str, previo: str | None = None) -> PrecioApertura:
    p = Decimal(precio)
    return PrecioApertura(ticker, Decimal(previo) if previo else p, p)


def _decision(s: Session) -> int:
    d = Decision(fecha_ny=D1, tipo="operar", propuesta={}, razonamiento="r", modelo="m")
    s.add(d)
    s.flush()
    return d.id


def _libro(s: Session) -> int:
    libro.abrir_libro(s, D1)
    return _decision(s)


def _cierre(s: Session, ticker: str, dia: date, cierre: str) -> None:
    libro.guardar_precios(s, ticker, [(dia, None, None, None, Decimal(cierre), None)])


def _comprar(s: Session, dec: int, ticker: str, dia: date, precio: str, *,
             acciones: str | None = None, importe: str | None = None, parada: bool = False):
    libro.crear_orden(s, dec, ticker, "compra", dia,
                      acciones=Decimal(acciones) if acciones else None,
                      importe=Decimal(importe) if importe else None)
    return libro.ejecutar_pendientes(s, dia, {ticker: _px(ticker, precio)}, _ahora(dia), parada)


def test_abrir_dos_veces_un_solo_movimiento(sesion_agente: Session) -> None:
    s = sesion_agente
    assert libro.abrir_libro(s, D1) is True
    assert libro.abrir_libro(s, D2) is False
    n = s.execute(text("select count(*) from agente.movimientos_caja where tipo = 'inicial'"))
    assert n.scalar_one() == 1
    assert libro.caja(s) == Decimal("5000")


def test_compra_por_importe_a_la_apertura(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    res = _comprar(s, dec, "AAA", D1, "50", importe="1000")
    assert [e for _, e in res] == ["ejecutada"]
    assert libro.estado_posiciones(s) == {"AAA": (Decimal("19"), Decimal("951") / 19)}
    assert libro.caja(s) == Decimal("5000") - Decimal("950") - Decimal("1")


def test_hueco_de_apertura_rechaza(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    libro.crear_orden(s, dec, "AAA", "compra", D1, importe=Decimal("1000"))
    res = libro.ejecutar_pendientes(s, D1, {"AAA": _px("AAA", "104", "100")}, _ahora(D1), False)
    assert [e for _, e in res] == ["rechazada_apertura"]
    assert libro.estado_posiciones(s) == {}
    assert libro.caja(s) == Decimal("5000")


def test_sexta_posicion_rechazada_por_limites(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    tickers = ["A1", "A2", "A3", "A4", "A5", "A6"]
    for t in tickers:
        libro.crear_orden(s, dec, t, "compra", D1, importe=Decimal("500"))
    precios = {t: _px(t, "10") for t in tickers}
    res = libro.ejecutar_pendientes(s, D1, precios, _ahora(D1), False)
    assert [e for _, e in res] == ["ejecutada"] * 5 + ["rechazada_limites"]
    ultima = s.execute(text("select motivo from agente.ordenes where id = :i"),
                       {"i": res[-1][0]}).scalar_one()
    assert "max_posiciones" in ultima
    assert len(libro.estado_posiciones(s)) == 5


def test_venta_parcial_y_total(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    assert libro.estado_posiciones(s)["AAA"] == (Decimal("10"), Decimal("100.1"))

    libro.crear_orden(s, dec, "AAA", "venta", D2, acciones=Decimal("4"))
    res = libro.ejecutar_pendientes(s, D2, {"AAA": _px("AAA", "110")}, _ahora(D2), False)
    assert [e for _, e in res] == ["ejecutada"]
    assert libro.estado_posiciones(s)["AAA"] == (Decimal("6"), Decimal("100.1"))
    assert libro.caja(s) == Decimal("5000") - 1001 + 440 - 1

    # Pide más de lo que hay: vende solo lo que queda y la posición se cierra.
    libro.crear_orden(s, dec, "AAA", "venta", D3, acciones=Decimal("50"))
    res = libro.ejecutar_pendientes(s, D3, {"AAA": _px("AAA", "120")}, _ahora(D3), False)
    assert [e for _, e in res] == ["ejecutada"]
    assert libro.estado_posiciones(s) == {}

    d4 = date(2026, 11, 20)
    _comprar(s, dec, "AAA", d4, "120", acciones="5")
    assert libro.estado_posiciones(s)["AAA"] == (Decimal("5"), Decimal("601") / 5)


def test_venta_sin_posicion_rechazada(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    libro.crear_orden(s, dec, "AAA", "venta", D1, acciones=Decimal("3"))
    res = libro.ejecutar_pendientes(s, D1, {"AAA": _px("AAA", "10")}, _ahora(D1), False)
    assert [e for _, e in res] == ["rechazada_limites"]


def test_la_venta_libera_caja_para_comprar_el_mismo_dia(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    for t in ("A", "B", "C"):
        _comprar(s, dec, t, D1, "10", importe="1450")
        _cierre(s, t, D1, "10")
    assert libro.caja(s) == Decimal("5000") - 3 * Decimal("1441")
    # La compra tiene id menor que la venta: solo la compra tras la venta alcanza el importe.
    ob = libro.crear_orden(s, dec, "D", "compra", D2, importe=Decimal("1400"))
    libro.crear_orden(s, dec, "A", "venta", D2, acciones=Decimal("144"))
    precios = {"A": _px("A", "10"), "D": _px("D", "10")}
    res = libro.ejecutar_pendientes(s, D2, precios, _ahora(D2), False)
    assert [e for _, e in res][-1] == "ejecutada" and ob.id == res[-1][0]
    assert libro.estado_posiciones(s)["D"][0] == Decimal("139")
    assert "A" not in libro.estado_posiciones(s)


def test_parada_rechaza_todo(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    libro.crear_orden(s, dec, "AAA", "venta", D2, acciones=Decimal("5"))
    libro.crear_orden(s, dec, "BBB", "compra", D2, importe=Decimal("500"))
    precios = {"AAA": _px("AAA", "100"), "BBB": _px("BBB", "10")}
    res = libro.ejecutar_pendientes(s, D2, precios, _ahora(D2), True)
    assert [e for _, e in res] == ["rechazada_limites", "rechazada_limites"]
    motivos = s.execute(text("select motivo from agente.ordenes "
                             "where estado = 'rechazada_limites'"))
    assert all("parada" in m for m in motivos.scalars())
    assert libro.estado_posiciones(s)["AAA"][0] == Decimal("10")


def test_idempotencia(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    libro.crear_orden(s, dec, "AAA", "compra", D1, importe=Decimal("1000"))
    again = libro.crear_orden(s, dec, "AAA", "compra", D1, importe=Decimal("1000"))
    precios = {"AAA": _px("AAA", "50")}
    assert len(libro.ejecutar_pendientes(s, D1, precios, _ahora(D1), False)) == 1
    assert libro.ejecutar_pendientes(s, D1, precios, _ahora(D1), False) == []
    n = s.execute(text("select count(*) from agente.ejecutadas")).scalar_one()
    assert n == 1
    assert s.execute(text("select count(*) from agente.ordenes")).scalar_one() == 1
    assert again.estado == "ejecutada"


def test_orden_sin_precio_queda_pendiente(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    o = libro.crear_orden(s, dec, "AAA", "compra", D1, importe=Decimal("1000"))
    assert libro.ejecutar_pendientes(s, D1, {}, _ahora(D1), False) == []
    assert o.estado == "pendiente"
    assert libro.estado_posiciones(s) == {}


def test_split_duplica_acciones_y_divide_coste(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    assert libro.registrar_acciones(s, [Accion("AAA", D2, Decimal("0"), Decimal("2"))]) == 1
    assert libro.registrar_acciones(s, [Accion("AAA", D2, Decimal("0"), Decimal("2"))]) == 0
    assert libro.estado_posiciones(s)["AAA"] == (Decimal("20"), Decimal("50.05"))
    assert libro.estado_posiciones(s, D1)["AAA"] == (Decimal("10"), Decimal("100.1"))
    # Un ticker que nunca se tuvo no guarda splits.
    assert libro.registrar_acciones(s, [Accion("ZZZ", D2, Decimal("0"), Decimal("3"))]) == 0


def test_dividendo_solo_con_acciones_el_dia_anterior(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    caja0 = libro.caja(s)
    # Ex el mismo día de la compra: el día anterior no había acciones.
    assert libro.registrar_acciones(s, [Accion("AAA", D1, Decimal("0.5"), Decimal("0"))]) == 0
    assert libro.caja(s) == caja0
    assert libro.registrar_acciones(s, [Accion("AAA", D2, Decimal("0.5"), Decimal("0"))]) == 1
    assert libro.registrar_acciones(s, [Accion("AAA", D2, Decimal("0.5"), Decimal("0"))]) == 0
    assert libro.caja(s) == caja0 + Decimal("5")
    tipo = s.query(MovimientoCaja).filter_by(tipo="dividendo").count()
    assert tipo == 1


def test_cartera_sin_precio_falla(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    with pytest.raises(ValueError, match="AAA"):
        libro.cartera(s, D1)


def test_valor_diario_y_valor_maximo(sesion_agente: Session) -> None:
    s = sesion_agente
    dec = _libro(s)
    _comprar(s, dec, "AAA", D1, "100", acciones="10")
    _cierre(s, "AAA", D1, "105")
    sin_filas = libro.cartera(s, D1)
    assert sin_filas.valor_maximo == sin_filas.valor_total == Decimal("3999") + Decimal("1050")

    libro.guardar_valor_diario(s, D1)
    libro.guardar_valor_diario(s, D1)
    fila = s.execute(text("select caja, valor_posiciones from agente.valor_diario")).one()
    assert (fila.caja, fila.valor_posiciones) == (Decimal("3999"), Decimal("1050"))

    _cierre(s, "AAA", D2, "90")
    c = libro.cartera(s, D2)
    assert c.valor_total == Decimal("3999") + Decimal("900")
    assert c.valor_maximo == Decimal("5049")
    assert c.posiciones[0].precio == Decimal("90")
    libro.guardar_valor_diario(s, D2)
    assert s.execute(text("select count(*) from agente.valor_diario")).scalar_one() == 2
