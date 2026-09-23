"""Cliente de Jev (TypeSafe AI) — SOLO para el prescore. Jev no genera texto (evaluado y
descartado para macro/profundo/constructor, ver docs/jev-typesafe-ai.md): decide un nivel sobre
una rúbrica fija y devuelve confianza calibrada de serie, sin logprobs que aproximar.

Cuatro preguntas (fundamentales, valoración, riesgo de financiación, catalizador) en una sola
llamada; la nota es su media ponderada llevada a 1-100 con 2 decimales (ver `_combinar`)."""

from __future__ import annotations

import copy
import json
import time
from datetime import UTC, datetime

import httpx

from app.config import settings
from app.llm.trace import CallRecord, current_ticker

_HARD_TIMEOUT = 30.0
_ENDPOINT = "https://api.typesafe.ai/v1/systemone"

# USD por 1M de tokens de entrada; salida gratis (docs.typesafe.ai/models).
_PRICING: dict[str, tuple[float, float]] = {
    "jev-latest": (0.042, 0.0),
}

# Cuatro preguntas sobre el mismo `state`, en una sola llamada. Validadas contra el escaneo 65
# (docs/plan-jev-pipeline.md); la nota final es su media ponderada (`settings.jev_pesos`).
_NIVELES_FUNDAMENTALS = [
    "Revenue and margins are both declining, and the balance sheet is weakening.",
    "Growth has stalled or margins are compressing, with no sign of stabilization.",
    "Growth is weak or inconsistent, and margins or the balance sheet show mild strain.",
    "The business is stable but unremarkable: modest growth, flat margins, an adequate balance "
    "sheet.",
    "The business is solid: steady growth, stable margins, a healthy balance sheet, without "
    "standing out.",
    "The business is solid with a positive trend in at least one dimension (accelerating growth, "
    "expanding margins, or deleveraging).",
    "The business shows strong growth AND healthy or improving margins, with a sound balance "
    "sheet.",
    "The business shows strong growth, expanding margins, and a strong balance sheet together.",
    "The business shows exceptional growth and profitability across the board, with a strong and "
    "improving balance sheet.",
    "The business is best-in-class on every fundamental dimension among its peers.",
]
_NIVELES_VALUATION = [
    "No earnings and no positive cash flow, yet valued at a high multiple of sales.",
    "PEG well above 2 and forward P/E above trailing P/E: paying more for shrinking earnings.",
    "PEG above 2, or high multiples while earnings growth is flat or negative.",
    "PEG between about 1.5 and 2: the growth is real but already largely paid for.",
    "Not enough data to judge (no PEG, no earnings), or the signals point in opposite directions.",
    "PEG between about 1 and 1.5, with positive free cash flow.",
    "PEG around 1 and forward P/E below trailing P/E: earnings expected to grow into the price.",
    "PEG below 1, forward P/E below trailing P/E, and positive free cash flow.",
    "PEG well below 1 with strong free cash flow and moderate multiples across P/E, EV/EBITDA and "
    "P/S.",
    "PEG well below 1, forward P/E clearly below trailing P/E, strong free cash flow and low "
    "multiples on every measure.",
]
_NIVELES_FINANCING = [
    "Distress: the company may not be able to meet its obligations without new money soon.",
    "Burning cash with a current ratio below 1 and significant debt: a financing need looks "
    "imminent.",
    "Burning cash with a thin cushion: cash and liquidity cover only a short period of the burn.",
    "High debt with weak liquidity (current ratio below 1) and operating cash flow too small to "
    "service it comfortably.",
    "A real pressure point: liquidity near 1 with meaningful debt to serve, or cash burn with a "
    "moderate cushion.",
    "Some strain but manageable: elevated debt or liquidity near 1, covered by positive "
    "operating cash flow.",
    "Minor watch point: high debt/equity or modest cash burn, clearly covered by operating cash "
    "flow or a large cash position.",
    "Low risk: positive operating cash flow comfortably covers obligations; debt is moderate.",
    "Very low risk: strong operating cash flow or ample cash, with a comfortable liquidity "
    "cushion.",
    "No financing risk: operations generate cash, or cash and liquidity comfortably cover any "
    "cash burn well beyond the coming months.",
]
_NIVELES_CATALYST = [
    "A specific negative event is expected in the next month with no offsetting positive.",
    "Early signs of a negative development, without a confirmed event yet.",
    "No identifiable event, and recent news flow leans negative.",
    "No identifiable event; news flow is neutral to slightly negative.",
    "No identifiable event; news flow is neutral.",
    "No confirmed event, but a plausible upcoming trigger (earnings date, product cycle) without "
    "enough detail.",
    "One specific, credible positive event expected in the next month.",
    "One specific, credible positive event, reinforced by generally positive recent news flow.",
    "Two or more independent specific positive events expected in the next month.",
    "A major, high-confidence positive event expected, with limited identifiable downside risk.",
]

