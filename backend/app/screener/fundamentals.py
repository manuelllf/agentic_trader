"""Datos por nombre para el scorer (método whitepaper DeepSeek).

Junta lo que el paper mete en el prompt de puntuación: los fundamentales de yfinance `.info`
(las ~97 variables SON este dict: valoración, márgenes, crecimiento, balance, short interest,
targets de analistas, propiedad, riesgo de gobernanza), técnicos SOLO como contexto
(MA50/200, 52 semanas, RSI, beta), la próxima fecha de resultados (dato, no regla) y
titulares con su resumen. Todo gratis (yfinance).

Tolerante a huecos: como el paper, "usamos la información más reciente disponible" — lo que
falte va como `n/d` y el LLM lo maneja (nada de excluir por dato incompleto).
"""

from __future__ import annotations

import dataclasses
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import yfinance as yf

from app.screener import technicals as ta
from app.screener import yahoo_scraper

logger = logging.getLogger(__name__)

_FUND_CACHE_TTL_H = 12.0   # ver `FundamentalsCache` en models.py para el motivo

# Pausa tras cada petición Yahoo (módulo, no parámetro gather): scan_service fija antes gather.
# 0.0 defecto (sin pausa) para tests; no es kwarg para mantener firma estable ante stubs.
_GATHER_PACE_S = 0.0

# _CACHE_LOCK serializa caché (SQLAlchemy no es thread-safe en JSON concurrente).
# _SCRAPER_LOCK: consentimiento/crumb una sola vez/proceso; si falla, todo a yfinance puro.
_CACHE_LOCK = threading.Lock()
_SCRAPER_LOCK = threading.Lock()
_SCRAPER_CACHE: dict[str, object] = {}


def _scraper_session() -> tuple[yahoo_scraper.creq.Session, str] | None:
    """(sesión, crumb) del scraper, o None (todo cae a yfinance puro).
    Doble-check bajo lock: primer hilo paga consentimiento, resto lee caché."""
    if not _SCRAPER_CACHE:
        with _SCRAPER_LOCK:
            if not _SCRAPER_CACHE:
                try:
                    _SCRAPER_CACHE["ok"] = yahoo_scraper.consentir_y_crumb()
                except Exception as exc:
                    logger.warning("Scraper de Yahoo no disponible (%s): el escaneo entero cae "
                                   "a yfinance puro.", exc)
                    _SCRAPER_CACHE["ok"] = None
    return _SCRAPER_CACHE.get("ok")  # type: ignore[return-value]


