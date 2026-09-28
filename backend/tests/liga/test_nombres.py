"""Normalización de nombres libres (`app.liga.nombres`, plan §14): NFKC + homoglifos, sin BD."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.liga.nombres import choca_con_reservado, validar_nombre


@pytest.mark.parametrize("texto", [
    "alpha", "Alpha", "ALPHA", " alpha ", "Оmega",       # cirílica О (U+041E)
    "Λambda",                                            # griega Λ
    "a1pha", "@lpha", "4dmin", "1ambda", "l i g a",
])
def test_choca_con_reservado_detecta_homoglifos_y_variantes(texto: str) -> None:
    assert choca_con_reservado(texto)


@pytest.mark.parametrize("texto", [
    "Mi estrategia", "Contra corriente", "Los del bar", "Tiburones del Ibex", "AlphaTech Fund",
])
def test_choca_con_reservado_deja_pasar_lo_normal(texto: str) -> None:
    assert not choca_con_reservado(texto)


def test_validar_nombre_rechaza_reservado_con_422() -> None:
    with pytest.raises(HTTPException) as exc:
        validar_nombre("Аlpha")  # noqa: RUF001 — cirílica a propósito
    assert exc.value.status_code == 422


def test_validar_nombre_nfkc_normaliza_lo_que_deja_pasar() -> None:
    # U+FB01 (ligadura "fi") se descompone a "fi" con NFKC.
    assert validar_nombre("ﬁesta") == "fiesta"
