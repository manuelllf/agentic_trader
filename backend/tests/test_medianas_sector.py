"""`medianas_pe_por_sector`: qué cuenta como sector y qué no.

Un P/E comparado contra la "mediana del sector desconocido" es peor que no compararlo: el
prompt lo pega igual y el modelo no puede saber que ese número no significa nada."""

from __future__ import annotations

import pytest

from app.screener.fundamentals import NameData, es_sector, medianas_pe_por_sector


def _n(ticker: str, sector: str | None, pe: float) -> NameData:
    return NameData(ticker=ticker, sector=sector or "", industry="x", price=10.0,
                    fundamentals_text="", technical_text="", pe_trailing=pe, pe_forward=pe)


@pytest.mark.parametrize("valor", ["", "  ", "n/d", "N/D", "none", "null", None])
def test_ausencias_disfrazadas_no_son_sector(valor) -> None:  # noqa: ANN001
    assert es_sector(valor) is False


@pytest.mark.parametrize("valor", ["Technology", "Financial Services", "Real Estate"])
def test_sectores_de_verdad(valor: str) -> None:
    assert es_sector(valor) is True


def test_no_agrupa_los_sin_sector(_min: int = 6) -> None:
    """8 nombres con sector "n/d" pasarían el mínimo de muestra y formarían su propia mediana."""
    datos = [_n(f"X{i}", "n/d", 10.0 + i) for i in range(8)]
    assert medianas_pe_por_sector(datos) == {}


def test_calcula_la_mediana_de_un_sector_real() -> None:
    datos = [_n(f"T{i}", "Technology", float(pe)) for i, pe in enumerate([10, 20, 30, 40, 50, 60])]
    out = medianas_pe_por_sector(datos)
    assert out["Technology"]["trailing"] == 35.0


def test_los_sin_sector_no_contaminan_al_sector_real() -> None:
    """El bucket vacío no debe arrastrar sus P/E al sector de al lado."""
    reales = [_n(f"T{i}", "Technology", float(pe)) for i, pe in enumerate([30, 32, 34, 36, 38, 40])]
    huerfanos = [_n(f"X{i}", "", 1.0) for i in range(6)]
    out = medianas_pe_por_sector(reales + huerfanos)
    assert set(out) == {"Technology"}
    assert out["Technology"]["trailing"] == 35.0
