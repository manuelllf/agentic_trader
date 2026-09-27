"""Puntos de cada jornada (banda sobre la diferencia redondeada a una décima) y clasificación."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.liga.motor.puntos import (
    FilaClasificacion,
    clasificacion,
    diferencia_temporada,
    letra,
    resultado_jornada,
)

D = Decimal


@pytest.mark.parametrize(("rent", "sp", "dif", "puntos"), [
    ("1.0000", "0.4600", "0.5", 1),       # +0,54 → +0,5: empata
    ("1.0000", "0.4500", "0.6", 3),       # +0,55 → +0,6 (la mitad hacia arriba): gana
    ("1.0000", "0.5000", "0.5", 1),       # +0,5 justo: empata
    ("0.5000", "1.0000", "-0.5", 1),      # −0,5 justo: empata
    ("0.4600", "1.0000", "-0.5", 1),      # −0,54 → −0,5: empata
    ("0.4500", "1.0000", "-0.6", 0),      # −0,55 → −0,6 (la mitad hacia fuera): pierde
    ("3.2000", "-1.1000", "4.3", 3),
    ("-7.0000", "2.0000", "-9.0", 0),
    ("0.0000", "0.0000", "0.0", 1),
])
def test_banda_sobre_la_diferencia_redondeada(rent, sp, dif, puntos):
    r = resultado_jornada(D(rent), D(sp))
    assert r.dif == D(dif)
    assert r.puntos == puntos
    assert r.letra == letra(puntos)


def test_una_diferencia_minima_negativa_no_se_escribe_menos_cero():
    r = resultado_jornada(D("1.0000"), D("1.0400"))
    assert r.dif == 0 and not r.dif.is_signed()
    assert str(r.dif) == "0.0"


def test_las_rentabilidades_van_en_decimal():
    with pytest.raises(TypeError):
        resultado_jornada(1.0, D(0))  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        resultado_jornada(D(1), True)  # type: ignore[arg-type]
    assert resultado_jornada(2, 1).puntos == 3


def test_letras():
    assert [letra(p) for p in (3, 1, 0)] == ["G", "E", "P"]
    with pytest.raises(KeyError):
        letra(2)


def test_diferencia_de_la_temporada_es_compuesta():
    # (1,10 · 0,90 − 1,05 · 1,00) × 100 = −6
    assert diferencia_temporada([(D(10), D(5)), (D(-10), D(0))]) == D(-6)
    assert diferencia_temporada([]) == 0


def _fila(id_, puntos, rents, dia):
    return FilaClasificacion(id_, puntos, tuple((D(r), D(s)) for r, s in rents),
                             datetime(2027, 1, dia, 12, tzinfo=UTC))


def test_clasificacion_por_puntos_luego_diferencia_y_luego_fecha_de_alta():
    filas = [
        _fila("tarde_igual", 6, [("2", "1")], 20),
        _fila("menos_puntos", 4, [("50", "0")], 1),
        _fila("mas_puntos", 7, [("-5", "0")], 25),
        _fila("pronto_igual", 6, [("2", "1")], 5),
        _fila("mejor_dif", 6, [("3", "1")], 30),
    ]
    tabla = clasificacion(filas)
    assert [p.fila.id for p in tabla] == [
        "mas_puntos", "mejor_dif", "pronto_igual", "tarde_igual", "menos_puntos"]
    assert [p.puesto for p in tabla] == [1, 2, 3, 4, 5]
    assert tabla[0].dif_temporada == D("-5.0000")
    assert tabla[1].dif_temporada == D("2.0000")


def test_la_diferencia_desempata_compuesta_no_sumada():
    """Sumadas, las dos llevan +10; compuestas, la segunda va por delante."""
    a = _fila("a", 3, [("10", "0"), ("0", "0")], 1)
    b = _fila("b", 3, [("5", "0"), ("5", "0")], 2)
    assert diferencia_temporada(a.rentabilidades) == D(10)
    assert diferencia_temporada(b.rentabilidades) == D("10.25")
    assert [p.fila.id for p in clasificacion([a, b])] == ["b", "a"]


def test_el_alta_necesita_zona_horaria():
    with pytest.raises(ValueError):
        FilaClasificacion("x", 0, (), datetime(2027, 1, 1))
