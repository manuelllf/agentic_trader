"""Tests del lote de cambios de prompts (5-ago): clausula anti-sesgo también en el scorer
profundo, prescore con todos los titulares + nombre de empresa, y outlook macro sin tilt
sectorial en el texto que se inyecta en cada scoring. Sin red, sin LLM real.
"""

from __future__ import annotations

from app.agents.scorer import PRESCORE_SYSTEM, SYSTEM, _prescore_prompt
from app.screener import macro as macro_mod
from app.screener.fundamentals import NameData


def _name_data(**kwargs) -> NameData:
    base = dict(
        ticker="AAA", sector="Technology", industry="Software", price=10.0,
        fundamentals_text="- EPS: 1.0", technical_text="price $10",
    )
    base.update(kwargs)
    return NameData(**base)


def test_system_y_prescore_cubren_los_tres_ejes() -> None:
    """Ambos prompts (profundo y prescore) deben cubrir sector, tamaño y movimiento de precio."""
    for texto in (SYSTEM, PRESCORE_SYSTEM):
        bajo = texto.lower()
        assert "sector" in bajo
        assert "size" in bajo
        assert "price move" in bajo


def test_clausula_nueva_del_profundo_sin_palabras_direccionales() -> None:
    """Misma regla que test_macro_memory.py: cero palabras que empujen la tesis en una dirección."""
    bajo = SYSTEM.lower()
    for palabra in ("confirm", "maintain", "consistent", "revise", "prefer", "avoid"):
        assert palabra not in bajo


def test_outlook_prompt_block_sin_tailwind_headwind_con_outlook() -> None:
    macro = {
        "regime": "neutral", "vix": 15.0, "outlook": "Texto del outlook.",
        "favored_sectors": ["Technology"], "avoided_sectors": ["Energy"],
    }
    bloque = macro_mod.outlook_prompt_block(macro)
    assert "tailwind" not in bloque.lower()
    assert "headwind" not in bloque.lower()
    assert "Texto del outlook." in bloque


def test_prescore_prompt_incluye_todos_los_titulares_y_el_nombre() -> None:
    titulares = [f"Titular {i}" for i in range(5)]
    data = _name_data(name="Acme Corp", news=titulares)
    prompt = _prescore_prompt(data, "Regime: neutral (VIX 15.0).")
    assert "Acme Corp" in prompt
    for titular in titulares:
        assert titular in prompt
