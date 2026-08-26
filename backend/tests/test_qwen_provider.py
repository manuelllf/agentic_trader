"""Tests del QwenProvider (DashScope directo) -- sin red, mismo patrón que `test_llm_trace.py`
para DeepSeek: se simula `httpx.Client` y se llama a `_account`/`_trazar`/`_payload` a mano.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest

from app.llm import qwen as qwen_mod
from app.llm.qwen import QwenProvider
from app.llm.trace import LLMTrace, ticker_ctx

_LOGPROBS = {"content": [
    {"token": "71", "logprob": -0.02,
     "top_logprobs": [{"token": "71", "logprob": -0.02}, {"token": "54", "logprob": -3.9}]},
    {"token": ".38", "logprob": -1.2,
     "top_logprobs": [{"token": ".38", "logprob": -1.2}, {"token": ".00", "logprob": -1.4}]},
]}


def _respuesta(content: str = '{"score": 71.38}', logprobs: dict | None = None) -> dict:
    choice = {"message": {"content": content}}
    if logprobs is not None:
        choice["logprobs"] = logprobs
    return {"choices": [choice]}


def test_payload_apaga_siempre_el_razonamiento() -> None:
    """`enable_thinking: false` va SIEMPRE, sin parámetro para desactivarlo -- ver docstring del
    módulo (medido en vivo: dejarlo sin apagar dispara el coste ~33x)."""
    p = QwenProvider(api_key="fake", stage="prescore")
    payload = p._payload("sys", "user", 0.3, 0.95)

    assert payload["enable_thinking"] is False
    assert payload["temperature"] == 0.3
    assert payload["top_p"] == 0.95
    assert payload["top_logprobs"] == qwen_mod._TOP_LOGPROBS


def test_top_logprobs_solo_donde_la_salida_es_un_numero() -> None:
    payload_deep = QwenProvider(api_key="x", stage="deep")._payload("s", "u", 0.3, None)
    payload_mid = QwenProvider(api_key="x", stage="mid")._payload("s", "u", 0.3, None)

    assert "top_logprobs" not in payload_deep
    assert payload_mid["top_logprobs"] == qwen_mod._TOP_LOGPROBS


def test_account_estima_coste_por_tarifa_fija_sin_precio_de_cache() -> None:
    """DashScope no factura coste real ni distingue precio de caché (ver docstring): todo el
    prompt se tarifa igual, `cached_tokens` solo se conserva como dato informativo."""
    p = QwenProvider(api_key="fake", model="qwen3.7-flash")
    hit, miss, ct, cost = p._account({
        "prompt_tokens": 1000, "completion_tokens": 100,
        "prompt_tokens_details": {"cached_tokens": 200},
    })

    assert (hit, miss, ct) == (200, 800, 100)
    pin, pout = qwen_mod._PRICING["qwen3.7-flash"]
    assert cost == pytest.approx((1000 * pin + 100 * pout) / 1_000_000)
    assert p.usage["cost_usd"] == pytest.approx(cost)


def test_trazar_sin_razonamiento_ni_coste_facturado() -> None:
    """`enable_thinking=False` siempre: nunca hay razonamiento que guardar, a diferencia de
    DeepSeek (que sí puede traerlo con `reasoning_effort` alto)."""
    traza = LLMTrace()
    p = QwenProvider(api_key="fake", stage="prescore", recorder=traza)
    data = _respuesta(logprobs=_LOGPROBS)
    with ticker_ctx("AVGO"):
        p._trazar(time.monotonic(), data, uso=(10, 20, 5, 0.001))

    assert len(traza) == 1
    c = traza._calls[0]
    assert (c.stage, c.ticker) == ("prescore", "AVGO")
    assert c.reasoning is None and c.reasoning_effort is None
    assert c.content == '{"score": 71.38}'
    assert (c.prompt_cache_hit_tokens, c.prompt_cache_miss_tokens) == (10, 20)
    assert c.ok and c.error is None
    assert c.confidence == pytest.approx(__import__("math").exp(-1.2))
    # prescore está en _ETAPAS_CON_ALTERNATIVAS: las fichas numéricas se extraen igual que en
    # DeepSeek (mismo `_notas_logprob`, reutilizado sin reescribir).
    assert len(c.notas) == 6


def test_chat_logprobs_devuelve_contenido_y_confianza(monkeypatch) -> None:  # noqa: ANN001
    class _Resp:
        def __init__(self, body: dict) -> None:
            self.status_code, self.content = 200, json.dumps(body).encode()

        def raise_for_status(self) -> None:
            pass

    class _Cliente:
        def __init__(self, **_kw) -> None:
            pass

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *_a) -> bool:
            return False

        def post(self, _url, headers=None, json=None):  # noqa: ANN001, ANN201, A002
            assert json["enable_thinking"] is False
            usage = {"prompt_tokens": 50, "completion_tokens": 4,
                     "prompt_tokens_details": {"cached_tokens": 0}}
            return _Resp({**_respuesta(logprobs=_LOGPROBS), "usage": usage})

    monkeypatch.setattr(qwen_mod.httpx, "Client", _Cliente)
    p = QwenProvider(api_key="x", stage="prescore")

    content, confidence = p.chat_logprobs("sys", "user", temperature=0.3, top_p=0.95)

    assert content == '{"score": 71.38}'
    assert confidence == pytest.approx(__import__("math").exp(-1.2))
    assert p.usage["cost_usd"] > 0


def test_logprobs_se_apagan_solos_si_el_modelo_los_rechaza(monkeypatch) -> None:  # noqa: ANN001
    """Mismo guardarraíl que DeepSeek: un 400 con `logprobs` puesto se reintenta sin él, la
    llamada de producción no puede tumbarse por telemetría."""
    vistos: list[dict] = []

    class _Resp:
        def __init__(self, code: int, body: dict) -> None:
            self.status_code, self.content = code, json.dumps(body).encode()

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "400", request=httpx.Request("POST", "http://x"),
                    response=httpx.Response(self.status_code))

    class _Cliente:
        def __init__(self, **_kw) -> None:
            pass

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *_a) -> bool:
            return False

        def post(self, _url, headers=None, json=None):  # noqa: ANN001, ANN201, A002
            vistos.append(json)
            if "logprobs" in json:
                return _Resp(400, {"error": "logprobs no soportado"})
            return _Resp(200, {"choices": [{"message": {"content": '{"score": 71.38}'}}],
                               "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    monkeypatch.setattr(qwen_mod.httpx, "Client", _Cliente)
    p = QwenProvider(api_key="x", stage="prescore")

    assert p.chat("sys", "user") == '{"score": 71.38}'
    assert len(vistos) == 2
    assert "logprobs" in vistos[0] and "logprobs" not in vistos[1]
    assert p._logprobs_soportado is False
