"""Instrumentos UCITS (constructor elige libremente; no se puntúan).

UCITS europeos USD (sin FX extra). Exhibit 2E: market/sectores/TIPS/bonos.
NOTA: conid IBKR pendiente (backlog) — ejecuta sombra, no cuenta real aún.
"""

from __future__ import annotations

import yfinance as yf

# symbol (yfinance, LSE .L) → etiqueta corta para el prompt.
ALLOWLIST: dict[str, str] = {
    "CSPX.L": "S&P 500 (market)",
    "IDTL.L": "Treasury 20+y (long bond)",
    "IB01.L": "Treasury 0-1y (short bond, cuasi-liquidez)",
    "TIP5.L": "TIPS 0-5y (inflation-linked)",
    "IUIT.L": "S&P 500 Technology sector",
    "IUFS.L": "S&P 500 Financials sector",
    "IUHC.L": "S&P 500 Health Care sector",
    "IUES.L": "S&P 500 Energy sector",
    "IUCD.L": "S&P 500 Consumer Discretionary sector",
    "IUCS.L": "S&P 500 Consumer Staples sector",
    "IUUS.L": "S&P 500 Utilities sector",
}


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
