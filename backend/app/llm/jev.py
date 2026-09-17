"""Cliente de Jev (TypeSafe AI) — SOLO para el prescore. Jev no genera texto (evaluado y
descartado para macro/profundo/constructor, ver docs/jev-typesafe-ai.md): decide un nivel sobre
una rúbrica fija y devuelve confianza calibrada de serie, sin logprobs que aproximar.

La rúbrica de 10 niveles es la validada en la evaluación real (17-sep-2026). La conversión a la
escala de vuelta es 1 + nivel/9×99 (rango 1-100, ver `_score_100`, NUNCA 0-100: 0 colisiona con
el "sin nota utilizable" de `scorer.prescore_one`), redondeada a 2 decimales -- Jev "cae entre
dos niveles" (media ponderada por probabilidad), así que el resultado ya viene con decimales; no
tiene sentido perderlos igualando el hueco a un entero como hace DeepSeek con su prompt de
texto."""

from __future__ import annotations

import copy
import time
from datetime import UTC, datetime

import httpx

from app.llm.trace import CallRecord, current_ticker

_HARD_TIMEOUT = 30.0
_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

# USD por 1M de tokens de entrada; salida gratis (docs.typesafe.ai/models).
_PRICING: dict[str, tuple[float, float]] = {
    "jev-latest": (0.042, 0.0),
}

# Rúbrica validada contra datos reales (10 tickers de mega-cap + SK hynix + TSM, 17-sep-2026,
# ver docs/jev-typesafe-ai.md) -- "describe situaciones, no grados" (guía de TypeSafe), cada
# nivel es un punto concreto en la recta, no un tramo: por eso el Score puede caer ENTRE dos.
_NIVELES = [
    "Deteriorating fundamentals, negative catalysts, weak or worsening outlook for the next "
    "month",
    "Clearly weak: declining growth or margins, no near-term catalyst, headwinds outweigh "
    "strengths",
    "Below average: mixed-to-weak fundamentals, no clear catalyst, real unresolved concerns",
    "Slightly below average: solid fundamentals but stretched valuation or fading momentum, "
    "no strong near-term driver",
    "Average: balanced fundamentals and valuation, no strong catalyst in either direction",
    "Slightly above average: solid fundamentals with a modest positive catalyst or improving "
    "trend",
    "Above average: strong fundamentals, positive momentum, credible near-term catalyst",
    "Clearly strong: excellent fundamentals, strong growth, clear positive catalyst for the "
    "next month",
    "Very strong: exceptional fundamentals and momentum, multiple reinforcing positive "
    "catalysts",
    "Exceptional: best-in-class fundamentals, dominant momentum, major near-term catalyst "
    "with limited downside",
]

_INSTRUCTIONS = (
    "Score the potential investment value of this company for the NEXT MONTH, using its "
    "financial data and news together. A price move is not by itself a verdict in either "
    "direction: a fall does not make a business weak, nor does a rally make it strong."
)


class JevProvider:
    """Mismo contrato que `DeepSeekProvider`/`QwenProvider` (`chat`/`chat_logprobs`), para que
    `scorer.prescore_one` no necesite saber qué proveedor tiene detrás. `system` se ignora --
    la instrucción de Jev va en `_INSTRUCTIONS`, no en el prompt de texto del prescore; `user`
    (el prompt real, con macro/fundamentales/noticias) se manda tal cual como `state`."""

    def __init__(
        self,
        api_key: str,
        model: str = "jev-latest",
        stage: str = "",
        recorder=None,  # noqa: ANN001  (app.llm.trace.LLMTrace; None = no se traza)
        timeout: float = _HARD_TIMEOUT,
    ) -> None:
        self._model = model
        self._stage = stage
        self._recorder = recorder
        self._timeout = timeout
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self._usage = {
            "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
            "cache_hit_tokens": 0, "cache_miss_tokens": 0, "cost_usd": 0.0, "by_model": {},
        }

    @property
    def usage(self) -> dict:
        return copy.deepcopy(self._usage)

    def _account(self, usage: dict | None) -> float:
        if not usage:
            return 0.0
        pt = int(usage.get("input_tokens", 0) or 0)
        ct = int(usage.get("output_tokens", 0) or 0)
        pin, pout = _PRICING.get(self._model, (0.0, 0.0))
        cost = (pt * pin + ct * pout) / 1_000_000
        # Sin caché (Jev no la expone) -- todo cuenta como miss, mismo criterio de campos que
        # el resto de proveedores para que ScanRunCostBreakdown no necesite un caso especial.
        delta = {"calls": 1, "prompt_tokens": pt, "completion_tokens": ct,
                 "cache_hit_tokens": 0, "cache_miss_tokens": pt, "cost_usd": cost}
        by_model = self._usage["by_model"].setdefault(
            self._model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                          "cache_hit_tokens": 0, "cache_miss_tokens": 0, "cost_usd": 0.0})
        for k, v in delta.items():
            self._usage[k] += v
            by_model[k] += v
        return cost

    def _request(self, user: str) -> dict:
        payload = {
            "state": user,
            "model": self._model,
            "questions": {
                "investment_score": {
                    "type": "score", "instructions": _INSTRUCTIONS, "criteria": _NIVELES,
                },
            },
        }
        t0 = time.monotonic()
        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(_ENDPOINT, headers=self._headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
            raise
        cost = self._account(data.get("usage"))
        self._trazar(t0, data, cost=cost)
        return data

    def _trazar(self, t0: float, data: dict | None, *, cost: float = 0.0,
               error: str | None = None) -> None:
        if self._recorder is None:
            return
        ans = ((data or {}).get("answers") or {}).get("investment_score") or {}
        self._recorder.record(CallRecord(
            at=datetime.now(UTC), stage=self._stage, ticker=current_ticker(),
            model=self._model, reasoning_effort="none",
            content=str(ans.get("score")) if ans else None, reasoning=None,
            confidence=ans.get("confidence"),
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=(data or {}).get("usage", {}).get("input_tokens", 0),
            completion_tokens=(data or {}).get("usage", {}).get("output_tokens", 0),
            cost_usd=cost, latency_ms=int((time.monotonic() - t0) * 1000),
            ok=error is None, error=error, notas=[],
        ))

    @staticmethod
    def _score_100(ans: dict) -> float:
        """Nivel (0-9, con decimales -- media ponderada por probabilidad, Jev "cae entre dos
        niveles") a escala 1-100, NUNCA 0-100: `scorer.prescore_one` trata sc<=0 como "el JSON
        no traía nota utilizable" (`obj.get("score", 0)` por defecto si el campo faltara) --
        un nivel 0 legítimo de Jev (el peor de la rúbrica, una respuesta real y válida) se
        descartaría como si hubiera fallado el parseo. 1 + nivel/9*99 nunca llega a 0."""
        return round(1 + ans["score"] / 9 * 99, 2)

    def chat(self, system: str, user: str, *, temperature: float = 0.3,  # noqa: ARG002
            top_p: float | None = None) -> str:
        data = self._request(user)
        ans = data["answers"]["investment_score"]
        return f'{{"score": {self._score_100(ans)}}}'

    def chat_logprobs(self, system: str, user: str, *, temperature: float = 0.3,  # noqa: ARG002
                      top_p: float | None = None) -> tuple[str, float | None]:
        """Como `chat()`, pero la "confianza" es la que ya calibra Jev de serie -- no una
        aproximación por logprobs como en DeepSeek/Qwen, el dato real que motivó probarlo."""
        data = self._request(user)
        ans = data["answers"]["investment_score"]
        return f'{{"score": {self._score_100(ans)}}}', ans.get("confidence")
