"""Tests para neutralidad de prompts (anti-sesgo en scorer, prescore con noticias/nombre).

Sin red, sin LLM real."""

from __future__ import annotations

from app.agents.scorer import (
    SYSTEM,
)
from app.screener import macro as macro_mod
from app.screener.fundamentals import NameData


def _name_data(**kwargs) -> NameData:
    base = dict(
        ticker="AAA", sector="Technology", industry="Software", price=10.0,
        fundamentals_text="- EPS: 1.0", technical_text="price $10",
    )
    base.update(kwargs)
    return NameData(**base)








def test_clausula_nueva_del_profundo_sin_palabras_direccionales() -> None:
    """Misma regla que test_macro_memory.py: cero palabras que empujen la tesis en una dirección."""
    bajo = SYSTEM.lower()
    for palabra in ("confirm", "maintain", "consistent", "revise", "prefer", "avoid"):
        assert palabra not in bajo


_MACRO = {
    "regime": "risk-on", "vix": 14.9, "datos": "VIX 14.9. Gold 4,341 (+5% 1m).",
    "wiki_scheduled_text": "Nov 3 - US elections.", "wiki_events_text": "Fed raises rates.",
    "macro_headlines": {"gnews": ["G1"], "gdelt": ["D1"]},
}


def test_bloque_solo_datos_no_lleva_eventos_ni_regimen() -> None:
    """B: los números y nada más. El régimen es conclusión nuestra, no dato."""
    bloque = macro_mod.bloque_macro(_MACRO, con_contexto=False)
    assert bloque == "VIX 14.9. Gold 4,341 (+5% 1m)."
    for etiqueta in ("risk-on", "risk-off", "neutral", "Regime"):
        assert etiqueta not in bloque


def test_bloque_con_contexto_lleva_calendario_eventos_y_titulares_en_crudo() -> None:
    bloque = macro_mod.bloque_macro(_MACRO)
    assert bloque.startswith("VIX 14.9.")
    assert "Scheduled events (calendar):\nNov 3 - US elections." in bloque
    assert "Recent events (last 7 days):\nFed raises rates." in bloque
    assert "Recent market headlines:\n- D1\n- G1" in bloque
    assert "risk-on" not in bloque


def test_el_macro_ya_no_llama_a_ningun_llm() -> None:
    """Sin previsión escrita por un modelo: encadenaba narrativa hacia sectores enteros."""
    assert not hasattr(macro_mod, "get_macro_outlook")
    assert not hasattr(macro_mod, "_SYSTEM")


def test_el_snapshot_no_manda_retornos_por_sector() -> None:
    """Snapshot excludes sector rankings; blocks last channel for sectoral bias."""
    import inspect

    # Sin comentarios: el porqué del cambio SÍ nombra los ETFs al explicarlo.
    codigo = "\n".join(linea for linea in inspect.getsource(macro_mod).splitlines()
                       if not linea.strip().startswith("#"))
    for etf in ("XLK", "XLF", "XLV", "XLE"):
        assert etf not in codigo
    assert not hasattr(macro_mod, "_SECTOR_ETFS")






def test_el_profundo_ya_no_pide_precio_objetivo() -> None:
    """target_price sin respaldo en el paper — quitado del todo (28-ago)."""
    assert "PRICE TARGET" not in SYSTEM
    assert "target_price" not in SYSTEM
    assert "analyst" not in SYSTEM.lower()














def test_el_scorer_no_llama_provided_a_los_datos() -> None:
    """Paper Exhibit 1: use 'recent/latest', not 'provided'."""
    assert "do not describe the data as 'provided'" in SYSTEM.lower()
    assert "recent or latest" in SYSTEM.lower()




def test_los_datos_macro_usan_subyacentes_sin_petroleo_ni_momentum() -> None:
    """Futuros, no ETFs proxy (errores de roll). Sin petróleo (ligado a un sector entero) ni
    MA200/distancia al máximo, que viajan en cada prompt y premian lo que ya subió."""
    import ast
    import inspect
    import textwrap

    # Sin la docstring, por sus líneas en el árbol: `__doc__` ya no coincide con el texto fuente
    # desde Python 3.13 (se recorta la sangría al compilar).
    fuente = textwrap.dedent(inspect.getsource(macro_mod._datos_mercado))
    doc = ast.parse(fuente).body[0].body[0]
    lineas = fuente.splitlines()
    codigo = "\n".join(linea for linea in lineas[:doc.lineno - 1] + lineas[doc.end_lineno:]
                       if not linea.strip().startswith("#"))
    for subyacente in ("GC=F", "DX-Y.NYB", "^TNX", "^IRX"):
        assert subyacente in codigo
    for fuera in ('"GLD"', '"USO"', '"UUP"', "CL=F", "MA200", "52w", "sma("):
        assert fuera not in codigo
    # HYG se queda (no hay índice de crédito gratis) pero SIN nivel y etiquetado como ETF.
    assert "HYG ETF" in codigo




