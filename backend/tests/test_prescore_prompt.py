"""`scorer._prescore_prompt`: sin mediana de sector (a diferencia de capa media/profundo) y con
el titular completo, no solo el título -- ver docs/backlog.md para el porqué de cada uno."""

from __future__ import annotations

from app.agents import scorer as scorer_mod
from app.screener.fundamentals import NameData


def _data() -> NameData:
    return NameData(
        ticker="META", sector="Communication Services", industry="Internet Content & Information",
        price=680.0, fundamentals_text="- P/E (forward): 19.52", technical_text="price $680",
        news=["Meta beats Q3 estimates — revenue up 28% year over year"],
    )


def test_prescore_prompt_no_lleva_mediana_de_sector() -> None:
    prompt = scorer_mod._prescore_prompt(_data(), macro_block="n/d")

    assert "sector median" not in prompt
    assert "- P/E (forward): 19.52" in prompt


def test_prescore_prompt_manda_el_titular_con_resumen() -> None:
    prompt = scorer_mod._prescore_prompt(_data(), macro_block="n/d")

    assert "Meta beats Q3 estimates — revenue up 28% year over year" in prompt


def test_prescore_batch_prompt_tampoco_recorta_el_resumen() -> None:
    prompt = scorer_mod._prescore_batch_prompt([_data()], macro_block="n/d")

    assert "Meta beats Q3 estimates — revenue up 28% year over year" in prompt
