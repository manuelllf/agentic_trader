"""`scorer._prescore_prompt`: titular completo, no solo el título -- ver docs/backlog.md para
el porqué."""

from __future__ import annotations

from app.agents import scorer as scorer_mod
from app.screener.fundamentals import NameData


def _data() -> NameData:
    return NameData(
        ticker="META", sector="Communication Services", industry="Internet Content & Information",
        price=680.0, fundamentals_text="- P/E (forward): 19.52", technical_text="price $680",
        news=["Meta beats Q3 estimates — revenue up 28% year over year"],
    )


def test_prescore_prompt_manda_el_titular_con_resumen() -> None:
    prompt = scorer_mod._prescore_prompt(_data(), macro_block="n/d")

    assert "Meta beats Q3 estimates — revenue up 28% year over year" in prompt


def test_prescore_batch_prompt_tampoco_recorta_el_resumen() -> None:
    prompt = scorer_mod._prescore_batch_prompt([_data()], macro_block="n/d")

    assert "Meta beats Q3 estimates — revenue up 28% year over year" in prompt
