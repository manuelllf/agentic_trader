"""Contexto macro — régimen determinista + outlook forward escrito por el LLM.

Dos funciones:
- `get_macro_regime()`: barato, sin LLM (SPY vs MA200 + VIX → risk-on/neutral/risk-off). Para el
  endpoint /macro y como fallback.
- `get_macro_outlook(llm)`: como el paper (Exhibit 2C/2D) — snapshot GRATIS (índices, VIX, tipos
  10a, dólar, ETFs sectoriales, oro/petróleo) + titulares yfinance + EVENTOS reales keyless
  (Wikipedia Current Events, que usa el paper + titulares macro de GDELT) → V4-Pro escribe el
  outlook a 3 meses + tilt sectorial. Todo gratis y sin API key; las fuentes son best-effort.
"""

from __future__ import annotations

import json
import logging
import time

import yfinance as yf

from app.llm.base import LLMProvider
from app.screener import technicals as ta

logger = logging.getLogger(__name__)

_TTL = 600
_regime_cache: tuple[float, dict] | None = None
_outlook_cache: tuple[float, dict] | None = None

_SECTOR_ETFS = {
    "XLK": "Technology", "XLC": "Communications", "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples", "XLE": "Energy", "XLF": "Financials",
    "XLV": "Healthcare", "XLI": "Industrials", "XLB": "Materials",
    "XLRE": "Real Estate", "XLU": "Utilities",
}


def get_macro_regime() -> dict:
    global _regime_cache
    now = time.time()
    if _regime_cache is not None and now - _regime_cache[0] < _TTL:
        return _regime_cache[1]

    regime = {"regime": "desconocido", "spy_above_ma200": None, "vix": None}
    try:
        spy = yf.Ticker("SPY").history(period="1y")["Close"].dropna()
        above = bool(spy.iloc[-1] > ta.sma(spy, 200))
        vix = float(yf.Ticker("^VIX").history(period="5d")["Close"].dropna().iloc[-1])
        if above and vix < 18:
            label = "risk-on"
        elif (not above) or vix > 28:
            label = "risk-off"
        else:
            label = "neutral"
        regime = {"regime": label, "spy_above_ma200": above, "vix": round(vix, 1)}
        _regime_cache = (now, regime)
    except Exception:
        logger.exception("Cálculo de régimen macro falló")
    return regime


