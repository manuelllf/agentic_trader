"""Gate de noticias del momentum -- ÚNICO punto de todo el flujo donde interviene un LLM, y
solo para una decisión binaria (miedo vs. fundamentales rotos). Nunca decide tamaño ni
ejecución. Ver docs/momentum-sala-real-x.md §3.

Se llama SOLO sobre la señal más reciente de un ticker/candidato -- nunca sobre el histórico
de un mismo ticker (decidido 7-sep-2026: repetir la llamada en señales antiguas no cambia la
decisión de "¿lo incorporo/alerto ahora?" y sería coste y ruido sin motivo).

Prompt en inglés (ver [[prompts-in-english]]); motivo de salida en español.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date

import httpx

from app.config import settings
from app.llm.deepseek import DeepSeekProvider
from app.screener import fundamentals, yahoo_scraper

logger = logging.getLogger(__name__)

# Lista cerrada de 8 motivos de veto, validada 7/7 en casos reales (RKLB, ASTS, APLD, SOUN,
# SUPX, OPEN, RR). Un prompt abierto sin esta lista falló: revertía 3/7 veredictos, vetando
# pullbacks normales (venta de insiders, desaceleración de crecimiento) que la lista cerrada
# correctamente deja pasar.
SYSTEM = (
    "You are evaluating whether a stock's sharp price decline was driven by FEAR (a normal "
    "pullback, insider selling, growth deceleration while still positive, sector rotation, a "
    "beat/miss vs. analyst estimates) or by a genuinely BROKEN business fundamental. "
    "A price move is not by itself a verdict: a large decline does not by itself mean the "
    "business is broken. "
    "You are extremely disciplined: classify it as BROKEN only if the news explicitly states "
    "ONE of these EXACT 8 reasons -- nothing else counts as broken, and you must never infer a "
    "reason that is not explicitly stated:\n"
    "1. Fraud or an SEC investigation/enforcement action.\n"
    "2. An accounting restatement.\n"
    "3. An emergency, distress-driven, dilutive capital raise.\n"
    "4. A delisting notice or a going-concern warning.\n"
    "5. A guidance cut WITH SPECIFIC NUMBERS, or an earnings miss with guidance withdrawn.\n"
    "6. A CEO or CFO departure FOR CAUSE (fraud, misconduct, forced resignation) -- not a "
    "normal planned transition.\n"
    "7. Cancellation of a materially important contract.\n"
    "8. A reported quarterly contraction: revenue declining year-over-year AND net loss "
    "widening materially, BOTH from actual reported figures -- not analyst estimates, and not "
    "a mere growth deceleration that is still positive.\n"
    "If none of these 8 reasons appears explicitly in the news provided, the decline is "
    "FEAR-driven and passes the gate, even if the news sounds negative in tone or the headline "
    "cites a consensus miss. "
    'Respond ONLY in JSON: {"pasa": <true|false>, "motivo": "one-sentence reason in Spanish -- '
    'if pasa=false, name which of the 8 numbered reasons applies; if pasa=true, say briefly '
    'why none applies"}.'
)


def _user_prompt(ticker: str, nombre: str, noticias: list[str], *, ath: float,
                 entry_date: date, entry_price: float, caida_pct: float) -> str:
    # Contexto mínimo a propósito -- ATH, fecha/precio de entrada, % caída. NUNCA la tabla
    # histórica completa del ticker: eso sesgaría el veredicto (ver doc §3).
    noticias_txt = "\n".join(f"- {n}" for n in noticias) if noticias else "(no news found)"
    return (
        f"Ticker: {ticker} ({nombre})\n"
        f"All-time high: ${ath:.2f}\n"
        f"Signal date: {entry_date.isoformat()}\n"
        f"Price at signal: ${entry_price:.2f}\n"
        f"Decline from all-time high: {caida_pct:.1f}%\n\n"
        f"Recent news since the last confirmed peak:\n{noticias_txt}"
    )


def _finnhub_news(ticker: str, desde: date, hasta: date) -> list[str]:
    """Respaldo cuando el scraper de Yahoo no trae nada -- acota por fecha, cosa que el scraper
    de Yahoo no permite. Titular narrativo, nunca cifra de verdad sin contrastar: los consensos
    de Finnhub en titulares auto-generados pueden venir mal (verificado con OPEN Q2 2026)."""
    if not settings.finnhub_api_key:
        return []
    try:
        resp = httpx.get(
            "https://finnhub.io/api/v1/company-news",
            params={"symbol": ticker, "from": desde.isoformat(), "to": hasta.isoformat(),
                    "token": settings.finnhub_api_key},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json() or []
        return [str(it.get("headline", "")).strip() for it in items[:8] if it.get("headline")]
    except Exception:
        logger.warning("Finnhub sin noticias para %s.", ticker, exc_info=True)
        return []


def _noticias_para(ticker: str, desde: date, hasta: date) -> list[str]:
    """Yahoo (scraper propio, ya usado por el ranker fundamental) primario; Finnhub de respaldo
    cuando hace falta acotar por fecha y el scraper no trajo nada."""
    scraper = fundamentals._scraper_session()
    if scraper is not None:
        s, _crumb = scraper
        try:
            noticias = yahoo_scraper._noticias(s, ticker)
            if noticias:
                return noticias
        except Exception:
            logger.warning("Scraper de Yahoo sin noticias para %s.", ticker, exc_info=True)
    return _finnhub_news(ticker, desde, hasta)


@dataclass(frozen=True)
class GateResult:
    pasa: bool
    motivo: str


def evaluar(ticker: str, nombre: str, *, ath: float, entry_date: date, entry_price: float,
            caida_pct: float, desde: date) -> GateResult:
    """Evalúa UNA señal (la más reciente del ticker/candidato). `desde` acota la ventana de
    noticias -- el llamador pasa la fecha del último pico confirmado (zigzag) o una ventana
    razonable hacia atrás (suelo); cualquier earnings relevante cae dentro por construcción."""
    if not settings.deepseek_api_key:
        raise RuntimeError("Sin DEEPSEEK_API_KEY configurada: no se puede evaluar el gate.")
    noticias = _noticias_para(ticker, desde, date.today())
    llm = DeepSeekProvider(settings.deepseek_api_key, settings.llm_model,
                           base_url=settings.deepseek_base_url,
                           reasoning_effort="low", stage="momentum_gate")
    raw = llm.chat(SYSTEM, _user_prompt(ticker, nombre, noticias, ath=ath, entry_date=entry_date,
                                        entry_price=entry_price, caida_pct=caida_pct),
                   temperature=0.0)
    try:
        data = json.loads(raw)
        return GateResult(pasa=bool(data["pasa"]), motivo=str(data.get("motivo", "")))
    except (json.JSONDecodeError, KeyError) as exc:
        logger.error("Gate: respuesta no parseable para %s: %r", ticker, raw)
        raise RuntimeError(f"Respuesta del gate no parseable: {exc}") from exc
