"""Moderación de nombres y textos públicos: solo la lista de bloqueo, sin IA."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.liga.ia import moderacion


def test_un_texto_de_la_lista_se_rechaza_con_422() -> None:
    with pytest.raises(HTTPException) as e:
        moderacion.evaluar_lista("Puto mercado")
    assert e.value.status_code == 422


def test_un_texto_normal_pasa() -> None:
    moderacion.evaluar_lista("Foso ancho")


def test_no_queda_moderacion_con_ia() -> None:
    assert not hasattr(moderacion, "evaluar_en_fondo")
    assert "moderacion" not in moderacion.__dict__.get("FINALIDADES", ())
