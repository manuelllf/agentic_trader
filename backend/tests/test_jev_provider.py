"""Tests del JevProvider (TypeSafe AI) -- sin red, mismo patrón que test_qwen_provider.py:
se simula `httpx.Client` y se llama a `_account`/`_trazar` a mano."""

from __future__ import annotations

import httpx
import pytest

from app.llm import jev as jev_mod
from app.llm.jev import JevProvider
from app.llm.trace import LLMTrace, ticker_ctx


def _respuesta(score: float = 6.5, confidence: float = 0.7,
              input_tokens: int = 2000, output_tokens: int = 30) -> dict:
    return {
        "model": "jev-1.13.0",
        "answers": {"investment_score": {
            "type": "score", "score": score, "confidence": confidence,
            "probabilities": {}, "legend": {},
        }},
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }


class _Resp:
    def __init__(self, code: int, body: dict) -> None:
        self.status_code, self._body = code, body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error", request=httpx.Request("POST", "http://x"),
                response=httpx.Response(self.status_code))

    def json(self) -> dict:
        return self._body


class _Cliente:
    def __init__(self, respuesta: dict, **_kw) -> None:
        self._respuesta = respuesta
        self.vistos: list[dict] = []

    def __enter__(self):  # noqa: ANN204
        return self

    def __exit__(self, *_a) -> bool:
        return False

    def post(self, _url, headers=None, json=None):  # noqa: ANN001, ANN201, A002
        self.vistos.append(json)
        return _Resp(200, self._respuesta)


def _parchear(monkeypatch, respuesta: dict) -> _Cliente:  # noqa: ANN001
    cliente = _Cliente(respuesta)
    monkeypatch.setattr(jev_mod.httpx, "Client", lambda **kw: cliente)  # noqa: ARG005
    return cliente


def test_chat_convierte_nivel_0_9_a_escala_1_100_con_decimales(monkeypatch) -> None:  # noqa: ANN001
    """1 + nivel/9*99, redondeado a 2 decimales -- nunca entero, y nunca 0 (ver
    `_score_100`: sc<=0 en `prescore_one` significa "sin nota", no "peor nota real")."""
    _parchear(monkeypatch, _respuesta(score=6.5))
    p = JevProvider(api_key="fake", stage="prescore")

    assert p.chat("sys", "user") == '{"score": 72.5}'


def test_chat_nunca_devuelve_score_0_ni_con_el_nivel_mas_bajo(monkeypatch) -> None:  # noqa: ANN001
    """Nivel 0 (el peor de la rúbrica) es una respuesta real y válida, no un fallo -- si
    tradujera a 0.0, `prescore_one` la descartaría como "JSON válido sin score utilizable"."""
    _parchear(monkeypatch, _respuesta(score=0.0))
    p = JevProvider(api_key="fake", stage="prescore")

    assert p.chat("sys", "user") == '{"score": 1.0}'


def test_chat_manda_el_user_como_state_y_la_rubrica_fija(monkeypatch) -> None:  # noqa: ANN001
    cliente = _parchear(monkeypatch, _respuesta())
    p = JevProvider(api_key="fake", stage="prescore")

    p.chat("sys (ignorado)", "AVGO fundamentals...")

    payload = cliente.vistos[0]
    assert payload["state"] == "AVGO fundamentals..."
    assert payload["questions"]["investment_score"]["criteria"] == jev_mod._NIVELES
    assert payload["model"] == "jev-latest"


def test_chat_logprobs_devuelve_la_confianza_nativa_de_jev(monkeypatch) -> None:  # noqa: ANN001
    """A diferencia de DeepSeek/Qwen (logprob del token menos seguro como proxy), Jev ya trae
    una confianza calibrada de serie -- es el dato real que motivó evaluarlo."""
    _parchear(monkeypatch, _respuesta(score=4.0, confidence=0.42))
    p = JevProvider(api_key="fake", stage="prescore")

    raw, confidence = p.chat_logprobs("sys", "user")

    assert raw == '{"score": 45.0}'
    assert confidence == pytest.approx(0.42)


def test_account_cobra_solo_la_entrada_salida_es_gratis(monkeypatch) -> None:  # noqa: ANN001
    p = JevProvider(api_key="fake", model="jev-latest")
    cost = p._account({"input_tokens": 1_000_000, "output_tokens": 500_000})

    assert cost == pytest.approx(0.042)   # $0.042/1M entrada, salida gratis
    assert p.usage["prompt_tokens"] == 1_000_000
    assert p.usage["completion_tokens"] == 500_000
    assert p.usage["cache_hit_tokens"] == 0   # Jev no expone caché


def test_trazar_guarda_confianza_y_coste(monkeypatch) -> None:  # noqa: ANN001
    traza = LLMTrace()
    _parchear(monkeypatch, _respuesta(score=6.16, confidence=0.71))
    p = JevProvider(api_key="fake", stage="prescore", recorder=traza)

    with ticker_ctx("NVDA"):
        p.chat("sys", "user")

    assert len(traza) == 1
    c = traza._calls[0]
    assert (c.stage, c.ticker) == ("prescore", "NVDA")
    assert c.confidence == pytest.approx(0.71)
    assert c.reasoning is None and c.reasoning_effort == "none"
    assert c.ok and c.error is None
    assert c.prompt_cache_hit_tokens == 0


def test_error_de_red_se_traza_y_relanza(monkeypatch) -> None:  # noqa: ANN001
    traza = LLMTrace()

    class _ClienteRoto:
        def __init__(self, **_kw) -> None:
            pass

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *_a) -> bool:
            return False

        def post(self, *_a, **_kw):  # noqa: ANN002, ANN003, ANN201
            raise httpx.ConnectError("caído")

    monkeypatch.setattr(jev_mod.httpx, "Client", _ClienteRoto)
    p = JevProvider(api_key="fake", stage="prescore", recorder=traza)

    with pytest.raises(httpx.ConnectError):
        p.chat("sys", "user")

    assert len(traza) == 1
    assert traza._calls[0].ok is False
    assert "ConnectError" in traza._calls[0].error