def _cache_get(db, ticker: str) -> NameData | None:  # noqa: ANN001
    from app.models import FundamentalsCache

    with _CACHE_LOCK:
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
    with _CACHE_LOCK:
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
    # PRUEBA — decisión propia, NO fiel al paper (Exhibit 2B trae los campos 66-70: targets,
    # nº de analistas y recomendación). Fuera porque el consenso se revisa DESPUÉS del movimiento
    # de precio: es momentum disfrazado de fundamental, y colado como juicio experto esquiva la
    # cláusula que protege a los caídos (el modelo no lo lee como dato de precio). Siguen en
    # `NameData` para los guardarraíles de target, que son telemetría y no tocan prompt.
    ("auditRisk", "Audit risk (1-10)", "num"),
    ("boardRisk", "Board risk (1-10)", "num"),
    ("compensationRisk", "Comp risk (1-10)", "num"),
    ("shareHolderRightsRisk", "Shareholder-rights risk (1-10)", "num"),
    ("overallRisk", "Overall governance risk (1-10)", "num"),
    # Completa el Exhibit 2B: lo que faltaba no era un hueco de código, era ausencia real de dato
    # en yfinance para nombres pequeños/extranjeros. Estos 20 se verificaron fiables.
    ("previousClose", "Previous close", "num"),
    ("open", "Today's open", "num"),
    ("dayLow", "Today's low", "num"),
    ("dayHigh", "Today's high", "num"),
    ("bid", "Bid", "num"),
    ("ask", "Ask", "num"),
    ("bidSize", "Bid size (shares)", "cnt"),
    ("askSize", "Ask size (shares)", "cnt"),
    ("dividendRate", "Annual dividend rate", "num"),
    ("lastDividendValue", "Last dividend value", "num"),
    ("lastDividendDate", "Last dividend date", "date"),
    ("impliedSharesOutstanding", "Implied shares outstanding", "cnt"),
    ("currency", "Trading currency", "str"),
    ("financialCurrency", "Financial currency", "str"),
    ("lastFiscalYearEnd", "Last fiscal year end", "date"),
    ("nextFiscalYearEnd", "Next fiscal year end", "date"),
    ("mostRecentQuarter", "Most recent quarter", "date"),
    ("lastSplitFactor", "Last stock split factor", "str"),
    ("lastSplitDate", "Last stock split date", "date"),
    ("volume", "Today's volume (shares)", "cnt"),
    # Últimos 12 del Exhibit 2B, verificados fiables contra tickers reales (`_fmt` omite el
    # campo si no hay dato). Las variantes "Regular Market" se listan por fidelidad literal.
    ("regularMarketPreviousClose", "Previous close (regular mkt)", "num"),
    ("regularMarketOpen", "Today's open (regular mkt)", "num"),
    ("regularMarketDayLow", "Today's low (regular mkt)", "num"),
    ("regularMarketDayHigh", "Today's high (regular mkt)", "num"),
    ("regularMarketVolume", "Today's volume, regular mkt (shares)", "cnt"),
    ("averageDailyVolume10Day", "Avg daily volume 10d, alt (shares/day)", "cnt"),
    ("trailingAnnualDividendRate", "Annual dividend rate (TTM)", "num"),
    ("trailingAnnualDividendYield", "Dividend yield (TTM)", "yld"),
    ("sharesShortPreviousMonthDate", "Short interest date (prev month)", "date"),
    ("dateShortInterest", "Short interest date (most recent)", "date"),
    ("trailingPegRatio", "PEG (trailing)", "num"),
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
    # target_high/target_mean: consenso de analistas, SOLO para los guardarraíles deterministas
    # (target_flagged, `_flag_consensus_echo`) — desde el 19-ago ya NO viajan a ningún prompt.
    target_high: float | None = None    # objetivo máximo del consenso, como NUMERO
    target_mean: float | None = None    # objetivo MEDIO del consenso, como NUMERO


def _fmt(value: object, kind: str) -> str | None:
    # "none" es como yfinance dice "sin datos" en campos de texto, y escrito tal cual se puede
    # leer como un veredicto en vez de una ausencia. Se trata como ausente.
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
    if kind == "date":  # yfinance da estos campos en unix epoch (segundos)
        try:
            return datetime.fromtimestamp(v, tz=UTC).strftime("%Y-%m-%d")
        except (ValueError, OSError, OverflowError):
            return None
    return f"{v:.2f}"


def _fundamentals_text(info: dict) -> str:
    """Omite campos sin dato (no escribe "n/d"): "none" engaña; ausente no."""
    lines = []
    for key, label, kind in _FUNDAMENTAL_FIELDS:
        s = _fmt(info.get(key), kind)
        if s is not None:
            lines.append(f"- {label}: {s}")
    # Volumen en dinero (multiplicado): aritmética sobre datos que ya damos, dato sí (no conclusión).
    vol, precio = info.get("averageVolume"), (info.get("currentPrice")
                                              or info.get("regularMarketPrice"))
    if vol and precio:
        s = _fmt(float(vol) * float(precio), "cur")
        if s is not None:
            lines.append(f"- Avg dollar volume/day: {s}")
    return "\n".join(lines)


