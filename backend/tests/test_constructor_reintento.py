"""Constructor retry: transient LLM failures don't cost the monthly decision.

Fake LLM, no network."""

from __future__ import annotations

from app.agents.constructor import construct

BUENA = ('{"positions": [{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", '
         '"risk": "r"}, {"ticker": "BBB", "weight_pct": 40, "thesis": "t2", "edge": "e2", '
         '"risk": "r2"}], "omitted": [{"ticker": "CCC", "reason": "menor convicción"}], '
         '"summary": "resumen"}')
VALIDOS = {"AAA", "BBB", "CCC"}


class LLMGuion:
    """Script LLM: returns responses in order and counts calls."""

    def __init__(self, *respuestas: str) -> None:
        self.respuestas = list(respuestas)
        self.llamadas = 0

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        r = self.respuestas[min(self.llamadas, len(self.respuestas) - 1)]
        self.llamadas += 1
        return r


def _construye(llm):
    return construct(llm, "candidatos", "VIX 15.0.", 5, 35.0, VALIDOS, 1)


def test_una_respuesta_vacia_no_cuesta_la_cartera() -> None:
    """Empty content in first call triggers retry."""
    llm = LLMGuion("", BUENA)
    r = _construye(llm)
    assert llm.llamadas == 2
    assert [p.ticker for p in r.positions] == ["AAA", "BBB"]
    # 60+40 with cap 35 clamp to 35+35=70, leaving 30% cash. Full invest rounding happens in service.
    assert [p.weight_pct for p in r.positions] == [35.0, 35.0]
    assert r.cash_pct == 30.0
    assert r.summary == "resumen"
    assert [o.ticker for o in r.omitted] == ["CCC"]


def test_tambien_reintenta_si_el_json_es_valido_pero_no_deja_posiciones() -> None:
    """Valid JSON with no usable positions is as fatal as parsing failure."""
    llm = LLMGuion('{"positions": [{"ticker": "ZZZZ", "weight_pct": 50}], "summary": "s"}', BUENA)
    r = _construye(llm)
    assert llm.llamadas == 2
    assert [p.ticker for p in r.positions] == ["AAA", "BBB"]


def test_no_reintenta_cuando_la_primera_va_bien() -> None:
    """No retry on success; constructor is the month's most expensive call."""
    llm = LLMGuion(BUENA)
    r = _construye(llm)
    assert llm.llamadas == 1
    assert len(r.positions) == 2


def test_tres_fallos_seguidos_dejan_todo_en_caja_sin_petar() -> None:
    """Three failures: surrender with 100% cash; better than scan crash."""
    llm = LLMGuion("", "no soy json", "")
    r = _construye(llm)
    assert llm.llamadas == 3
    assert r.positions == [] and r.cash_pct == 100.0
    assert "Sin propuesta" in r.summary


def test_un_llm_que_revienta_tampoco_tumba_el_escaneo() -> None:
    class LLMRoto:
        def __init__(self) -> None:
            self.llamadas = 0

        def chat(self, system: str, user: str, *, temperature: float = 0.3,
                top_p: float | None = None) -> str:
            self.llamadas += 1
            raise RuntimeError("502 Bad Gateway")

    llm = LLMRoto()
    r = _construye(llm)
    assert llm.llamadas == 3
    assert r.positions == [] and r.cash_pct == 100.0