# Clave de `settings.jev_pesos` / columna de `scan_audit` -> clave de la pregunta en la API.
PREGUNTAS = {
    "fundamentals": "fundamentals_score",
    "valuation": "valuation_score",
    "financing": "financing_risk_score",
    "catalyst": "catalyst_score",
}
_QUESTIONS = {
    "fundamentals_score": {
        "type": "score", "criteria": _NIVELES_FUNDAMENTALS,
        "instructions": (
            "Score ONLY the quality of the underlying business: growth, margins, and "
            "balance-sheet trend. Ignore the stock price, its valuation, and any news catalyst "
            "entirely."),
    },
    "valuation_score": {
        "type": "score", "criteria": _NIVELES_VALUATION,
        "instructions": (
            "Score how the CURRENT price compares with the company's earnings power and growth, "
            "using growth-adjusted and forward-looking signals: PEG, forward P/E versus trailing "
            "P/E, and the sign of free cash flow; use P/E, EV/EBITDA and P/S only as support. Do "
            "not assume a sector is cheap or expensive by nature. If the needed data is missing "
            "(no earnings, no PEG), choose the 'not enough data' level. Ignore price momentum, "
            "recent price change and proximity to highs."),
    },
    "catalyst_score": {
        "type": "score", "criteria": _NIVELES_CATALYST,
        "instructions": (
            "Score whether there is a SPECIFIC, identifiable business event expected in the next "
            "month (earnings, product launch, regulatory decision, contract award, management "
            "change). A price move by itself is not an event."),
    },
    "financing_risk_score": {
        "type": "score", "criteria": _NIVELES_FINANCING,
        "instructions": (
            "Score ONLY the risk that the company runs into a financing problem in the coming "
            "months: needing to raise money on bad terms, or being unable to meet its "
            "obligations. Burning cash is NOT a risk when cash and liquidity comfortably cover "
            "it: early-stage and pre-revenue companies with ample liquidity belong at the top. "
            "Negative free cash flow caused by heavy investment while operating cash flow is "
            "positive is NOT a risk. For banks and insurers, high debt/equity is part of the "
            "business model and is not by itself a risk. A missing field is unknown, not bad. "
            "Ignore growth, valuation, news and governance scores."),
    },
}


class JevProvider:
    """Mismo contrato que `DeepSeekProvider`/`QwenProvider` (`chat`/`chat_logprobs`), para que
    `scorer.prescore_one` no necesite saber qué proveedor tiene detrás. `system` se ignora --
    las instrucciones van en `_QUESTIONS`; `user` (el prompt real, con macro/fundamentales/
    noticias) se manda tal cual como `state`."""

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
        """Devuelve la nota combinada: `{"score", "confidence", "dimensiones"}`. Una pregunta
        ausente en la respuesta es un fallo de la llamada, no una nota parcial."""
        payload = {"state": user, "model": self._model, "questions": _QUESTIONS}
        t0 = time.monotonic()
        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(_ENDPOINT, headers=self._headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
            raise
        # Respuesta incompleta = llamada cobrada igual: el coste se cuenta antes de combinar.
        cost = self._account(data.get("usage"))
        try:
            nota = _combinar(data.get("answers") or {})
        except Exception as exc:
            self._trazar(t0, data, cost=cost, error=f"{type(exc).__name__}: {exc}")
            raise
        self._trazar(t0, data, nota, cost=cost)
        return nota

    def _trazar(self, t0: float, data: dict | None, nota: dict | None = None, *,
               cost: float = 0.0, error: str | None = None) -> None:
        if self._recorder is None:
            return
        usage = (data or {}).get("usage", {})
        self._recorder.record(CallRecord(
            at=datetime.now(UTC), stage=self._stage, ticker=current_ticker(),
            model=self._model, reasoning_effort="none",
            content=str(nota["score"]) if nota else None, reasoning=None,
            confidence=nota["confidence"] if nota else None,
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=usage.get("input_tokens", 0),
            completion_tokens=usage.get("output_tokens", 0),
            cost_usd=cost, latency_ms=int((time.monotonic() - t0) * 1000),
            ok=error is None, error=error, notas=[],
        ))

    def chat(self, system: str, user: str, *, temperature: float = 0.3,  # noqa: ARG002
            top_p: float | None = None) -> str:
        return self.chat_logprobs(system, user)[0]

    def chat_logprobs(self, system: str, user: str, *, temperature: float = 0.3,  # noqa: ARG002
                      top_p: float | None = None) -> tuple[str, float | None]:
        """La "confianza" es la que calibra Jev de serie (media de las 4 preguntas), no una
        aproximación por logprobs como en DeepSeek/Qwen."""
        nota = self._request(user)
        raw = json.dumps({"score": nota["score"], "dimensiones": nota["dimensiones"]})
        return raw, nota["confidence"]


def _combinar(answers: dict) -> dict:
    """Media ponderada de los 4 niveles (0-9) a escala 1-100, nunca 0: `prescore_one` lee
    sc<=0 como "sin nota", y el nivel 0 es una respuesta válida. Sin confianza en alguna
    pregunta la nota vale igual: la confianza es telemetría, no puede costar el nombre."""
    pesos = settings.jev_pesos
    dims = {k: (float(answers[q]["score"]), answers[q].get("confidence"))
            for k, q in PREGUNTAS.items()}
    nivel = sum(pesos[k] * n for k, (n, _c) in dims.items()) / sum(pesos.values())
    confs = [float(c) for _n, c in dims.values() if c is not None]
    return {
        "score": round(1 + nivel / 9 * 99, 2),
        "confidence": round(sum(confs) / len(confs), 4) if confs else None,
        "dimensiones": {k: [round(n, 2), None if c is None else round(float(c), 3)]
                        for k, (n, c) in dims.items()},
    }
