"""El constructor reintenta una vez. Sin red, sin LLM real.

Motivo (8-ago): en el retest, OpenRouter devolvió `content` vacío en la ÚNICA llamada del
constructor. El JSON no parseó y la función devolvió 100% caja con "Sin propuesta". Al relanzarla
con exactamente los mismos datos acertó a la primera → el fallo era de transporte, no del prompt.
Aquí una llamada mala no cuesta un nombre como en el scorer: cuesta la decisión del mes entera.
"""

from __future__ import annotations

from app.agents.constructor import construct

BUENA = ('{"positions": [{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", '
         '"risk": "r"}, {"ticker": "BBB", "weight_pct": 40, "thesis": "t2", "edge": "e2", '
         '"risk": "r2"}], "omitted": [{"ticker": "CCC", "reason": "menor convicción"}], '
         '"summary": "resumen"}')
VALIDOS = {"AAA", "BBB", "CCC"}


class LLMGuion:
    """Devuelve las respuestas del guion en orden y cuenta las llamadas."""

    def __init__(self, *respuestas: str) -> None:
        self.respuestas = list(respuestas)
        self.llamadas = 0

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        r = self.respuestas[min(self.llamadas, len(self.respuestas) - 1)]
        self.llamadas += 1
        return r


def _construye(llm):
    return construct(llm, "cartera", "candidatos", "VIX 15.0.", 5, 35.0, VALIDOS, 1)


def test_una_respuesta_vacia_no_cuesta_la_cartera() -> None:
    """El caso exacto del 8-ago: `content` vacío en la primera llamada."""
    llm = LLMGuion("", BUENA)
    r = _construye(llm)
    assert llm.llamadas == 2
    assert [p.ticker for p in r.positions] == ["AAA", "BBB"]
    # 60 y 40 con tope de 35 → clampan a 35 y 35, así que quedan 30 de caja. El relleno hasta el
    # 100% no es cosa de esta función: lo hace `_finalize_full_invest` en el servicio, que conoce
    # el orden de selección. Aquí lo que importa es que el tope por posición se respeta.
    assert [p.weight_pct for p in r.positions] == [35.0, 35.0]
    assert r.cash_pct == 30.0
    assert r.summary == "resumen"
    assert [o.ticker for o in r.omitted] == ["CCC"]


def test_tambien_reintenta_si_el_json_es_valido_pero_no_deja_posiciones() -> None:
    """JSON perfecto y ni una posición utilizable (tickers alucinados) es tan fatal para el
    escaneo como no parsear: `construct` solo se llama cuando HAY candidatos."""
    llm = LLMGuion('{"positions": [{"ticker": "ZZZZ", "weight_pct": 50}], "summary": "s"}', BUENA)
    r = _construye(llm)
    assert llm.llamadas == 2
    assert [p.ticker for p in r.positions] == ["AAA", "BBB"]


def test_no_reintenta_cuando_la_primera_va_bien() -> None:
    """Un reintento que se dispara siempre duplicaría el coste de la llamada más cara del mes."""
    llm = LLMGuion(BUENA)
    r = _construye(llm)
    assert llm.llamadas == 1
    assert len(r.positions) == 2


def test_tres_fallos_seguidos_dejan_todo_en_caja_sin_petar() -> None:
    """Se rinde al tercero (subido de 2 a 3 el 8-ago): mejor 100% caja declarada que una
    excepción que tumbe el escaneo."""
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