def _technical_text(info: dict, hist) -> str:
    parts: list[str] = []
    if hist is not None and not hist.empty:
        close = hist["close"]
        parts.append(f"price ${float(close.iloc[-1]):.2f}")
        # Solo lo que el paper pasa (Exhibit 2B): precio, MA50/200, 52w range, beta. El 52w change
        # va UNA sola vez, en `fundamentals_text` (campo 62) — aquí lo duplicaba.
        ma50, ma200 = ta.sma(close, 50), ta.sma(close, 200)
        if ma50 == ma50:
            parts.append(f"MA50 ${ma50:.2f}")
        if ma200 == ma200:
            parts.append(f"MA200 ${ma200:.2f}")
    lo, hi = info.get("fiftyTwoWeekLow"), info.get("fiftyTwoWeekHigh")
    if lo and hi:
        parts.append(f"52w range ${lo:.2f}-${hi:.2f}")
    beta = info.get("beta")
    if beta is not None:
        parts.append(f"beta {beta:.2f}")
    return " · ".join(parts)


def _earnings_text(info: dict) -> str:
    """Próxima fecha de resultados: dato neutro. "last" si ya pasada (también es dato)."""
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


def _recorta_palabra(texto: str, max_chars: int) -> str:
    """Recorta texto sin partir palabra, añade "…" si hubo corte."""
    if len(texto) <= max_chars:
        return texto
    corte = texto[:max_chars].rsplit(" ", 1)[0]
    return f"{corte}…"


def _news(yt: yf.Ticker, max_items: int = 8) -> list[str]:
    """Titulares + resumen (Exhibit 2A: "headlines with summaries"). Recortado a 300 chars/palabra."""
    out: list[str] = []
    try:
        for item in (yt.news or [])[:max_items]:
            content = item.get("content") or {}
            title = item.get("title") or content.get("title")
            if not title:
                continue
            summary = item.get("summary") or content.get("summary")
            texto = f"{title.strip()} — {summary.strip()}" if summary else title.strip()
            out.append(_recorta_palabra(texto, 300))
    except Exception:
        pass
    return out


def gather(ticker: str, db=None) -> tuple[NameData | None, str | None]:  # noqa: ANN001
    """Baja .info + histórico + noticias: devuelve (datos, motivo_si_None) o (data, None).
    Motor: yahoo_scraper primario; fallback yfinance. DB cachea 12h. PACE_S fijado por scan_service."""
    if db is not None:
        cached = _cache_get(db, ticker)
        if cached is not None:
            return cached, None

    scraper = _scraper_session()
    if scraper is not None:
        s, crumb = scraper
        try:
            data, motivo = yahoo_scraper.gather_scraper(s, crumb, ticker)
        except yahoo_scraper.TransportError as exc:
            if _GATHER_PACE_S:
                time.sleep(_GATHER_PACE_S)
            logger.warning("Scraper de Yahoo: fallo de transporte en %s (%s) — reintento vía "
                           "yfinance.", ticker, exc)
            # No hay `return` aquí a propósito: cae al bloque de yfinance puro de abajo, SIN
            # tocarlo, para reintentar este mismo ticker.
        else:
            if _GATHER_PACE_S:
                time.sleep(_GATHER_PACE_S)
            if data is not None:
                if db is not None:
                    _cache_put(db, ticker, data)
                return data, None
            # "sin_datos" genuino (200 OK, ticker vacío/deslistado): NO se reintenta por
            # yfinance — medido que los mismos tickers fallan igual en los dos sitios.
            if motivo:
                logger.warning("Gather sin datos para %s: %s", ticker, motivo)
            return None, motivo
    try:
        yt = yf.Ticker(ticker)
        info = yt.info or {}
        if not (info.get("sector") or info.get("marketCap") or info.get("shortName")):
            motivo = "sin sector/marketCap/shortName en .info (vacío o deslistado)"
            logger.warning("Gather sin datos para %s: %s", ticker, motivo)
            return None, motivo
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
        target_mean = info.get("targetMeanPrice")
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
            target_mean=float(target_mean) if target_mean else None,
        )
        if db is not None:
            _cache_put(db, ticker, data)
        return data, None
    except Exception as exc:
        motivo = f"{type(exc).__name__}: {exc}"[:300]
        logger.warning("Gather sin datos para %s: %s", ticker, motivo)
        return None, motivo
