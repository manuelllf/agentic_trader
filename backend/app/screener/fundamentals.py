"""Datos por nombre para el scorer (método whitepaper DeepSeek).

Junta lo que el paper mete en el prompt de puntuación: los fundamentales de yfinance `.info`
(las ~97 variables SON este dict: valoración, márgenes, crecimiento, balance, short interest,
targets de analistas, propiedad, riesgo de gobernanza), técnicos SOLO como contexto
(MA50/200, 52 semanas, RSI, beta), la próxima fecha de resultados (dato, no regla) y
titulares recientes. Todo gratis (yfinance).

Tolerante a huecos: como el paper, "usamos la información más reciente disponible" — lo que
falte va como `n/d` y el LLM lo maneja (nada de excluir por dato incompleto).
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from datetime import UTC, datetime

import yfinance as yf

from app.screener import technicals as ta

_FUND_CACHE_TTL_H = 12.0   # ver `FundamentalsCache` en models.py para el motivo


def _cache_get(db, ticker: str) -> NameData | None:  # noqa: ANN001
    from app.models import FundamentalsCache

    row = db.get(FundamentalsCache, ticker)
    if not row:
        return None
    # SQLite devuelve `row.at` naive pese a DateTime(timezone=True) — mismo patrón que
    # watchlist.py::_aware().
    at = row.at if row.at.tzinfo is not None else row.at.replace(tzinfo=UTC)
    edad_h = (datetime.now(UTC) - at).total_seconds() / 3600
    if edad_h >= _FUND_CACHE_TTL_H:
        return None
    try:
        return NameData(**row.data)
    except TypeError:
        return None   # forma vieja del dataclass (campo añadido/quitado) — se ignora, no rompe


def _cache_put(db, ticker: str, data: NameData) -> None:  # noqa: ANN001
    from app.models import FundamentalsCache

    payload = dataclasses.asdict(data)
    row = db.get(FundamentalsCache, ticker)
    if row:
        row.at, row.data = datetime.now(UTC), payload
    else:
        db.add(FundamentalsCache(ticker=ticker, data=payload))
    db.commit()

# Variables fundamentales relevantes de .info (mapean a la lista del Exhibit 2B del paper).
# (info_key, etiqueta, tipo) — tipo: pct (ratio 0-1→%), cur (grande→$B), num (tal cual).
_FUNDAMENTAL_FIELDS: list[tuple[str, str, str]] = [
    ("marketCap", "Market cap", "cur"),
    ("enterpriseValue", "Enterprise value", "cur"),
    ("trailingPE", "P/E (trailing)", "num"),
    ("forwardPE", "P/E (forward)", "num"),
    ("priceToSalesTrailing12Months", "P/S", "num"),
    ("priceToBook", "P/B", "num"),
    ("enterpriseToRevenue", "EV/Revenue", "num"),
    ("enterpriseToEbitda", "EV/EBITDA", "num"),
    ("pegRatio", "PEG", "num"),
    ("profitMargins", "Profit margin", "pct"),
    ("grossMargins", "Gross margin", "pct"),
    ("operatingMargins", "Operating margin", "pct"),
    ("ebitdaMargins", "EBITDA margin", "pct"),
    ("returnOnAssets", "ROA", "pct"),
    ("returnOnEquity", "ROE", "pct"),
    ("revenueGrowth", "Revenue growth (YoY)", "pct"),
    ("earningsGrowth", "Earnings growth", "pct"),
    ("earningsQuarterlyGrowth", "Earnings growth (Q)", "pct"),
    ("totalRevenue", "Revenue", "cur"),
    ("ebitda", "EBITDA", "cur"),
    ("totalCash", "Total cash", "cur"),
    ("totalDebt", "Total debt", "cur"),
    ("freeCashflow", "Free cash flow", "cur"),
    ("operatingCashflow", "Operating cash flow", "cur"),   # + Exhibit 2B (paper)
    ("netIncomeToCommon", "Net income", "cur"),
    ("trailingEps", "EPS (trailing)", "num"),
    ("forwardEps", "EPS (forward)", "num"),
    ("bookValue", "Book value/share", "num"),
    ("revenuePerShare", "Revenue/share", "num"),
    ("totalCashPerShare", "Cash/share", "num"),
    ("52WeekChange", "52w price change", "pct"),
    ("SandP52WeekChange", "S&P 500 52w change", "pct"),    # fuerza relativa vs índice
    ("fiveYearAvgDividendYield", "Div yield (5y avg)", "yld"),
    ("sharesOutstanding", "Shares outstanding", "cnt"),
    # Volumen medio y float: campos 18-19 y 36 del Exhibit 2B, y eran los ÚNICOS de los 97 que
    # miden LIQUIDEZ. Faltaban los cuatro. Se vio en un test real: el constructor descartó el
    # nombre de mayor nota de los 49 (HAPN, 84,61) alegando "preferí nombres con mayor liquidez"
    # y fondeó otro con la misma liquidez exacta (HAPN $38M/día vs VIPS $40M/día) — no por mal
    # juicio, sino porque no tenía ni un dato de volumen delante y la objeción era incomprobable. El
    # prompt del scorer ya dice que el tamaño y la liquidez son riesgos legítimos; ahora se pueden
    # medir. (El campo 20 del paper es el mismo dato que el 19 en yfinance; no se duplica.)
    ("floatShares", "Float shares", "cnt"),
    ("averageVolume", "Avg volume (shares/day)", "cnt"),
    ("averageVolume10days", "Avg volume 10d (shares/day)", "cnt"),
    ("sharesShort", "Shares short", "cnt"),
    ("sharesShortPriorMonth", "Shares short (prev month)", "cnt"),
    # yfinance da debtToEquity YA en porcentaje (991.21 = 991% = 9,9 veces). Sin la unidad en la
    # etiqueta, un 991 pelado se puede leer como 991 VECES deuda sobre fondos propios, que sería
    # una empresa quebrada en vez de una apalancada. Misma familia de bug de escala que el
    # dividendYield y el ^TNX.
    ("debtToEquity", "Debt/Equity (%)", "num"),
    ("currentRatio", "Current ratio", "num"),
    ("quickRatio", "Quick ratio", "num"),
    ("dividendYield", "Dividend yield", "yld"),
    ("payoutRatio", "Payout ratio", "pct"),
    ("beta", "Beta", "num"),
    ("heldPercentInsiders", "Insider ownership", "pct"),
    ("heldPercentInstitutions", "Institutional ownership", "pct"),
    ("shortPercentOfFloat", "Short % of float", "pct"),
    ("shortRatio", "Short ratio (days to cover)", "num"),
    ("targetMeanPrice", "Analyst target (mean)", "num"),
    ("targetHighPrice", "Analyst target (high)", "num"),
    ("targetLowPrice", "Analyst target (low)", "num"),
    ("numberOfAnalystOpinions", "# analysts", "num"),
    ("recommendationKey", "Analyst reco", "str"),
    ("recommendationMean", "Reco mean (1 buy–5 sell)", "num"),
    ("auditRisk", "Audit risk (1-10)", "num"),
    ("boardRisk", "Board risk (1-10)", "num"),
    ("compensationRisk", "Comp risk (1-10)", "num"),
    ("shareHolderRightsRisk", "Shareholder-rights risk (1-10)", "num"),
    ("overallRisk", "Overall governance risk (1-10)", "num"),
]


@dataclass
class NameData:
    ticker: str
    sector: str
    industry: str
    price: float | None
    fundamentals_text: str
    technical_text: str
    market_cap: float | None = None   # para el desempate por market cap (método del paper)
    news: list[str] = field(default_factory=list)
    earnings_text: str = ""           # próxima fecha de resultados — dato para el PROFUNDO
    name: str = ""                      # nombre corto de la empresa
    target_high: float | None = None    # objetivo máximo del consenso de analistas, como NUMERO
    # (ya viaja como texto dentro de fundamentals_text; esto es para el guardarrail determinista)


def _fmt(value: object, kind: str) -> str | None:
    # "none" es como yfinance dice "sin datos" en los campos de texto (`recommendationKey`), y
    # escrito tal cual se lee como un veredicto: "Analyst reco: none" parece "los analistas no la
    # recomiendan" cuando significa que no hay ninguno cubriéndola. Se trata como ausente.
    if value is None or value == "" or (isinstance(value, str) and value.strip().lower() == "none"):
        return None
    try:
        if kind == "str":
            return str(value)
        v = float(value)
    except (TypeError, ValueError):
        return None
    if kind == "pct":
        return f"{v * 100:.1f}%"
    if kind == "yld":
        # yfinance actual devuelve dividendYield YA en % (1.72 = 1.72%); versiones viejas lo daban
        # como ratio (0.0172). Un valor < 0.2 solo es plausible como ratio (un yield del 0.2% es
        # casi inexistente) → re-escalamos; si no, ya está en % y se muestra tal cual. Evita el
        # "172%" (viejo) y el "94%" de MSFT (nuevo) a la vez.
        return f"{(v * 100 if v < 0.2 else v):.2f}%"
    if kind == "cur":
        for unit, size in (("T", 1e12), ("B", 1e9), ("M", 1e6)):
            if abs(v) >= size:
                return f"${v / size:.2f}{unit}"
        return f"${v:.0f}"
    if kind == "cnt":  # conteos (acciones): 274M, sin símbolo de moneda
        for unit, size in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
            if abs(v) >= size:
                return f"{v / size:.2f}{unit}"
        return f"{v:.0f}"
    return f"{v:.2f}"


def _fundamentals_text(info: dict) -> str:
    """Los campos SIN dato se omiten en vez de escribirse como "n/d".

    Dos motivos. Uno, coste: son líneas que viajan en ~3.000 prompts por escaneo sin decir nada.
    Dos, y más importante, "Analyst reco: none" no es neutro — "none" se lee como "los analistas
    no la recomiendan" cuando en realidad significa "no hay dato". Un campo ausente no engaña;
    uno que dice "none" sí puede.
    """
    lines = []
    for key, label, kind in _FUNDAMENTAL_FIELDS:
        s = _fmt(info.get(key), kind)
        if s is not None:
            lines.append(f"- {label}: {s}")
    # Volumen en DINERO, ya multiplicado. Aritmética sobre dos datos que ya damos, del mismo tipo
    # que el "price vs analyst mean target" — no una conclusión nuestra. Va derivado porque el
    # volumen en ACCIONES no es comparable entre nombres: 2M de acciones son $38M en una de $19 y
    # $1.000M en una de $500, y esa diferencia es justo lo que decide si una posición se puede
    # abrir o no.
    vol, precio = info.get("averageVolume"), (info.get("currentPrice")
                                              or info.get("regularMarketPrice"))
    if vol and precio:
        s = _fmt(float(vol) * float(precio), "cur")
        if s is not None:
            lines.append(f"- Avg dollar volume/day: {s}")
    return "\n".join(lines)


def _technical_text(info: dict, hist) -> str:
    parts: list[str] = []
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    if hist is not None and not hist.empty:
        close = hist["close"]
        if price is None:
            price = float(close.iloc[-1])
        parts.append(f"price ${float(close.iloc[-1]):.2f}")
        # Solo lo que el paper pasa (Exhibit 2B): precio, medias de 50 y 200, rango de 52
        # semanas, beta y cambio a 52 semanas. Fuera el RSI (no aparece ni una
        # vez en el paper), el "% por debajo del máximo", el cambio a 5 días y el de ~6 meses:
        # los cuatro los calculábamos NOSOTROS y se los servíamos masticados en una línea que se
        # lee de un vistazo. El paper da el máximo y el precio y deja que el modelo saque la
        # conclusión si quiere. Medido: las carteras salían a un 7-8% de máximos con una
        # mediana del universo finalista del 11%, y estas cuatro métricas eran el canal más
        # probable. Mismo criterio que el "fuerte→débil" de los sectores: dato sí, conclusión no.
        ma50, ma200 = ta.sma(close, 50), ta.sma(close, 200)
        if ma50 == ma50:
            parts.append(f"MA50 ${ma50:.2f}")
        if ma200 == ma200:
            parts.append(f"MA200 ${ma200:.2f}")
    lo, hi = info.get("fiftyTwoWeekLow"), info.get("fiftyTwoWeekHigh")
    if lo and hi:
        parts.append(f"52w range ${lo:.2f}-${hi:.2f}")
    # Precio contra el objetivo medio del consenso, ya restado. Los dos números viajaban al
    # prompt en secciones distintas (el objetivo entre 50 líneas de fundamentales, el precio
    # aquí) y la resta quedaba a cargo del modelo. Es aritmética sobre datos que ya damos, del
    # mismo tipo que "% below 1y high" — no una conclusión nuestra. El 7-ago un nombre cotizaba
    # un 17% POR ENCIMA del objetivo medio y esa distancia no se veía en ninguna línea.
    tgt = info.get("targetMeanPrice")
    if tgt and price:
        parts.append(f"price vs analyst mean target {((price / float(tgt)) - 1) * 100:+.0f}%")
    beta = info.get("beta")
    if beta is not None:
        parts.append(f"beta {beta:.2f}")
    chg = info.get("52WeekChange")
    if chg is not None:
        parts.append(f"52w change {chg * 100:+.0f}%")
    return " · ".join(parts)


def _earnings_text(info: dict) -> str:
    """Próxima fecha de resultados, como DATO neutro y sin instrucción (dato sí, regla no).

    `.info` ya trae la ventana (`earningsTimestampStart/End`, unix) — cero llamadas extra.
    Tras publicar resultados, yfinance apunta ya al trimestre siguiente, así que la fecha puede
    ser pasada unos días: se etiqueta como "last" en vez de ocultarla, que también es dato.
    """
    start = info.get("earningsTimestampStart") or info.get("earningsTimestamp")
    if not start:
        return ""
    try:
        d1 = datetime.fromtimestamp(float(start), tz=UTC).date()
        end = info.get("earningsTimestampEnd")
        d2 = datetime.fromtimestamp(float(end), tz=UTC).date() if end else d1
    except (TypeError, ValueError, OSError, OverflowError):
        return ""
    cuando = d1.isoformat() if d2 <= d1 else f"{d1.isoformat()} to {d2.isoformat()}"
    etiqueta = "next" if d2 >= datetime.now(UTC).date() else "last"
    estimado = ", estimated (unconfirmed)" if info.get("isEarningsDateEstimate") else ""
    return f"{etiqueta} earnings report: {cuando}{estimado}"


def _news(yt: yf.Ticker, max_items: int = 8) -> list[str]:
    out: list[str] = []
    try:
        for item in (yt.news or [])[:max_items]:
            title = item.get("title") or (item.get("content") or {}).get("title")
            if title:
                out.append(title.strip())
    except Exception:
        pass
    return out


def gather(ticker: str, db=None) -> tuple[NameData | None, str | None]:  # noqa: ANN001
    """Baja .info + histórico (para técnico) + noticias de un ticker.

    Devuelve `(datos, motivo)`: `motivo` es texto corto (tipo de excepción + mensaje) SOLO si
    `datos` es None — antes la excepción se tragaba entera (`except Exception: return None`) y
    no quedaba ni rastro de POR QUÉ. Medido en dos escaneos reales: 2.400-2.500 de
    3.000 nombres sin datos de golpe, causa real un 401 "Invalid Crumb" de Yahoo bajo carga
    (bloqueo del crumb de autenticación, no un 429 de rate-limit clásico) — invisible hasta
    entonces salvo bajando a mano a los logs de Railway.

    `db`, si se pasa, cachea 12h (`FundamentalsCache`): un segundo escaneo/test el mismo día
    reutiliza los datos del primero en vez de volver a pedirle 9.000 peticiones a Yahoo. Sin
    `db` (tests, scripts sueltos) funciona exactamente igual que antes, sin caché.
    """
    if db is not None:
        cached = _cache_get(db, ticker)
        if cached is not None:
            return cached, None
    try:
        yt = yf.Ticker(ticker)
        info = yt.info or {}
        if not (info.get("sector") or info.get("marketCap") or info.get("shortName")):
            return None, "sin sector/marketCap/shortName en .info (vacío o deslistado)"
        hist = None
        try:
            h = yt.history(period="1y", interval="1d", auto_adjust=True)
            if h is not None and not h.empty:
                hist = h.rename(columns=str.lower)
        except Exception:
            hist = None
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        mcap = info.get("marketCap")
        target_high = info.get("targetHighPrice")
        data = NameData(
            ticker=ticker,
            sector=info.get("sector", "n/d"),
            industry=info.get("industry", "n/d"),
            price=float(price) if price else None,
            fundamentals_text=_fundamentals_text(info),
            technical_text=_technical_text(info, hist),
            market_cap=float(mcap) if mcap else None,
            news=_news(yt),
            earnings_text=_earnings_text(info),
            name=info.get("shortName", ""),
            target_high=float(target_high) if target_high else None,
        )
        if db is not None:
            _cache_put(db, ticker, data)
        return data, None
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"[:300]
