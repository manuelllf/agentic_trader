"""Instrumentos UCITS que el constructor puede usar ADEMÁS de las acciones (Exhibit 2E del paper).

SOLO UCITS europeos (comprables desde España; los ETF US no lo son, PRIIPs/MiFID) y a propósito en
USD (el libro habla USD → sin FX extra). El constructor elige LIBREMENTE de esta lista; NO se
puntúan (no pasan por el scorer): se ofrecen como instrumentos siempre disponibles, igual que el
menú de ETF/bonos/TIPS del prompt del paper. Precio vía yfinance con el símbolo de LSE (sufijo .L).

VACÍO por defecto = comportamiento actual (solo acciones). Rellenar SOLO con símbolos verificados:
precio USD real en yfinance Y conid comprable en la cuenta IBKR EU — esto último hace falta para el
LIVE (el broker actual resuelve solo acciones US, ver backlog). Candidatos verificados en yfinance
(USD): CSPX.L (S&P 500), IDTL.L (Treasury 20+ años), IB01.L (Treasury 0-1 año, cuasi-liquidez).
"""

from __future__ import annotations

import yfinance as yf

# symbol (yfinance, LSE .L) → etiqueta corta para el prompt. Vacío = desactivado.
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
