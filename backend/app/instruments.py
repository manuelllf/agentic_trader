"""Instrumentos UCITS que el constructor puede usar ADEMÁS de las acciones (Exhibit 2E del paper).

SOLO UCITS europeos (comprables desde España; los ETF US no lo son, PRIIPs/MiFID) y a propósito en
USD (el libro habla USD → sin FX extra). El constructor elige LIBREMENTE de esta lista; NO se
puntúan (no pasan por el scorer): se ofrecen como instrumentos siempre disponibles, igual que el
menú de ETF/bonos/TIPS del prompt del paper. Precio vía yfinance con el símbolo de LSE (sufijo .L).

Poblado (16-ago) con las categorías del Exhibit 2E ("market, sectors, TIPS, and long and short-
term bonds") — precio USD verificado en vivo contra yfinance ese mismo día. OJO: el conid
comprable en la cuenta IBKR EU sigue pendiente (backlog) — el broker actual solo resuelve acciones
US, así que esto ya afecta a la sombra/observatorio (donde el constructor puede elegirlos) pero NO
se podrá ejecutar de verdad en la cuenta real hasta que ese hueco se cierre. Si el constructor
asigna peso a uno de estos en un escaneo que DECIDE, la aprobación de la cuenta real quedará mal
hasta entonces — vigilar el primer escaneo que los use.
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
