"""Tests de la traza de llamadas al LLM (`app/llm/trace.py` + contabilidad de DeepSeek).

Sin red: se llama a `_account()`/`_trazar()` a mano con respuestas simuladas, igual que en
`test_llm_coste.py`.
"""

from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from app.llm import deepseek as deepseek_mod
from app.llm.deepseek import DeepSeekProvider
from app.llm.trace import LLMTrace, NotaLogprob, current_ticker, ticker_ctx

_LOGPROBS = {"content": [
    {"token": "71", "logprob": -0.02,
     "top_logprobs": [{"token": "71", "logprob": -0.02}, {"token": "54", "logprob": -3.9}]},
    {"token": ".38", "logprob": -1.2,
     "top_logprobs": [{"token": ".38", "logprob": -1.2}, {"token": ".00", "logprob": -1.4}]},
]}


def _respuesta(content: str = '{"score": 71.38}', reasoning: str | None = None,
               logprobs: dict | None = None) -> dict:
    msg = {"content": content}
    if reasoning is not None:
        msg["reasoning_content"] = reasoning
    choice = {"message": msg}
    if logprobs is not None:
        choice["logprobs"] = logprobs
    return {"choices": [choice]}


def test_account_desglosa_cache_hit_y_miss() -> None:
    p = DeepSeekProvider(api_key="fake", model="deepseek-v4-flash")
    hit, miss, ct, cost = p._account({
        "prompt_tokens": 1000, "completion_tokens": 200,
        "prompt_cache_hit_tokens": 900, "prompt_cache_miss_tokens": 100,
    })

    assert (hit, miss, ct) == (900, 100, 200)
    usage = p.usage
    assert usage["cache_hit_tokens"] == 900
    assert usage["cache_miss_tokens"] == 100
    assert usage["cost_usd"] == cost
    # El tramo miss cuesta 30x el de hit: si el desglose se colapsara en un solo número, el coste
    # de 100 tokens caros y 900 baratos sería indistinguible del de 1000 medios.
    assert usage["by_model"]["deepseek-v4-flash"]["cache_hit_tokens"] == 900


def test_trazar_guarda_razonamiento_y_ticker_del_contexto() -> None:
    traza = LLMTrace()
    p = DeepSeekProvider(api_key="fake", model="deepseek-v4-pro",
                         reasoning_effort="high", stage="deep", recorder=traza)
    data = _respuesta('{"score": 84.61}', reasoning="Primero miro los márgenes…",
                      logprobs=_LOGPROBS)
    with ticker_ctx("AVGO"):
        p._trazar(time.monotonic(), data, uso=(10, 20, 30, 0.5))

    assert len(traza) == 1
    c = traza._calls[0]
    assert (c.stage, c.ticker, c.reasoning_effort) == ("deep", "AVGO", "high")
    assert c.reasoning == "Primero miro los márgenes…"
    assert c.content == '{"score": 84.61}'
    assert (c.prompt_cache_hit_tokens, c.prompt_cache_miss_tokens) == (10, 20)
    assert c.ok and c.error is None
    # "deep" no está en _ETAPAS_CON_ALTERNATIVAS: sin filas relacionales, solo el mínimo.
    assert c.notas == []
    assert c.confidence == pytest.approx(math.exp(-1.2))


def test_notas_logprob_solo_para_prescore_y_mid() -> None:
    """En prescore/mid, las fichas NUMÉRICAS de la nota se extraen como filas hermanas — nunca
    como el bloque JSON entero (ver `app.models.LLMCallLogprob`)."""
    traza = LLMTrace()
    p = DeepSeekProvider(api_key="fake", model="deepseek-v4-flash",
                         stage="prescore", recorder=traza)
    data = _respuesta('{"score": 71.38}', logprobs=_LOGPROBS)
    p._trazar(time.monotonic(), data)

    # El proveedor repite el elegido dentro de `top_logprobs` (se ve también en producción):
    # se guarda tal cual llega, sin deduplicar — cada fila es una observación real aparte.
    notas = traza._calls[0].notas
    assert notas == [
        NotaLogprob(parte=0, elegido=True, token="71", logprob=-0.02),
        NotaLogprob(parte=0, elegido=False, token="71", logprob=-0.02),
        NotaLogprob(parte=0, elegido=False, token="54", logprob=-3.9),
        NotaLogprob(parte=1, elegido=True, token=".38", logprob=-1.2),
        NotaLogprob(parte=1, elegido=False, token=".38", logprob=-1.2),
        NotaLogprob(parte=1, elegido=False, token=".00", logprob=-1.4),
    ]


def test_trazar_registra_tambien_la_llamada_fallida() -> None:
    traza = LLMTrace()
    p = DeepSeekProvider(api_key="fake", model="deepseek-v4-flash",
                         stage="prescore", recorder=traza)
    p._trazar(time.monotonic(), None, error="ReadTimeout: sin respuesta")

    c = traza._calls[0]
    assert not c.ok
    assert c.error == "ReadTimeout: sin respuesta"
    assert c.reasoning is None and c.cost_usd == 0.0


def test_sin_reasoning_effort_no_hay_razonamiento_que_guardar() -> None:
    """`reasoning_effort="none"` no genera razonamiento: NULL aquí no es pérdida de señal."""
    traza = LLMTrace()
    p = DeepSeekProvider(api_key="fake", model="deepseek-v4-flash",
                         reasoning_effort="none", stage="prescore", recorder=traza)
    p._trazar(time.monotonic(), _respuesta())

    assert traza._calls[0].reasoning is None


def test_logprobs_se_apagan_solos_si_el_modelo_los_rechaza(monkeypatch) -> None:  # noqa: ANN001
    """No está confirmado que DeepSeek admita logprobs con el razonamiento activo. Si los
    rechaza, la telemetría se apaga sola y la llamada sigue: nunca al revés."""
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

    monkeypatch.setattr(deepseek_mod.httpx, "Client", _Cliente)
    p = DeepSeekProvider(api_key="x", model="deepseek-v4-pro",
                         reasoning_effort="high", stage="deep")

    assert p.chat("sys", "user") == '{"score": 71.38}'
    assert len(vistos) == 2
    assert "logprobs" in vistos[0] and "logprobs" not in vistos[1]
    assert p._logprobs_soportado is False


def test_top_logprobs_solo_donde_la_salida_es_un_numero() -> None:
    """Prescore y capa media emiten solo una nota: ahí la distribución ES la duda. El profundo
    escribe prosa y las alternativas de cada palabra no dicen nada de la decisión."""
    def payload(stage: str) -> dict:
        p = DeepSeekProvider(api_key="x", model="deepseek-v4-flash", stage=stage)
        return p._payload("sys", "user", 1.0, 0.95)

    assert payload("prescore")["top_logprobs"] == deepseek_mod._TOP_LOGPROBS
    assert payload("mid")["top_logprobs"] == deepseek_mod._TOP_LOGPROBS
    assert "top_logprobs" not in payload("deep")
    assert payload("deep")["logprobs"] is True      # el token elegido sí, en todas


def test_el_ticker_del_contexto_no_se_cruza_entre_hilos() -> None:
    """El prescore corre 500 hilos a la vez; si el contexto se filtrara, la traza mentiría."""
    def uno(ticker: str) -> str | None:
        with ticker_ctx(ticker):
            time.sleep(0.01)          # fuerza el solape real entre hilos
            return current_ticker()

    tickers = [f"T{i}" for i in range(20)]
    with ThreadPoolExecutor(max_workers=20) as ex:
        assert list(ex.map(uno, tickers)) == tickers
    assert current_ticker() is None
