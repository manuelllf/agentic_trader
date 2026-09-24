"""Contexto macro — régimen determinista + bloque común para los prompts, sin LLM.

- `get_macro_regime()`: SPY vs MA200 + VIX → risk-on/neutral/risk-off. Para /macro y la traza.
- `get_macro(db)`: datos de mercado de Yahoo, eventos de Wikipedia (recientes y calendario) y
  titulares macro, tal cual. Sin previsión: un resumen escrito por un LLM encadenaba narrativa
  hacia sectores enteros (docs/plan-jev-pipeline.md, test P3/P3b).
- `bloque_macro(macro, con_contexto)`: solo datos (B) o datos + eventos + titulares (E).
"""

from __future__ import annotations

import logging
import time

import yfinance as yf

from app.screener import technicals as ta

logger = logging.getLogger(__name__)

_TTL = 600
_regime_cache: tuple[float, dict] | None = None


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


def _datos_mercado() -> str:
    """Línea de datos (B). Sin petróleo, MA200 ni distancia al máximo: viajan en cada prompt y
    empujaban hacia un sector o hacia lo que ya había subido."""
    tickers = ["SPY", "QQQ", "IWM", "^VIX", "^TNX", "^IRX", "DX-Y.NYB", "GC=F", "HYG"]
    try:
        df = yf.download(tickers, period="1y", interval="1d", auto_adjust=True,
                         group_by="ticker", threads=True, progress=False)
    except Exception:
        logger.exception("Descarga de datos macro falló")
        return ""

    def close(tk: str):
        try:
            c = df[tk]["Close"].dropna()
            return c if len(c) > 63 else None
        except Exception:
            return None

    def pp(c, n: int) -> float:
        return float(c.iloc[-1]) - float(c.iloc[-1 - n])

    partes: list[str] = []
    c = close("^VIX")
    if c is not None:
        partes.append(f"VIX {float(c.iloc[-1]):.1f}.")
    # ^TNX y ^IRX ya vienen en % (4.54 = 4.54%): el cambio va en puntos, no en % del nivel.
    for tk, label in (("^TNX", "10y yield"), ("^IRX", "3m T-bill yield")):
        c = close(tk)
        if c is not None:
            partes.append(f"{label} {float(c.iloc[-1]):.2f}% ({pp(c, 21):+.2f} pp 1m, "
                          f"{pp(c, 63):+.2f} pp 3m).")
    for tk, label, fmt in (("DX-Y.NYB", "USD index", "{:,.1f}"), ("GC=F", "Gold", "{:,.0f}")):
        c = close(tk)
        if c is not None:
            partes.append(f"{label} {fmt.format(float(c.iloc[-1]))} "
                          f"({ta.pct_change_ndays(c, 21):+.0f}% 1m).")
    for tk, label in (("HYG", "High yield credit (HYG ETF)"), ("SPY", "S&P 500"),
                      ("QQQ", "Nasdaq 100"), ("IWM", "Small caps")):
        c = close(tk)
        if c is not None:
            partes.append(f"{label} {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                          f"{ta.pct_change_ndays(c, 63):+.1f}% 3m.")

    if not partes:
        logger.warning("Datos macro vacíos: Yahoo no devolvió series utilizables")
    return " ".join(partes)


def get_macro(db=None) -> dict:  # noqa: ANN001
    """Todo lo que alimenta el bloque macro de un escaneo. `db` cachea los eventos en `Meta`."""
    from app.screener import events as events_mod

    regime = get_macro_regime()
    datos = _datos_mercado()
    wiki_events = events_mod.wikipedia_current_events(days=7, db=db)
    wiki_scheduled = events_mod.wikipedia_scheduled_events(db=db)
    # Google News principal; GDELT solo de reserva (lento, a veces ruido y 429).
    gnews = events_mod.google_news_headlines(db=db)
    gdelt = events_mod.gdelt_headlines(db=db) if not gnews else []
    return {
        "regime": regime.get("regime"),
        "vix": regime.get("vix"),
        "datos": datos,
        # Qué trajo cada fuente: el informe del escaneo avisa de las caídas.
        "events": {"wiki": len(wiki_events), "sched": len(wiki_scheduled), "gdelt": len(gdelt),
                   "gnews": len(gnews)},
        "macro_headlines": {"gnews": gnews, "gdelt": gdelt},
        "wiki_events_text": wiki_events,
        "wiki_scheduled_text": wiki_scheduled,
    }


def bloque_macro(macro: dict, con_contexto: bool = True) -> str:
    """B = solo datos; E = datos + calendario + eventos de 7 días + titulares, en crudo."""
    partes = [macro.get("datos") or "n/d"]
    if con_contexto:
        if macro.get("wiki_scheduled_text"):
            partes.append("Scheduled events (calendar):\n" + macro["wiki_scheduled_text"].strip())
        if macro.get("wiki_events_text"):
            partes.append("Recent events (last 7 days):\n" + macro["wiki_events_text"].strip())
        titulares = [h for fuente in ("gdelt", "gnews")
                     for h in (macro.get("macro_headlines") or {}).get(fuente) or []]
        if titulares:
            partes.append("Recent market headlines:\n" + "\n".join(f"- {h}" for h in titulares))
    return "\n".join(partes)
