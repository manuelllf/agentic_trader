"""La pregunta propia y su peso van juntos: sin pregunta no hay peso, y con pregunta hay que darle
peso. La BD lo exige (`pregunta_con_peso`); aquí se comprueba que el usuario lo oye con palabras."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.liga import estrategias

PESOS = {"negocio": 25, "precio": 25, "deuda": 25, "pronto": 25, "pregunta": 0}


def _validar(pregunta: str | None, peso_pregunta: int):  # noqa: ANN202
    return estrategias.validar_entrada(
        None, [], [], pregunta, {**PESOS, "pregunta": peso_pregunta}, 5, "igual", 0)


def test_una_pregunta_sin_peso_se_explica_en_castellano() -> None:
    with pytest.raises(HTTPException) as e:
        _validar("¿Tiene ventaja competitiva?", 0)
    assert e.value.status_code == 422 and "peso" in e.value.detail


def test_un_peso_sin_pregunta_se_explica_en_castellano() -> None:
    with pytest.raises(HTTPException) as e:
        _validar(None, 20)
    assert e.value.status_code == 422 and "escrito" in e.value.detail


def test_la_pregunta_en_blanco_cuenta_como_sin_pregunta() -> None:
    with pytest.raises(HTTPException):
        _validar("   ", 20)


def test_coherentes_pasan() -> None:
    assert _validar(None, 0).pesos["pregunta"] == 0
    assert _validar("¿Tiene ventaja competitiva?", 20).pesos["pregunta"] == 20
