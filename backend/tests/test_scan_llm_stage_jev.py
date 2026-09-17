"""Enrutado de Jev en `_prescore_llm` -- SOLO el prescore puede pedirlo, nunca `_llm_for`
(compartido por macro/mid/profundo/constructor), porque Jev no genera texto."""

from __future__ import annotations

from app import scan_llm_stage as stage_mod
from app.llm.jev import JevProvider
from app.llm.qwen import QwenProvider


def _cfg(model: str) -> dict:
    return {"model": model, "reasoning_effort": "none", "temperature": 0.3, "top_p": 0.95}


def test_prescore_llm_enruta_a_jev_si_el_modal_lo_pide(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "fake-key")
    monkeypatch.setattr(stage_mod.settings, "jev_model", "jev-latest")

    llm = stage_mod._prescore_llm(_cfg("jev-latest"), tiene_override=True)

    assert isinstance(llm, JevProvider)


def test_prescore_llm_no_usa_jev_sin_key_configurada(monkeypatch) -> None:  # noqa: ANN001
    """Sin TYPESAFE_API_KEY, cae al camino normal (DeepSeek) en vez de reventar -- mismo
    criterio que Qwen en `_llm_for` (comprueba `dashscope_api_key` antes de enrutar)."""
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "")
    monkeypatch.setattr(stage_mod.settings, "jev_model", "jev-latest")
    monkeypatch.setattr(stage_mod.settings, "prescore_provider", "deepseek")
    monkeypatch.setattr(stage_mod.settings, "deepseek_api_key", "fake")

    llm = stage_mod._prescore_llm(_cfg("jev-latest"), tiene_override=True)

    assert not isinstance(llm, JevProvider)


def test_jev_nunca_se_enruta_desde_llm_for(monkeypatch) -> None:  # noqa: ANN001
    """`_llm_for` es el camino de macro/mid/profundo/constructor -- Jev no debe aparecer aquí
    aunque alguien mande su nombre de modelo, porque esas etapas necesitan texto libre."""
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "fake-key")
    monkeypatch.setattr(stage_mod.settings, "jev_model", "jev-latest")
    monkeypatch.setattr(stage_mod.settings, "deepseek_api_key", "fake")

    llm = stage_mod._llm_for(_cfg("jev-latest"), "deep")

    assert not isinstance(llm, JevProvider)


# ---- Default de producción (17-sep-2026): Jev, con cascada de seguridad si falta la key -------

def test_default_de_produccion_usa_jev_si_hay_key(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(stage_mod.settings, "prescore_provider", "jev")
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "fake-key")
    monkeypatch.setattr(stage_mod.settings, "jev_model", "jev-latest")

    llm = stage_mod._prescore_llm(_cfg("deepseek-v4-flash"), tiene_override=False)

    assert isinstance(llm, JevProvider)


def test_default_cae_a_qwen_si_falta_la_key_de_jev(monkeypatch) -> None:  # noqa: ANN001
    """Hueco real: `prescore_provider="jev"` ya desplegado pero `TYPESAFE_API_KEY` todavía sin
    poner en algún entorno (p. ej. Railway) -- cae a Qwen, NUNCA directo a DeepSeek (el más caro
    de los tres) en silencio."""
    monkeypatch.setattr(stage_mod.settings, "prescore_provider", "jev")
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "")
    monkeypatch.setattr(stage_mod.settings, "dashscope_api_key", "fake-key")
    monkeypatch.setattr(stage_mod.settings, "qwen_model", "qwen3.7-flash")

    llm = stage_mod._prescore_llm(_cfg("deepseek-v4-flash"), tiene_override=False)

    assert isinstance(llm, QwenProvider)


def test_default_cae_a_deepseek_si_no_hay_ninguna_key(monkeypatch) -> None:  # noqa: ANN001
    """Sin ninguna de las dos keys, la última red es la de siempre (`_llm_for` -> DeepSeek)."""
    monkeypatch.setattr(stage_mod.settings, "prescore_provider", "jev")
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "")
    monkeypatch.setattr(stage_mod.settings, "dashscope_api_key", "")

    llm = stage_mod._prescore_llm(_cfg("deepseek-v4-flash"), tiene_override=False)

    assert not isinstance(llm, (JevProvider, QwenProvider))


def test_override_del_modal_gana_aunque_el_default_sea_otro(monkeypatch) -> None:  # noqa: ANN001
    """Si el modal pide Jev explícito, no importa si `tiene_override` ya lo cubre por el
    default -- pero si el default es Qwen y el modal pide Jev, Jev tiene que ganar."""
    monkeypatch.setattr(stage_mod.settings, "prescore_provider", "qwen")
    monkeypatch.setattr(stage_mod.settings, "typesafe_api_key", "fake-key")
    monkeypatch.setattr(stage_mod.settings, "jev_model", "jev-latest")

    llm = stage_mod._prescore_llm(_cfg("jev-latest"), tiene_override=True)

    assert isinstance(llm, JevProvider)
