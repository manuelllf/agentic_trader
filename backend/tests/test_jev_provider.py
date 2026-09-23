"""Tests del JevProvider (TypeSafe AI) -- sin red, mismo patrón que test_qwen_provider.py:
se simula `httpx.Client` y se llama a `_account`/`_trazar` a mano."""

from __future__ import annotations

import json

import httpx
import pytest

from app.llm import jev as jev_mod
from app.llm.jev import JevProvider
from app.llm.trace import LLMTrace, ticker_ctx


def _respuesta(score: float = 6.5, confidence: float = 0.7,
              input_tokens: int = 2000, output_tokens: int = 30,
              niveles: dict | None = None) -> dict:
    """Las 4 preguntas con el mismo nivel, salvo las que se pasen en `niveles`."""
    niveles = niveles or {}
    return {
        "model": "jev-1.13.0",
        "answers": {q: {"type": "score", "score": niveles.get(q, score), "confidence": confidence,
                        "probabilities": {}, "legend": {}}
                    for q in jev_mod.PREGUNTAS.values()},
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
    _parchear(monkeypatch, _respuesta(score=6.5))
    p = JevProvider(api_key="fake", stage="prescore")

    assert json.loads(p.chat("sys", "user"))["score"] == 72.5


def test_chat_nunca_devuelve_score_0_ni_con_el_nivel_mas_bajo(monkeypatch) -> None:  # noqa: ANN001
    """Nivel 0 es una respuesta válida: si saliera 0.0, `prescore_one` la leería como fallo."""
    _parchear(monkeypatch, _respuesta(score=0.0))
    p = JevProvider(api_key="fake", stage="prescore")

    assert json.loads(p.chat("sys", "user"))["score"] == 1.0


def test_chat_manda_el_user_como_state_y_las_4_preguntas(monkeypatch) -> None:  # noqa: ANN001
    cliente = _parchear(monkeypatch, _respuesta())
    p = JevProvider(api_key="fake", stage="prescore")

    p.chat("sys (ignorado)", "AVGO fundamentals...")

    payload = cliente.vistos[0]
    assert payload["state"] == "AVGO fundamentals..."
    assert set(payload["questions"]) == set(jev_mod.PREGUNTAS.values())
    assert payload["model"] == "jev-latest"


def test_nota_es_la_media_ponderada_de_las_4_con_sus_dimensiones(monkeypatch) -> None:  # noqa: ANN001
    _parchear(monkeypatch, _respuesta(niveles={"fundamentals_score": 9.0, "valuation_score": 3.0,
                                               "financing_risk_score": 6.0,
                                               "catalyst_score": 0.0}))
    p = JevProvider(api_key="fake", stage="prescore")

    obj = json.loads(p.chat("sys", "user"))

    assert obj["score"] == 50.5           # media 4.5 -> 1 + 4.5/9*99
    assert obj["dimensiones"]["valuation"] == [3.0, 0.7]


def test_pregunta_ausente_es_fallo_no_nota_parcial(monkeypatch) -> None:  # noqa: ANN001
    respuesta = _respuesta()
    del respuesta["answers"]["catalyst_score"]
    _parchear(monkeypatch, respuesta)
    traza = LLMTrace()
    p = JevProvider(api_key="fake", stage="prescore", recorder=traza)

    with pytest.raises(KeyError):
        p.chat("sys", "user")
    assert traza._calls[0].ok is False
    # Jev la cobró igual: el coste cuenta y queda en la traza.
    assert p.usage["calls"] == 1
    assert traza._calls[0].cost_usd == pytest.approx(2000 * 0.042 / 1_000_000)
    assert traza._calls[0].prompt_cache_miss_tokens == 2000


def test_respuesta_sin_answers_es_fallo(monkeypatch) -> None:  # noqa: ANN001
    _parchear(monkeypatch, {"usage": {"input_tokens": 10, "output_tokens": 0}})
    p = JevProvider(api_key="fake", stage="prescore")

    with pytest.raises(KeyError):
        p.chat("sys", "user")


def test_http_500_no_cobra(monkeypatch) -> None:  # noqa: ANN001
    cliente = _parchear(monkeypatch, _respuesta())
    monkeypatch.setattr(cliente, "post", lambda *_a, **_kw: _Resp(500, {}))
    traza = LLMTrace()
    p = JevProvider(api_key="fake", stage="prescore", recorder=traza)

    with pytest.raises(httpx.HTTPStatusError):
        p.chat("sys", "user")
    assert p.usage["calls"] == 0
    assert traza._calls[0].ok is False and traza._calls[0].cost_usd == 0.0


def test_chat_logprobs_devuelve_la_confianza_media_de_las_4(monkeypatch) -> None:  # noqa: ANN001
    respuesta = _respuesta(score=4.0, confidence=0.4)
    respuesta["answers"]["valuation_score"]["confidence"] = 0.8
    _parchear(monkeypatch, respuesta)
    p = JevProvider(api_key="fake", stage="prescore")

    raw, confidence = p.chat_logprobs("sys", "user")

    assert json.loads(raw)["score"] == 45.0
    assert confidence == pytest.approx(0.5)


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
    assert c.content == "68.76"
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
