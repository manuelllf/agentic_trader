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

# Los 11 ETFs sectoriales SPDR estuvieron aquí para meterle al macro un ranking
# de sectores por rentabilidad. Se quitaron enteros: era el último canal por el que una lectura
# sectorial llegaba a las ~3.000 llamadas de scoring (el macro la escribía en su texto y ese
# texto se inyecta en todas). El paper tampoco lo hace — su macro son indicadores y eventos, y
# el sector solo entra como "el sector de ESTA empresa" en el prompt de cada nombre, que sigue.


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
    """Estado de mercado: texto largo para el agente macro + LÍNEA COMPACTA para los scorings.

    Devuelve `(texto, titulares, compacto)`. El tercer elemento es el que viaja dentro de cada
    prompt de scoring (ver `outlook_prompt_block`) y existe por un fallo medido: el
    scorer puntuó a una minera de oro con un 78,43 y la tesis "con el oro en máximos" **sin un
    solo dato de oro en su prompt** — el bloque macro que recibe no contiene la palabra gold.
    Se lo sacó de su memoria de entrenamiento, y el oro estaba a un 18% de su máximo. Con el
    25% de la cartera encima. Ahora los niveles van como dato en cada llamada.

    SUBYACENTES, no ETFs. Antes el oro era GLD, el petróleo USO y el dólar
    UUP, y de ahí solo se publicaba un % a 3 meses. Dos problemas:
      · un NIVEL de GLD (398) no es el precio del oro (4.341): dárselo invita justo a la confusión
        que esto viene a evitar;
      · en el petróleo el ETF ni siquiera acierta el porcentaje — USO daba -12,6% a 3m cuando el
        WTI estaba en -17,5%, y 23% desde máximos cuando el real era 31%. Es la erosión por roll.
        Ese -12,6% incorrecto es el que vio el macro en un test real, y le hizo escribir "la
        reciente caída del petróleo" con el barril subiendo un 8,5% en el último mes.
    HYG se queda como ETF porque no hay índice de crédito gratuito, pero se etiqueta como tal y
    no se le publica el nivel: de un ETF de bonos el dato que informa es la distancia al máximo.
    """
    lines: list[str] = []
    # ^IRX (letra a 13 semanas) y HYG (crédito high yield) entran como DATO CRUDO, igual que el
    # resto: el 10 años solo no deja ver la pendiente de la curva, y no había ninguna referencia
    # de crédito. Se dan los números y ya — sin etiquetas del tipo "apetito de riesgo" ni
    # "suele girar antes": eso sería colarle al modelo una conclusión escrita por nosotros.
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

    def desde_max(c) -> float | None:
        """% por debajo del máximo de 52 semanas. Es DATO (dos números que ya tenemos), y para el
        oro es exactamente el que faltaba: sin él, "+5% en un mes" se lee como fuerza sin más."""
        mx = float(c.max())
        return (mx - float(c.iloc[-1])) / mx * 100 if mx else None

    compacto: list[str] = []
    # Índices + tendencia. La distancia al máximo del S&P es el dato de régimen más directo que
    # hay y tampoco estaba.
    for tk, label in (("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"), ("IWM", "Small caps")):
        c = close(tk)
        if c is not None and len(c) > 200:
            above = "sobre" if c.iloc[-1] > ta.sma(c, 200) else "bajo"
            dm = desde_max(c)
            lines.append(f"{label}: {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                         f"{ta.pct_change_ndays(c, 63):+.1f}% 3m, {above} MA200"
                         + (f", {dm:.0f}% del máximo de 52s" if dm is not None else ""))
    c = close("SPY")
    if c is not None:
        dm = desde_max(c)
        if dm is not None:
            compacto.append(f"S&P 500 {dm:.0f}% below its 52w high")
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
    # Nivel + 1m + 3m + distancia al máximo. El 1 mes faltaba y era el que más informaba: el oro
    # y el petróleo caen a 3 meses y SUBEN un 5% y un 8,5% en el último, que es el horizonte de
    # todas las decisiones del sistema.
    for tk, label, fmt in (("DX-Y.NYB", "USD index", "{:,.1f}"),
                           ("GC=F", "Gold", "{:,.0f}"),
                           ("CL=F", "Oil (WTI)", "{:,.2f}")):
        c = close(tk)
        if c is None:
            continue
        nivel = fmt.format(float(c.iloc[-1]))
        dm = desde_max(c)
        cola = f", {dm:.0f}% del máximo de 52s" if dm is not None else ""
        lines.append(f"{label}: {nivel} ({ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                     f"{ta.pct_change_ndays(c, 63):+.1f}% 3m{cola})")
        compacto.append(f"{label} {nivel}"
                        + (f" ({dm:.0f}% below 52w high," if dm is not None else " (")
                        + f" {ta.pct_change_ndays(c, 21):+.0f}% 1m)")
    c = close("HYG")
    if c is not None:
        dm = desde_max(c)
        lines.append(f"High yield credit (HYG ETF): {ta.pct_change_ndays(c, 21):+.1f}% 1m, "
                     f"{ta.pct_change_ndays(c, 63):+.1f}% 3m"
                     + (f", {dm:.0f}% del máximo de 52s" if dm is not None else ""))
        if dm is not None:
            compacto.append(f"High yield credit {dm:.0f}% below 52w high")

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
    "Write about these conditions only: "
    "do NOT name sectors or industries, and do not say which parts of the market you would favour "
    "or avoid. Be brief. "
    # Dos cosas que ANTES se le pedían y ya no (ver docs/backlog.md):
    #  · El REGIMEN: lo calcula gratis y determinista `get_macro_regime()` (VIX + SPY vs MA200).
    #    Pedírselo dejaba que el modelo pisara ese dato objetivo con su lectura — llegó a decir
    #    "neutral" con el VIX en 14,9, que la propia regla determinista no permite.
    #  · favored_sectors/avoided_sectors: NADIE los consumía (solo se guardaban en ScanRun), pero
    #    obligar al modelo a elegir sectores lo hace pensar en clave sectorial, y de ahí se le
    #    escapaba al texto del outlook ("favoreciendo sectores defensivos y de calidad") — que sí
    #    viaja a las ~3.000 llamadas de scoring. Se quita la pregunta, no solo la respuesta.
    # Los DOS idiomas en una sola llamada (~200 tokens de salida de más, una vez por escaneo).
    # El texto viaja a ~3.000 prompts que están en inglés: meter ahí un párrafo en español era la
    # única costura del sistema. El inglés va al prompt; el español, a la web y a la traza.
    'Respond ONLY in JSON: {"outlook_en": "...", "outlook_es": "..."}. Same content in both: '
    "English for downstream prompts, Spanish for the human-facing report."
)


