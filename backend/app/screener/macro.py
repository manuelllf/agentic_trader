"""Contexto macro — régimen determinista + outlook forward escrito por el LLM.

Dos funciones:
- `get_macro_regime()`: barato, sin LLM (SPY vs MA200 + VIX → risk-on/neutral/risk-off). Para el
  endpoint /macro y como fallback.
- `get_macro_outlook(llm)`: como el paper (Exhibit 2C/2D) — snapshot GRATIS (índices, VIX, tipos
  10a y 3m, dólar, oro/petróleo, crédito) + titulares yfinance + EVENTOS reales keyless
  (Wikipedia Current Events, que usa el paper, + titulares macro) → el LLM escribe el outlook a
  3 meses EN LOS DOS IDIOMAS: el inglés viaja a los prompts de scoring, el español a la web.
  Sin tilt sectorial y sin etiqueta de régimen (ver `_SYSTEM`). Todo gratis y sin API key.
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

# SPDR sectoriales quitados: último canal de sesgo sectorial en scoring.
# Macro ahora solo indicadores/eventos; sector entra por nombre, no por ranking global.


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


def _snapshot_text() -> tuple[str, list[str], str]:
    """Estado de mercado: texto largo (macro), lista de headlines, y línea compacta (scoring).
    Tercer elemento viaja en cada prompt scoring con niveles de mercado clave."""
    # SUBYACENTES vs ETFs: nivel exacto, no erosión roll. HYG etiquetado sin nivel.
    lines: list[str] = []
    # ^IRX (3m) y HYG (high yield): datos crudos sin interpretación ("apetito", "giro") — dato sí, conclusión no.
    tickers = ["SPY", "QQQ", "IWM", "^VIX", "^TNX", "^IRX",
               "DX-Y.NYB", "GC=F", "CL=F", "HYG"]
    try:
        df = yf.download(tickers, period="1y", interval="1d", auto_adjust=True,
                         group_by="ticker", threads=True, progress=False)
    except Exception:
        return "n/d", [], ""

    def close(tk: str):
        try:
            c = df[tk]["Close"].dropna()
            return c if len(c) else None
        except Exception:
            return None

    compacto: list[str] = []
    # Índices + tendencia. Sin distancia al máximo de 52s: el paper (Exhibit 2C/2D) no mete
    # datos de precio en el macro, solo noticias/eventos — y esa distancia es la misma métrica
    # de momentum que el sesgo hacia ATH lee como "fortaleza" en cada uno de los ~2.600+ prompts
    # a los que viaja `compacto`.
    for tk, label in (("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"), ("IWM", "Small caps")):
        c = close(tk)
        if c is not None and len(c) > 200:
            above = "sobre" if c.iloc[-1] > ta.sma(c, 200) else "bajo"
            lines.append(f"{label}: {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                         f"{ta.pct_change_ndays(c, 63):+.1f}% 3m, {above} MA200")
    vix = close("^VIX")
    if vix is not None:
        lines.append(f"VIX: {float(vix.iloc[-1]):.1f}")
    # ^TNX y ^IRX ya vienen en % (4.54 = 4.54%), NO multiplicados por 10. Nada de dividir.
    for tk, label in (("^IRX", "3m T-bill yield"), ("^TNX", "10y yield")):
        c = close(tk)
        if c is not None:
            lines.append(f"{label}: {float(c.iloc[-1]):.2f}% "
                         f"({ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                         f"{ta.pct_change_ndays(c, 63):+.1f}% 3m)")
    c = close("^TNX")
    if c is not None:
        compacto.append(f"10y yield {float(c.iloc[-1]):.2f}%")
    # Nivel + 1m + 3m. 1 mes es el horizonte de decisión del sistema.
    for tk, label, fmt in (("DX-Y.NYB", "USD index", "{:,.1f}"),
                           ("GC=F", "Gold", "{:,.0f}"),
                           ("CL=F", "Oil (WTI)", "{:,.2f}")):
        c = close(tk)
        if c is None:
            continue
        nivel = fmt.format(float(c.iloc[-1]))
        lines.append(f"{label}: {nivel} ({ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                     f"{ta.pct_change_ndays(c, 63):+.1f}% 3m)")
        compacto.append(f"{label} {nivel} ({ta.pct_change_ndays(c, 21):+.0f}% 1m)")
    c = close("HYG")
    if c is not None:
        lines.append(f"High yield credit (HYG ETF): {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                     f"{ta.pct_change_ndays(c, 63):+.1f}% 3m")

    headlines: list[str] = []
    try:
        for item in (yf.Ticker("SPY").news or [])[:6]:
            t = item.get("title") or (item.get("content") or {}).get("title")
            if t:
                headlines.append(t.strip())
    except Exception:
        pass
    return "\n".join(lines), headlines, ". ".join(compacto)


_SYSTEM = (
    "You are a macro strategist. From the market snapshot, recent market headlines, and recent "
    "real-world economic & political events, write a concise 3-month forward outlook for US "
    # `tariffs` es literal del Exhibit 2D, que pide una tabla de previsiones de "interest rates,
    # inflation, tariffs, and other economic events". Se pedían los dos primeros y no el tercero.
    "equities: your expectation for interest rates, inflation, tariffs, the key upcoming "
    "economic/political events and their likely market impact, and risk appetite. "
    # "Pay special attention to the next month" es literal del 2D y nos faltaba: TODO lo que
    # decide el sistema es a un mes (la nota, el objetivo, el rebalanceo) y este era el único
    # eslabón que miraba a tres sin distinguir el tramo que de verdad importa. Es un horizonte,
    # no una inclinación.
    "PAY SPECIAL ATTENTION TO THE NEXT MONTH: it is the horizon of every decision this outlook "
    "feeds. "
    # En su momento se quitó "Give your own view, not just what the market expects" por sesgo. Era
    # paper —2D: "Not only what analysts and the market expect"— y quitarla entera fue pasarse.
    # Vuelve con las dos correcciones que le faltaban: acotada al PRONÓSTICO (no a qué partes del
    # mercado favorecer, que sigue prohibido tres líneas más abajo) y con el contrapeso que el
    # paper sí tiene y nosotros no teníamos: *comparar* con lo que espera el mercado. Pedir un
    # diferencial obliga a enunciar las dos cifras; pedir "tu opinión" a secas, no.
    "For those forecasts give your own expectation - grounded in the data and events above, not "
    "only what analysts and the market expect - and say where the two differ. "
    # Literal del 2D ("I also want a table with your forecast for interest rates, inflation,
    # tariffs, and other economic events for the next month and quarter"): antes solo pedíamos
    # prosa cubriendo esos temas, sin la tabla explícita a los dos horizontes. Se pide como texto
    # dentro del mismo campo (no una clave JSON nueva) para no tocar `outlook_prompt_block` ni
    # el esquema que ya consumen ~3.000 prompts — solo cambia CUÁNTO detalle estructurado trae
    # el texto que ya viajaba.
    "Include a compact forecast table for interest rates, inflation and tariffs, each with your "
    "own 1-month AND 3-month forecast plus the market/consensus expectation for comparison. "
    "Write about these conditions only: "
    "do NOT name sectors or industries, and do not say which parts of the market you would favour "
    "or avoid. Be brief. "
    # REGIMEN y favored/avoided_sectors ya no se piden: el primero lo calcula determinista
    # get_macro_regime(); los segundos escapaban al outlook text llevando sesgo a ~3.000 scorings.
    # Los DOS idiomas en una sola llamada (~200 tokens de salida de más, una vez por escaneo).
    # El texto viaja a ~3.000 prompts que están en inglés: meter ahí un párrafo en español era la
    # única costura del sistema. El inglés va al prompt; el español, a la web y a la traza.
    'Respond ONLY in JSON: {"outlook_en": "...", "outlook_es": "..."}. Same content in both: '
    "English for downstream prompts, Spanish for the human-facing report."
)


def get_macro_outlook(llm: LLMProvider, db=None, temperature: float = 1.0,
                      top_p: float | None = 0.95) -> dict:  # noqa: ANN001
    """Outlook a 3 meses (foco en próximo mes): 1 llamada V4-Pro, cacheado por escaneo.
    `db` persiste caché de eventos y sesión; sin DB, re-consulta Wikipedia cada vez."""
    global _outlook_cache
    now = time.time()
    if _outlook_cache is not None and now - _outlook_cache[0] < _TTL:
        return _outlook_cache[1]

    regime = get_macro_regime()
    snapshot, headlines, market_line = _snapshot_text()
    # Eventos/noticias GRATIS y keyless (fiel al Exhibit 2C/2D). Best-effort: si caen, se omiten.
    from app.screener import events as events_mod
    wiki_events = events_mod.wikipedia_current_events(days=7, db=db)   # eventos recientes macro
    wiki_scheduled = events_mod.wikipedia_scheduled_events(db=db)      # calendario FUTURO (2D)
    # Google News principal (0.7s, on-topic); GDELT reserva (keyless, 25s, a veces ruido y 429).
    # GDELT cae atrás como fallback a primera fuente.
    gnews = events_mod.google_news_headlines(db=db)
    gdelt = events_mod.gdelt_headlines(db=db) if not gnews else []
    result = {
        "regime": regime.get("regime"),
        "vix": regime.get("vix"),
        "outlook": "",        # español: web, informe y traza
        "outlook_en": "",     # inglés: es el que viaja a los ~3.000 prompts de scoring
        # Se mantienen SIEMPRE vacíos: ya no se le piden al modelo (ver `_SYSTEM`). Las claves
        # siguen aquí porque `ScanRun` las persiste y los escaneos viejos sí las traen — así las
        # filas históricas se leen igual y ninguna lectura se rompe.
        "favored_sectors": [],
        "avoided_sectors": [],
        "snapshot": snapshot,
        # Línea compacta de niveles de mercado que viaja DENTRO de cada prompt de scoring. El
        # texto del outlook lo escribe el modelo y no se le puede obligar a citar el oro; esto es
        # el dato, siempre, sin depender de qué le pareciera relevante al agente macro.
        "market_line": market_line,
        # Qué trajo cada fuente de eventos (chars/títulos): el informe del escaneo lo usa para
        # avisar de fuentes caídas — un 403/rate-limit aquí es best-effort y no rompe nada,
        # pero debe VERSE (estuvo semanas mudo).
        "events": {"wiki": len(wiki_events), "sched": len(wiki_scheduled), "gdelt": len(gdelt),
                   "gnews": len(gnews)},
    }
    try:
        all_headlines = headlines + gdelt + gnews
        user = (
            f"Market snapshot:\n{snapshot}\n\n"
            f"Recent market headlines:\n" + "\n".join(f"- {h}" for h in all_headlines) + "\n\n"
            f"Recent real-world events (economic & political, last 7 days):\n"
            f"{wiki_events or 'n/d'}\n\n"
            f"Upcoming scheduled events (economic & political calendar):\n"
            f"{wiki_scheduled or 'n/d'}\n\n"
            + "Write the 3-month forward outlook, taking these events into account, with special "
              "attention to the next month."
        )
        raw = llm.chat(_SYSTEM, user, temperature=temperature, top_p=top_p)
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        # Si el modelo devolviera solo uno de los dos idiomas, cada campo cae al que haya: mejor
        # un prompt con el idioma "equivocado" que un macro vacío en ~3.000 llamadas.
        es = str(data.get("outlook_es") or data.get("outlook") or "").strip()
        en = str(data.get("outlook_en") or "").strip()
        result["outlook"] = es or en
        result["outlook_en"] = en or es
        _outlook_cache = (now, result)
    except Exception:
        logger.exception("Outlook macro LLM falló → uso solo el régimen determinista")
    return result


def outlook_prompt_block(macro: dict) -> str:
    """Inyecta VIX + outlook en cada scoring (sin etiqueta régimen: dato sí, conclusión no).
    Incluye market_line niveles clave para evitar que modelo se los invente."""
    if not macro:
        return "n/d"
    texto = macro.get("outlook_en") or macro.get("outlook", "")
    mercado = (macro.get("market_line") or "").strip()
    cabecera = f"VIX {macro.get('vix', 'n/d')}."
    if mercado:
        cabecera = f"{cabecera} {mercado}."
    return f"{cabecera}\n{texto}"
