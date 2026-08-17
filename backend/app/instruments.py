"""Instrumentos UCITS (constructor elige libremente; no se puntúan).

Vacío a propósito: el constructor solo elige entre las acciones puntuadas, sin ETFs/bonos
de refugio — decisión de producto, no un límite técnico (`prices()`/`prompt_block()` ya
toleraban un allowlist vacío).
"""

from __future__ import annotations

import yfinance as yf

# symbol (yfinance, LSE .L) → etiqueta corta para el prompt.
ALLOWLIST: dict[str, str] = {}


def prices() -> dict[str, float]:
    """Precio actual (USD) de cada instrumento del allowlist. {} si está vacío o algo falla."""
    out: dict[str, float] = {}
    for sym in ALLOWLIST:
        try:
            info = yf.Ticker(sym).info or {}
            px = (info.get("currentPrice") or info.get("regularMarketPrice")
                  or info.get("previousClose"))
            if px:
                out[sym] = float(px)
        except Exception:
            continue
    return out


def prompt_block(available: dict[str, float]) -> str:
    """Bloque para el prompt del constructor con los instrumentos disponibles ('' si ninguno)."""
    if not available:
        return ""
    lines = "\n".join(f"- {sym}: {ALLOWLIST[sym]}" for sym in available)
    return ("\n\nUCITS instruments also available (ETFs/bonds/TIPS/cash-like, no score) — you may "
            f"allocate to them like any other candidate:\n{lines}")
