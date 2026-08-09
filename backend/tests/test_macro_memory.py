"""Restos del lote de cambios de prompts del 3-ago: el test del "cash_pct fuera del prompt del
constructor" vive aquí y no en test_ranker para que el commit que lo lleva sea autocontenido.

La memoria macro (outlook anterior inyectado como "qué cambió desde entonces") se quitó del
todo el 10-ago por fidelidad al paper — igual que la tesis previa por nombre en el scorer
(ver `scan_service.py`). Sus tests vivían aquí; se retiraron con la propia función.
"""

from __future__ import annotations

import json


def test_constructor_prompt_no_pide_cash_pct() -> None:
    """El diseño es 100% invertido (sin caja) y el código ya normaliza cash_pct a 0; pedírselo
    al modelo en el JSON de respuesta era una señal contradictoria. El parseo sigue tolerando
    que el modelo lo mande igualmente (guarda existente), pero el TEXTO del prompt ya no lo pide.
    """
    from app.agents import constructor as constructor_mod

    captured: dict[str, str] = {}

    class _Capturing:
        def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
            captured["system"] = system
            captured["user"] = user
            return json.dumps({"positions": [
                {"ticker": "AAA", "weight_pct": 100, "thesis": "t", "edge": "e", "risk": "r"}],
                "summary": "s"})

    constructor_mod.construct(_Capturing(), "cartera", "candidatos", "macro",
                              max_positions=1, max_position_pct=100.0, valid_tickers={"AAA"})
    assert "cash_pct" not in captured["system"]
    assert "cash_pct" not in captured["user"]
