"""Scorer por nombre (método whitepaper DeepSeek, Exhibit 1).

Una llamada razonada (V4-Pro) por empresa: escribe un Investment Report (noticias, financials,
valoración, outlook) e INTERPRETA (no repite) → devuelve un Score 1-100 para el próximo mes.
Los técnicos van solo como CONTEXTO, no como regla. Para nombres en cartera/watchlist se le
inyecta la tesis previa ("la última vez opinaste X — ¿qué ha cambiado?").

Prompt en inglés (ahorra tokens); el informe y la tesis los devuelve en español.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.llm.base import LLMProvider
from app.screener.fundamentals import NameData

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are a financial expert with stock-recommendation experience. You provide an investment "
    "score (1-100) for the NEXT MONTH for a company, based on its financial data and news. Speak "
    "in the third person; do not mention credentials; do not speak directly to investors nor "
    "recommend actions; do not recommend alternatives. Write a short investment report with "
    "sections: recent news, financials, valuation, and economic outlook affecting the firm. "
    "INTERPRET the news, do not just repeat it. The macro/sector outlook is background context "
    "about the environment the firm operates in; weigh it as you judge appropriate for this "
    "specific company. Technical "
    "data (moving averages, 52-week range, RSI) is CONTEXT, never a decision rule. Then assign a "
    "score from 1 to 100 for the potential investment value over the next month (100 = best). "
    "ALSO give your own approximate 3-month PRICE TARGET (a single number in the stock's trading "
    "currency), informed by the fundamentals and the analyst targets provided. If the news show "
    "the company is under a definitive cash acquisition offer, use the offer terms exactly as "
    "reported (do not derive per-share figures yourself) and do not set the price target above "
    "the cash offer price. "
    'Respond ONLY in JSON: {"report": "...", "headline": "one-sentence thesis", '
    '"score": <int 1-100>, "target_price": <number>}. Write report and headline in Spanish.'
)


PRESCORE_SYSTEM = (
    "You are the first-pass TRIAGE of an equity research pipeline. Your score answers ONE "
    "question: how likely is it that a rigorous deep fundamental analysis would find this company "
    "attractive for the next month? Weigh fundamentals, valuation and news TOGETHER. Do not raise "
    "or lower the score merely because of the company's sector, its size, or a recent price move "
    "in either direction — a selloff does not by itself make a strong business weak, nor does a "
    "rally make it strong; ask whether the news changes the earnings power or the valuation case. "
    "Calibrate the scale: 90+ exceptional (rare), 75-89 strong candidate for deep review, 50-74 "
    "unremarkable, <50 weak. Use ONE DECIMAL and spread scores out; avoid ties and round numbers. "
    'Respond ONLY in JSON: {"score": <number 0-100, one decimal>, "headline": "..."}. '
    "Write the headline in Spanish."
)


@dataclass
class PrescoreResult:
    ticker: str
    score: float
    headline: str


@dataclass
class ScoreResult:
    ticker: str
    score: int
    headline: str
    report: str
    target_price: float | None = None


def _user_prompt(data: NameData, macro_block: str, prior_thesis: str | None) -> str:
    news = "\n".join(f"- {h}" for h in data.news) if data.news else "none"
    prior = (
        f"\nPrior view on this name (from our records): {prior_thesis}\n"
        "Assess explicitly what has changed since then.\n"
        if prior_thesis else ""
    )
    return (
        f"Company: {data.ticker} — sector {data.sector} / {data.industry}.\n"
        f"Macro & sector outlook:\n{macro_block}\n\n"
        f"Latest fundamentals:\n{data.fundamentals_text}\n\n"
        f"Technical context: {data.technical_text or 'n/d'}\n\n"
        f"Recent news:\n{news}\n"
        f"{prior}\n"
        "Write the investment report (JSON) and the 1-100 score."
    )


def _prescore_prompt(data: NameData, macro_block: str) -> str:
    news = "; ".join(data.news[:3]) if data.news else "none"
    return (
        f"{data.ticker} — {data.sector}/{data.industry}. Macro: {macro_block}\n"
        f"Fundamentals:\n{data.fundamentals_text}\n"
        f"Technical: {data.technical_text or 'n/d'}\nNews: {news}\n"
        "Quick 1-100 score + one-line thesis (JSON)."
    )


def prescore(llm: LLMProvider, data: NameData, macro_block: str, temperature: float = 0.2) -> PrescoreResult:
    """Ranking de primera pasada (modelo rápido/barato). Best-effort: 0 si falla."""
    try:
        raw = llm.chat(PRESCORE_SYSTEM, _prescore_prompt(data, macro_block), temperature=temperature)
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = max(0.0, min(100.0, round(float(obj.get("score", 0)), 1)))
        return PrescoreResult(data.ticker, sc, str(obj.get("headline", "")).strip())
    except Exception:
        return PrescoreResult(data.ticker, 0.0, "")


def score(
    llm: LLMProvider, data: NameData, macro_block: str, prior_thesis: str | None = None,
    temperature: float = 0.3,
) -> ScoreResult:
    """Puntúa un nombre. Best-effort: si el LLM falla/no parsea, score 0 (queda fuera)."""
    try:
        raw = llm.chat(SYSTEM, _user_prompt(data, macro_block, prior_thesis), temperature=temperature)
        obj = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        sc = int(round(float(obj.get("score", 0))))
        sc = max(0, min(100, sc))
        tp = obj.get("target_price")
        try:
            tp = float(tp) if tp is not None else None
        except (TypeError, ValueError):
            tp = None
        return ScoreResult(
            ticker=data.ticker,
            score=sc,
            headline=str(obj.get("headline", "")).strip(),
            report=str(obj.get("report", "")).strip(),
            target_price=tp,
        )
    except Exception:
        logger.warning("Scorer no parseable para %s", data.ticker)
        return ScoreResult(ticker=data.ticker, score=0, headline="", report="")
