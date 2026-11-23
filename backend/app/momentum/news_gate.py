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
import time
from dataclasses import dataclass
from datetime import date

import httpx

from app.config import settings
from app.llm import get_llm
from app.screener import noticias

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


def _noticias_para(ticker: str, nombre: str, desde: date, hasta: date) -> list[str]:
    """Google News acotado al tramo desde el último pico; Finnhub de respaldo si no trae nada."""
    t0 = time.monotonic()
    lista = noticias.titulares(ticker, nombre, desde=desde, hasta=hasta)
    logger.info("Gate %s: %d noticia(s) de Google News en %.1fs.", ticker, len(lista),
                time.monotonic() - t0)
    return lista or _finnhub_news(ticker, desde, hasta)


@dataclass(frozen=True)
class GateResult:
    pasa: bool
    motivo: str


def evaluar(ticker: str, nombre: str, *, ath: float, entry_date: date, entry_price: float,
            caida_pct: float, desde: date, recorder=None, provider: str = "deepseek") -> GateResult:
    """Evalúa UNA señal (la más reciente del ticker/candidato). `desde` acota la ventana de
    noticias -- el llamador pasa la fecha del último pico confirmado (zigzag) o una ventana
    razonable hacia atrás (suelo); cualquier earnings relevante cae dentro por construcción.

    `recorder`: objeto duck-typed con `.record(CallRecord)` (ver `app.llm.trace`) -- lo usa
    `gate_runner` para volcar la llamada en `momentum_gate_llamadas`. `None` = sin traza (tests).

    `provider`: "deepseek" o "qwen" -- selector MANUAL persistido (ver `gate_config.py`), no
    failover automático: si uno de los dos está caído (visto en vivo 14-sep-2026, apagón de
    DeepSeek), Manuel elige el otro desde la sala y se queda así hasta que lo cambie.
    """
    # Logs de cada fase, no solo del fallo final -- si algo se cuelga, `tail -f` tiene que decir
    # EN QUÉ paso está atascado en ese momento, no solo la excepción una vez ya abandonado
    # (visto en local 14-sep-2026: sin esto no había forma de saber si el cuelgue era noticias o
    # el LLM hasta que saltaba el techo duro de 90s).
    t0 = time.monotonic()
    logger.info("Gate %s: pidiendo noticias...", ticker)
    lista_noticias = _noticias_para(ticker, nombre, desde, date.today())
    logger.info("Gate %s: %d noticia(s) en %.1fs.", ticker, len(lista_noticias),
                time.monotonic() - t0)
    # Modelo/proveedor vía `get_llm()` (no `settings.llm_model`): ese ajuste es el default de
    # Alpha, pero cada escaneo de Alpha puede pisarlo con su propio modelo por etapa (pro, flash,
    # Qwen, lo que sea, ver "Configurar" en la sala). Omega usa su propio selector, independiente
    # del de Alpha. `enable_thinking=False` (Qwen) / `reasoning_effort="low"` (DeepSeek): de
    # sobra para una clasificación de una frase, y Qwen con razonamiento cuesta ~33x más.
    # `timeout` corto (no los 180s del escaneo): una llamada colgada 15 minutos (visto en
    # producción 14-sep-2026) dejaba a Manuel sin saber si reintentar o esperar -- 45s falla
    # rápido y avisa, en vez de bloquear en silencio.
    llm = get_llm(model="deepseek-flash" if provider == "deepseek" else None,
                 reasoning_effort="low", stage="momentum_gate", recorder=recorder,
                 provider=provider, enable_thinking=False, timeout=45.0)
    t1 = time.monotonic()
    logger.info("Gate %s: llamando a %s...", ticker, provider)
    prompt = _user_prompt(ticker, nombre, lista_noticias, ath=ath, entry_date=entry_date,
                          entry_price=entry_price, caida_pct=caida_pct)
    raw = llm.chat(SYSTEM, prompt, temperature=0.0)
    logger.info("Gate %s: respuesta de %s en %.1fs.", ticker, provider, time.monotonic() - t1)
    try:
        data = json.loads(raw)
        return GateResult(pasa=bool(data["pasa"]), motivo=str(data.get("motivo", "")))
    except (json.JSONDecodeError, KeyError) as exc:
        logger.error("Gate: respuesta no parseable para %s: %r", ticker, raw)
        raise RuntimeError(f"Respuesta del gate no parseable: {exc}") from exc