def get_macro_outlook(llm: LLMProvider, db=None, temperature: float = 1.0,
                      top_p: float | None = 0.95) -> dict:  # noqa: ANN001
    """Outlook forward a 3 meses, con foco en el próximo (1 llamada V4-Pro). Cacheado por escaneo.

    `db` lo usan las fuentes de eventos para su caché persistente (ver `events.py`) y, ahora
    también, para inyectar la tesis del escaneo anterior (`_previous_outlook_block`): sin sesión
    funciona igual menos esa memoria, pero cada escaneo vuelve a pedirle a Wikipedia los 7 días
    enteros.
    """
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
    # Google News PRIMERO y GDELT de reserva (invertido tras comparar las dos salidas el mismo
    # día): GDELT tardó 25,4 s en traer 7 titulares de los que TRES eran el mismo
    # artículo de opinión republicado en tres diarios locales, y otro una pelea sobre el precio
    # de los burritos; Google News trajo 8 en 0,7 s, todos macro, de NBC/PBS/WSJ/Reuters. Además
    # GDELT devuelve 429 casi siempre. Se conserva como segunda fuente porque es keyless e
    # independiente y algún día fallará la primera, pero deja de ser la que se usa por defecto.
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
    """Compacta el macro para inyectarlo en cada prompt de scoring: VIX + texto del outlook.

    El whitepaper pasa el macro como "some macro-economic data for context" y lo que mete son
    DATOS (noticias de la semana, eventos, previsión de tipos). Por eso el VIX va como número y
    la etiqueta de régimen (risk-on/neutral/risk-off) NO: es una conclusión NUESTRA, calculada
    con un umbral discutible —14,9 fue la media del rally 2023-24, así que "risk-on" suena a
    euforia donde solo hay normalidad— y repetirla en ~3.000 prompts la convierte en premisa.
    Es el mismo motivo por el que se quitó el "fuerte→débil" de los sectores.

    La etiqueta se sigue calculando y guardando (web y `ScanRun`): ahí es telemetría que se puede
    contrastar después. Lo que deja de hacer es viajar dentro de cada scoring.

    El texto va en INGLÉS (`outlook_en`), como el resto del prompt: el modelo escribe el mismo
    outlook en los dos idiomas y el español se reserva para la web y la traza. Si no viniera el
    inglés (escaneos viejos, tests), cae al español antes que quedarse sin macro.

    Lleva además `market_line`: niveles de S&P, 10 años, dólar, oro, petróleo y
    crédito con su distancia al máximo de 52 semanas. Es DATO, y va porque su ausencia costó un
    error real — el scorer escribió "con el oro en máximos" y le puso un 78,43 a una minera de
    oro sin tener un solo dato de oro delante, con el oro a un 18% de máximos y esa posición
    pesando el 25% de la cartera. Lo que el modelo no recibe, se lo inventa de memoria. Los
    escaneos viejos no tienen la clave: el bloque queda entonces exactamente como antes.
    """
    if not macro:
        return "n/d"
    texto = macro.get("outlook_en") or macro.get("outlook", "")
    mercado = (macro.get("market_line") or "").strip()
    cabecera = f"VIX {macro.get('vix', 'n/d')}."
    if mercado:
        cabecera = f"{cabecera} {mercado}."
    return f"{cabecera}\n{texto}"
