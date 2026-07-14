"""Constructor de cartera — paso de ALLOCATION (método whitepaper DeepSeek, Exhibit 2E).

Fiel al paper: la SELECCIÓN de nombres ya está hecha en el servicio (top-N por score profundo,
desempate por market cap). Este agente NO re-selecciona: recibe los nombres YA ELEGIDOS + el
estado real de la cartera + el outlook macro, y solo **asigna pesos** (con tesis, edge y riesgo
por posición). La convicción vive en los PESOS, no en la selección — como en el paper.

Tope 35% por posición, 100% invertido (sin caja, normalizado en el servicio). Además de las
acciones seleccionadas puede usar instrumentos UCITS del allowlist (`app.instruments`), si lo hay.
El DINERO exacto (acciones, importes) lo calcula el código en el servicio (nunca el LLM).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are a portfolio manager doing the ALLOCATION step — the stocks were ALREADY SELECTED by "
    "score. You receive the fund's CURRENT state (positions, cost, cash, P&L, weights), the "
    "SELECTED stocks with their theses and scores, and a macro outlook. Build a portfolio of "
    "EXACTLY {max_pos} names to perform well over the next month versus the S&P 500. "
    "HARD RULES: allocate ONLY among the listed candidates below (the selected stocks, plus any "
    "instruments shown); do NOT add any ticker that is not listed; each weight 0-{max_pct}%; be "
    "FULLY INVESTED — the weights MUST sum to 100% (NO cash); pick EXACTLY {max_pos} of them. "
    "Weight each chosen name by your conviction, reading its fundamentals, valuation, macro "
    "context and thesis on their own merits. Keep existing holdings' weights stable unless their "
    "thesis has changed (LOW TURNOVER — a scan does not force a trade). "
    "For each position give a thesis, an edge (why it beats the market) and a risk. "
    "Respond ONLY in JSON: "
    '{"cash_pct": <0-100>, "positions": [{"ticker": "XXX", "weight_pct": <0-{max_pct}>, '
    '"thesis": "...", "edge": "...", "risk": "..."}], "summary": "..."}. '
    "Write thesis, edge, risk and summary in Spanish."
)


@dataclass
class TargetPosition:
    ticker: str
    weight_pct: float
    thesis: str
    edge: str
    risk: str


@dataclass
class ConstructionResult:
    cash_pct: float
    positions: list[TargetPosition] = field(default_factory=list)
    summary: str = ""


def _user_prompt(portfolio_text: str, candidates_text: str, macro_block: str) -> str:
    return (
        f"Macro & sector outlook:\n{macro_block}\n\n"
        f"Current portfolio (the agent's own sleeve):\n{portfolio_text}\n\n"
        f"Candidates (already chosen — allocate weights among THESE only):\n"
        f"{candidates_text}\n\n"
        "Assign the target weights now (JSON)."
    )


def construct(
    llm: LLMProvider, portfolio_text: str, candidates_text: str, macro_block: str,
    max_positions: int, max_position_pct: float, valid_tickers: set[str],
    min_positions: int = 1, temperature: float = 0.3,
) -> ConstructionResult:
    """Asigna pesos a los nombres YA SELECCIONADOS. Enforcea las reglas duras tras el LLM.

    La normalización final a 100% (si `fully_invested`) y el mínimo de posiciones los aplica
    el servicio (`_finalize_full_invest`), que conoce el orden de selección para rellenar.
    """
    system = (SYSTEM.replace("{max_pos}", str(max_positions))
              .replace("{min_pos}", str(min_positions))
              .replace("{max_pct}", str(int(max_position_pct))))
    try:
        raw = llm.chat(system, _user_prompt(portfolio_text, candidates_text, macro_block), temperature=temperature)
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except Exception:
        logger.exception("Constructor no parseable → cartera vacía (todo caja)")
        return ConstructionResult(cash_pct=100.0, positions=[], summary="Sin propuesta (fallo del modelo).")

    positions: list[TargetPosition] = []
    for p in data.get("positions", []):
        tk = str(p.get("ticker", "")).strip().upper()
        if not tk or tk not in valid_tickers:      # ignora tickers no puntuados (anti-alucinación)
            continue
        w = max(0.0, min(float(max_position_pct), float(p.get("weight_pct", 0) or 0)))
        positions.append(TargetPosition(
            ticker=tk, weight_pct=w,
            thesis=str(p.get("thesis", "")).strip(),
            edge=str(p.get("edge", "")).strip(),
            risk=str(p.get("risk", "")).strip(),
        ))
        if len(positions) >= max_positions:
            break

    # Renormaliza si la suma de pesos pasa de 100 (respetando el tope por posición).
    total = sum(p.weight_pct for p in positions)
    if total > 100.0 and total > 0:
        for p in positions:
            p.weight_pct = round(p.weight_pct * 100.0 / total, 2)
        total = 100.0
    cash_pct = round(max(0.0, 100.0 - total), 2)
    return ConstructionResult(cash_pct=cash_pct, positions=positions, summary=str(data.get("summary", "")).strip())