def _snapshot_text() -> tuple[str, list[str]]:
    """Texto legible del estado de mercado + ranking de sectores por retorno ~3m (gratis)."""
    lines: list[str] = []
    tickers = ["SPY", "QQQ", "IWM", "^VIX", "^TNX", "UUP", "GLD", "USO", *_SECTOR_ETFS]
    try:
        df = yf.download(tickers, period="1y", interval="1d", auto_adjust=True,
                         group_by="ticker", threads=True, progress=False)
    except Exception:
        return "n/d", []

    def close(tk: str):
        try:
            return df[tk]["Close"].dropna()
        except Exception:
            return None

    # Índices + tendencia.
    for tk, label in (("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"), ("IWM", "Small caps")):
        c = close(tk)
        if c is not None and len(c) > 200:
            above = "sobre" if c.iloc[-1] > ta.sma(c, 200) else "bajo"
            lines.append(f"{label}: {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                         f"{ta.pct_change_ndays(c, 63):+.1f}% 3m, {above} MA200")
    vix = close("^VIX")
    if vix is not None:
        lines.append(f"VIX: {float(vix.iloc[-1]):.1f}")
    tnx = close("^TNX")
    if tnx is not None:
        # ^TNX ya viene en % (4.54 = 4.54%), NO multiplicado por 10. Nada de dividir.
        lines.append(f"10y yield: {float(tnx.iloc[-1]):.2f}% "
                     f"({ta.pct_change_ndays(tnx, 21):+.1f}% 1m)")
    for tk, label in (("UUP", "USD"), ("GLD", "Gold"), ("USO", "Oil")):
        c = close(tk)
        if c is not None:
            lines.append(f"{label}: {ta.pct_change_ndays(c, 63):+.1f}% 3m")

    # Ranking de sectores por retorno 3m (para el tilt).
    sector_ret: list[tuple[str, float]] = []
    for etf, name in _SECTOR_ETFS.items():
        c = close(etf)
        if c is not None and len(c) > 63:
            sector_ret.append((name, ta.pct_change_ndays(c, 63)))
    sector_ret.sort(key=lambda x: -x[1])
    ranked = [f"{n} {r:+.0f}%" for n, r in sector_ret]
    if ranked:
        lines.append("Sectores (retorno 3m, fuerte→débil): " + ", ".join(ranked))

    headlines: list[str] = []
    try:
        for item in (yf.Ticker("SPY").news or [])[:6]:
            t = item.get("title") or (item.get("content") or {}).get("title")
            if t:
                headlines.append(t.strip())
    except Exception:
        pass
    return "\n".join(lines), headlines


_SYSTEM = (
    "You are a macro strategist. From the market snapshot, recent market headlines, and recent "
    "real-world economic & political events, write a concise 3-month forward outlook for US "
    "equities: your expectation for interest rates, inflation, the key upcoming economic/political "
    "events and their likely market impact, and risk appetite; and WHICH SECTORS you favor vs "
    "avoid for the next 1-3 months. Give your own view, not just what the market expects. Be brief "
    "and decisive. Respond ONLY in JSON: "
    '{"regime": "risk-on|neutral|risk-off", "outlook": "...", "favored_sectors": ["..."], '
    '"avoided_sectors": ["..."]}. Write the outlook text in Spanish.'
)


def get_macro_outlook(llm: LLMProvider) -> dict:
    """Outlook forward a 3 meses + tilt sectorial (1 llamada V4-Pro). Cacheado por escaneo."""
    global _outlook_cache
    now = time.time()
    if _outlook_cache is not None and now - _outlook_cache[0] < _TTL:
        return _outlook_cache[1]

    regime = get_macro_regime()
    snapshot, headlines = _snapshot_text()
    # Eventos/noticias GRATIS y keyless (fiel al Exhibit 2C/2D). Best-effort: si caen, se omiten.
    from app.screener import events as events_mod
    wiki_events = events_mod.wikipedia_current_events(days=7)      # eventos recientes macro
    wiki_scheduled = events_mod.wikipedia_scheduled_events()       # calendario FUTURO (Exhibit 2D)
    gdelt = events_mod.gdelt_headlines()
    result = {
        "regime": regime.get("regime"),
        "vix": regime.get("vix"),
        "outlook": "",
        "favored_sectors": [],
        "avoided_sectors": [],
        "snapshot": snapshot,
        # Qué trajo cada fuente de eventos (chars/títulos): el informe del escaneo lo usa para
        # avisar de fuentes caídas — un 403/rate-limit aquí es best-effort y no rompe nada,
        # pero debe VERSE (estuvo semanas mudo).
        "events": {"wiki": len(wiki_events), "sched": len(wiki_scheduled), "gdelt": len(gdelt)},
    }
    try:
        all_headlines = headlines + gdelt
        user = (
            f"Market snapshot:\n{snapshot}\n\n"
            f"Recent market headlines:\n" + "\n".join(f"- {h}" for h in all_headlines) + "\n\n"
            f"Recent real-world events (economic & political, last 7 days):\n"
            f"{wiki_events or 'n/d'}\n\n"
            f"Upcoming scheduled events (economic & political calendar):\n"
            f"{wiki_scheduled or 'n/d'}\n\n"
            "Write the 3-month forward outlook and sector tilt, taking these events into account."
        )
        raw = llm.chat(_SYSTEM, user, temperature=0.3)
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        result["outlook"] = str(data.get("outlook", "")).strip()
        result["favored_sectors"] = list(data.get("favored_sectors", []))[:6]
        result["avoided_sectors"] = list(data.get("avoided_sectors", []))[:6]
        if data.get("regime"):
            result["regime"] = str(data["regime"])
        _outlook_cache = (now, result)
    except Exception:
        logger.exception("Outlook macro LLM falló → uso solo el régimen determinista")
    return result


def outlook_prompt_block(macro: dict) -> str:
    """Compacta el macro para inyectarlo en cada prompt de scoring."""
    if not macro:
        return "n/d"
    fav = ", ".join(macro.get("favored_sectors", [])) or "n/d"
    avoid = ", ".join(macro.get("avoided_sectors", [])) or "n/d"
    return (
        f"Regime: {macro.get('regime', 'n/d')} (VIX {macro.get('vix', 'n/d')}). "
        f"Sector backdrop (CONTEXT, not a mandate) — tailwinds: {fav}; headwinds: {avoid}.\n"
        f"{macro.get('outlook', '')}"
    )
