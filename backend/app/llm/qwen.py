"""Cliente directo de QwenCloud/DashScope -- mismo contrato que `DeepSeekProvider`
(`chat_logprobs` duck-typed) y mismo esquema de logprobs, reutilizado tal cual.

`enable_thinking` es una elección explícita del caller (modal de simulación de Sala Real o
`settings` por defecto), NO un hardcode: con él activo el coste se dispara ~33x (medido en
vivo), así que el default sigue siendo `False` en todas partes salvo que alguien lo pida. Sin
coste facturado en `usage`: se estima por tarifa fija, igual que ya hace `DeepSeekProvider`.
"""

from __future__ import annotations

import copy
import json
import time
from datetime import UTC, datetime

import httpx

from app.llm.deepseek import _ETAPAS_CON_ALTERNATIVAS, _TOP_LOGPROBS, _min_prob, _notas_logprob
from app.llm.trace import CallRecord, current_ticker

# Mismo cinturón de seguridad que `deepseek.py`: timeout de httpx directo, sin hilo extra (un
# solo proveedor, no 28 detrás de un alias -- ver el comentario de `deepseek._HARD_TIMEOUT`).
_HARD_TIMEOUT = 180.0

# USD por 1M de tokens (input, output). docs.qwencloud.com, hasta 32K de contexto -- revisar si
# el prompt real del prescore (fundamentales + macro + medianas) se acerca a ese tope.
_PRICING: dict[str, tuple[float, float]] = {
    "qwen3.7-flash": (0.03, 0.13),
}


class QwenProvider:
    def __init__(
        self,
        api_key: str,
        model: str = "qwen3.7-flash",
        base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        stage: str = "",
        recorder=None,  # noqa: ANN001  (app.llm.trace.LLMTrace; None = no se traza)
        enable_thinking: bool = False,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._stage = stage
        self._recorder = recorder
        self._enable_thinking = enable_thinking
        self._logprobs_soportado = True
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self._usage = {
            "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
            "cache_hit_tokens": 0, "cache_miss_tokens": 0, "cost_usd": 0.0, "by_model": {},
        }

    @property
    def usage(self) -> dict:
        return copy.deepcopy(self._usage)

    def _account(self, usage: dict | None) -> tuple[int, int, int, float]:
        """Igual que `DeepSeekProvider._account`, sin precio de caché distinto (ver docstring
        del módulo) -- devuelve (hit, miss, completion, coste) de ESA llamada."""
        if not usage:
            return 0, 0, 0, 0.0
        pt = int(usage.get("prompt_tokens", 0) or 0)
        ct = int(usage.get("completion_tokens", 0) or 0)
        hit = int((usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0)
        miss = pt - hit
        pin, pout = _PRICING.get(self._model, (0.0, 0.0))
        cost = (pt * pin + ct * pout) / 1_000_000
        delta = {"calls": 1, "prompt_tokens": pt, "completion_tokens": ct,
                 "cache_hit_tokens": hit, "cache_miss_tokens": miss, "cost_usd": cost}
        by_model = self._usage["by_model"].setdefault(
            self._model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                          "cache_hit_tokens": 0, "cache_miss_tokens": 0, "cost_usd": 0.0})
        for k, v in delta.items():
            self._usage[k] += v
            by_model[k] += v
        return hit, miss, ct, cost

    def _payload(self, system: str, user: str, temperature: float, top_p: float | None) -> dict:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "enable_thinking": self._enable_thinking,
        }
        if top_p is not None:
            payload["top_p"] = top_p
        if self._logprobs_soportado:
            payload["logprobs"] = True
            if self._stage in _ETAPAS_CON_ALTERNATIVAS:
                payload["top_logprobs"] = _TOP_LOGPROBS
        return payload

    def _request(self, system: str, user: str, *, temperature: float,
                top_p: float | None) -> dict:
        for intento in (1, 2):
            payload = self._payload(system, user, temperature, top_p)
            t0 = time.monotonic()
            try:
                with httpx.Client(timeout=_HARD_TIMEOUT) as client:
                    resp = client.post(
                        f"{self._base_url}/chat/completions",
                        headers=self._headers,
                        json=payload,
                    )
                    resp.raise_for_status()
                    crudo = resp.content
                data = json.loads(crudo.decode("utf-8"))
            except httpx.HTTPStatusError as exc:
                # Mismo guardarraíl que DeepSeek: si logprobs no lo admite (400), se apaga para
                # esta instancia y se reintenta sin él -- la telemetría no tumba producción.
                if (intento == 1 and payload.get("logprobs")
                        and exc.response.status_code == 400):
                    self._logprobs_soportado = False
                    continue
                self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
                raise
            except Exception as exc:
                self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
                raise
            hit, miss, ct, cost = self._account(data.get("usage"))
            self._trazar(t0, data, uso=(hit, miss, ct, cost))
            return data
        raise AssertionError("inalcanzable")   # el bucle sale por return o por raise

    def _trazar(self, t0: float, data: dict | None, *, uso=(0, 0, 0, 0.0),  # noqa: ANN001
                error: str | None = None) -> None:
        if self._recorder is None:
            return
        choice = ((data or {}).get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        hit, miss, ct, cost = uso
        self._recorder.record(CallRecord(
            at=datetime.now(UTC), stage=self._stage, ticker=current_ticker(),
            model=self._model,
            # Qwen no tiene niveles (low/high/max) como DeepSeek, solo on/off -- se guarda como
            # "high"/"none" para que las consultas de traza que ya asumen ese campo string sigan
            # funcionando igual sin necesitar un caso especial por proveedor.
            reasoning_effort="high" if self._enable_thinking else "none",
            content=msg.get("content"),
            reasoning=msg.get("reasoning_content") if self._enable_thinking else None,
            confidence=_min_prob(data) if data else None,
            prompt_cache_hit_tokens=hit, prompt_cache_miss_tokens=miss, completion_tokens=ct,
            cost_usd=cost, latency_ms=int((time.monotonic() - t0) * 1000),
            ok=error is None, error=error,
            notas=_notas_logprob(data) if data and self._stage in _ETAPAS_CON_ALTERNATIVAS
            else [],
        ))

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        data = self._request(system, user, temperature=temperature, top_p=top_p)
        return data["choices"][0]["message"]["content"] or ""

    def chat_logprobs(self, system: str, user: str, *, temperature: float = 0.3,
                      top_p: float | None = None) -> tuple[str, float | None]:
        """Como `chat()`, pero además devuelve la probabilidad del token MENOS seguro -- mismo
        contrato que `DeepSeekProvider.chat_logprobs` (duck-typing, ver `scorer.prescore_one`)."""
        data = self._request(system, user, temperature=temperature, top_p=top_p)
        return data["choices"][0]["message"]["content"] or "", _min_prob(data)
