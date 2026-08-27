"""Constructor de cartera — paso de ALLOCATION (método whitepaper DeepSeek, Exhibit 2E).

Fiel al paper: la SELECCIÓN de nombres ya está hecha en el servicio (top-N por score profundo,
desempate por market cap). Este agente NO re-selecciona: recibe los nombres YA ELEGIDOS + el
outlook macro, y solo **asigna pesos** (con tesis, edge y riesgo por posición). La convicción
vive en los PESOS, no en la selección — como en el paper.

Sin cartera actual (19-ago, fidelidad al Exhibit 2E): el paper reconstruye el top-15 desde cero
cada mes, sin pasarle qué tenía antes. Nosotros hacíamos lo mismo con ticker+peso — quitado
porque el diff de trades es 100% mecánico en `build_trades()` (compara la lista nueva del LLM
contra `Position` por conjunto de tickers), así que el LLM nunca necesitó ver la cartera vieja
para que la rotación funcione.

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

# Literal exacto que devuelve `construct()` si el LLM falla los 3 intentos — el caller lo usa
# para distinguir "constructor caído" de "cartera sana con poca convicción" en `issues`.
FALLBACK_SUMMARY = "Sin propuesta (fallo del modelo)."

SYSTEM = (
    "You are a portfolio manager doing the ALLOCATION step — the stocks were ALREADY SELECTED by "
    "score. You receive the FULL reports of the SELECTED stocks (news, financials, valuation, "
    "score) and a macro outlook. "
    "Build a portfolio of EXACTLY {max_pos} names to perform well over the next month versus the "
    "S&P 500. "
    "HARD RULES: allocate ONLY among the listed candidates below (the selected stocks, plus any "
    "instruments shown); do NOT add any ticker that is not listed; each weight 0-{max_pct}%; be "
    "FULLY INVESTED — the weights MUST sum to 100% (NO cash); pick EXACTLY {max_pos} of them. "
    "Weight each chosen name by your conviction, reading its fundamentals, valuation, macro "
    "context and thesis on their own merits. "
    # Misma frase que las cuatro etapas de scoring: aquí el juicio se convierte en PESO, así que
    # sin ella el sesgo por movimiento reciente entra por la puerta de la convicción.
    "A price move is not by itself a verdict in either direction: a fall does not make a "
    "business weak, nor does a rally make it strong. "
    "For each position give a thesis, an edge (why it beats the market) and a risk. "
    "Funding exactly {max_pos} of the listed candidates necessarily leaves the others out; for "
    "each one left out, state in one line what made you prefer the funded ones. That is a record "
    "of your reasoning, not a verdict on those companies, and it does not change how many you "
    "fund. "
    "Respond ONLY in JSON: "
    '{"positions": [{"ticker": "XXX", "weight_pct": <0-{max_pct}>, '
    '"thesis": "...", "edge": "...", "risk": "..."}], '
    '"omitted": [{"ticker": "YYY", "reason": "..."}], "summary": "..."}. '
    "Write thesis, edge, risk, reason and summary in Spanish."
)


@dataclass
class TargetPosition:
    ticker: str
    weight_pct: float
    thesis: str
    edge: str
    risk: str


@dataclass
class OmittedName:
    """Un candidato que quedó fuera de la cartera, con el motivo en una línea.

    Es TELEMETRÍA: el constructor fondea 5 de los 10 seleccionados, así que omitir es
    obligatorio, no una opinión. Sirve para distinguir criterio de pattern-matching cuando se
    revisa un escaneo a posteriori — nunca vuelve a entrar a un prompt.
    """

    ticker: str
    reason: str


@dataclass
class ConstructionResult:
    cash_pct: float
    positions: list[TargetPosition] = field(default_factory=list)
    summary: str = ""
    omitted: list[OmittedName] = field(default_factory=list)


def _user_prompt(candidates_text: str, macro_block: str) -> str:
    return (
        # Sin "& sector": el macro tiene PROHIBIDO nombrar sectores, así que la
        # etiqueta anunciaba un contenido que ya no llega (ver el mismo cambio en scorer.py).
        f"Macro outlook:\n{macro_block}\n\n"
        f"Candidates (already chosen — allocate weights among THESE only):\n"
        f"{candidates_text}\n\n"
        "Assign the target weights now (JSON)."
    )


def construct(
    llm: LLMProvider, candidates_text: str, macro_block: str,
    max_positions: int, max_position_pct: float, valid_tickers: set[str],
    min_positions: int = 1, temperature: float = 1.0, top_p: float | None = 0.95,
) -> ConstructionResult:
    """Asigna pesos a los nombres YA SELECCIONADOS. Enforcea las reglas duras tras el LLM.

    La normalización final a 100% (si `fully_invested`) y el mínimo de posiciones los aplica
    el servicio (`_finalize_full_invest`), que conoce el orden de selección para rellenar.

    REINTENTA hasta DOS veces (3 intentos en total). Aquí una llamada
    mala no cuesta un nombre como en el scorer: cuesta la decisión ENTERA del mes. Con un solo
    reintento pasó en un test real — OpenRouter devolvió `content` vacío, el JSON no parseó
    y la función devolvió 100% caja con "Sin propuesta"; al relanzarla con exactamente los
    mismos datos acertó a la primera, o sea que el fallo era de transporte y no del prompt. Subir
    a dos reintentos vino de medir que sobre 49 finalistas de un escaneo
    ~6 de cada 49 fallaban al primer intento con `deepseek-v4-flash-0731` — no solo `content`
    vacío, también JSON cortado a media frase o bucles de repetición degenerados (ver
    `provider_ignore` en `openrouter.py`: dos de los proveedores identificados como causa sirven
    el modelo en fp8, no precisión completa). Con esa tasa, fallar 2 veces seguidas no es tan
    raro; fallar 3 sí. Se reintenta también cuando el JSON es válido pero no deja ni una posición
    utilizable: para el escaneo eso es igual de fatal que no parsear, porque `construct` solo se
    llama cuando HAY candidatos.
    """
    system = (SYSTEM.replace("{max_pos}", str(max_positions))
              .replace("{min_pos}", str(min_positions))
              .replace("{max_pct}", str(int(max_position_pct))))
    user = _user_prompt(candidates_text, macro_block)

    data: dict | None = None
    positions: list[TargetPosition] = []
    for intento in (1, 2, 3):
        try:
            raw = llm.chat(system, user, temperature=temperature, top_p=top_p)
            data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        except Exception:
            logger.warning("Constructor no parseable (intento %d/3)", intento, exc_info=True)
            data = None
        if data is not None:
            positions = _parse_positions(data, valid_tickers, max_positions, max_position_pct)
            if positions:
                break
            logger.warning("Constructor sin posiciones utilizables (intento %d/3)", intento)
    if not positions:
        logger.error("Constructor sin cartera tras 3 intentos → todo caja")
        return ConstructionResult(cash_pct=100.0, positions=[], summary=FALLBACK_SUMMARY)

    # Renormaliza si la suma de pesos pasa de 100 (respetando el tope por posición).
    total = sum(p.weight_pct for p in positions)
    if total > 100.0 and total > 0:
        for p in positions:
            p.weight_pct = round(p.weight_pct * 100.0 / total, 2)
        total = 100.0
    cash_pct = round(max(0.0, 100.0 - total), 2)

    # Omitidos: mismo filtro anti-alucinación que las posiciones, y sin colar como "descartado"
    # a uno que sí se fondeó (el modelo a veces repite un nombre en las dos listas).
    fondeados = {p.ticker for p in positions}
    omitted: list[OmittedName] = []
    for o in (data or {}).get("omitted", []) or []:
        tk = str(o.get("ticker", "")).strip().upper()
        if tk and tk in valid_tickers and tk not in fondeados:
            omitted.append(OmittedName(ticker=tk, reason=str(o.get("reason", "")).strip()))

    return ConstructionResult(cash_pct=cash_pct, positions=positions, omitted=omitted,
                              summary=str((data or {}).get("summary", "")).strip())


def _parse_positions(data: dict, valid_tickers: set[str], max_positions: int,
                     max_position_pct: float) -> list[TargetPosition]:
    """Posiciones utilizables de una respuesta ya parseada. Separado de `construct` para poder
    reintentar la llamada entera sin duplicar el filtrado anti-alucinación."""
    positions: list[TargetPosition] = []
    for p in data.get("positions", []) or []:
        tk = str(p.get("ticker", "")).strip().upper()
        if not tk or tk not in valid_tickers:      # ignora tickers no puntuados (anti-alucinación)
            continue
        try:
            w = max(0.0, min(float(max_position_pct), float(p.get("weight_pct", 0) or 0)))
        except (TypeError, ValueError):
            continue
        positions.append(TargetPosition(
            ticker=tk, weight_pct=w,
            thesis=str(p.get("thesis", "")).strip(),
            edge=str(p.get("edge", "")).strip(),
            risk=str(p.get("risk", "")).strip(),
        ))
        if len(positions) >= max_positions:
            break
    return positions
