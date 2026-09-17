"""`scorer.prescore_one`: la nota con decimales se conserva tal cual (no se redondea a entero),
y una nota baja-pero-real no se confunde con un fallo de parseo -- verificado end-to-end con un
LLM falso, no solo dentro de JevProvider (que es quien produce estas notas con decimales)."""

from __future__ import annotations

from app.agents import scorer as scorer_mod
from app.screener.fundamentals import NameData


class _LLMFalso:
    def __init__(self, raw: str) -> None:
        self._raw = raw

    def chat(self, system: str, user: str, *, temperature: float = 1.0,
            top_p: float | None = 0.95) -> str:
        return self._raw


def _data(ticker: str = "AVGO") -> NameData:
    return NameData(ticker=ticker, sector="Technology", industry="Semiconductors",
                    price=100.0, fundamentals_text="- P/E: 20", technical_text="price $100")


def test_prescore_one_conserva_decimales() -> None:
    """72.5, no round(72.5) -> 72 ni 73 -- la precisión existe para deshacer empates."""
    llm = _LLMFalso('{"score": 72.5}')

    r = scorer_mod.prescore_one(llm, _data(), macro_block="n/d")

    assert r.score == 72.5
    assert r.error is None


def test_prescore_one_nota_baja_pero_real_no_es_fallo() -> None:
    """1.0 (el mínimo que devuelve JevProvider, ver `_score_100`) es una nota real, no un
    "sin nota utilizable" -- distinto de 0, que sí es la marca de fallo de parseo."""
    llm = _LLMFalso('{"score": 1.0}')

    r = scorer_mod.prescore_one(llm, _data(), macro_block="n/d")

    assert r.score == 1.0
    assert r.error is None


def test_prescore_one_score_0_sigue_siendo_fallo_de_parseo() -> None:
    """Comportamiento preexistente intacto: 0 (o el campo ausente, mismo default) se sigue
    tratando como "el JSON no traía nota utilizable" -- DeepSeek/Qwen nunca devuelven 0 (su
    propio prompt pide "1 to 100"), así que esto solo protege contra una respuesta rota."""
    llm = _LLMFalso('{"score": 0}')

    r = scorer_mod.prescore_one(llm, _data(), macro_block="n/d")

    assert r.score == 0.0
    assert r.error is not None
