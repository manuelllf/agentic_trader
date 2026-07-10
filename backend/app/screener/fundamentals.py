"""Datos por nombre para el scorer (método whitepaper DeepSeek).

Junta lo que el paper mete en el prompt de puntuación: los fundamentales de yfinance `.info`
(las ~97 variables SON este dict: valoración, márgenes, crecimiento, balance, short interest,
targets de analistas, propiedad, riesgo de gobernanza), técnicos SOLO como contexto
(MA50/200, 52 semanas, RSI, beta) y titulares recientes. Todo gratis (yfinance).

Tolerante a huecos: como el paper, "usamos la información más reciente disponible" — lo que
falte va como `n/d` y el LLM lo maneja (nada de excluir por dato incompleto).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import yfinance as yf

from app.screener import technicals as ta

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
    ("sharesShort", "Shares short", "cnt"),
    ("sharesShortPriorMonth", "Shares short (prev month)", "cnt"),
    ("debtToEquity", "Debt/Equity", "num"),
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


def _fmt(value: object, kind: str) -> str | None:
    if value is None or value == "":
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
    lines: list[str] = []
    for key, label, kind in _FUNDAMENTAL_FIELDS:
        s = _fmt(info.get(key), kind)
        lines.append(f"- {label}: {s if s is not None else 'n/d'}")
    return "\n".join(lines)


def _technical_text(info: dict, hist) -> str:
    parts: list[str] = []
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    if hist is not None and not hist.empty:
        close = hist["close"]
        if price is None:
            price = float(close.iloc[-1])
        parts.append(f"price ${float(close.iloc[-1]):.2f}")
        parts.append(f"RSI {ta.rsi(close):.0f}")
        ma50, ma200 = ta.sma(close, 50), ta.sma(close, 200)
        if ma50 == ma50:
            parts.append(f"MA50 ${ma50:.2f}")
        if ma200 == ma200:
            parts.append(f"MA200 ${ma200:.2f}")
        parts.append(f"{ta.pct_below_ath(close):.0f}% below 1y high")
        parts.append(f"5d {ta.pct_change_ndays(close, 5):+.1f}%")
        parts.append(f"~6m {ta.pct_change_ndays(close, 126):+.1f}%")
    lo, hi = info.get("fiftyTwoWeekLow"), info.get("fiftyTwoWeekHigh")
    if lo and hi:
        parts.append(f"52w range ${lo:.2f}-${hi:.2f}")
    beta = info.get("beta")
    if beta is not None:
        parts.append(f"beta {beta:.2f}")
    chg = info.get("52WeekChange")
    if chg is not None:
        parts.append(f"52w change {chg * 100:+.0f}%")
    return " · ".join(parts)


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


def gather(ticker: str) -> NameData | None:
    """Baja .info + histórico (para técnico) + noticias de un ticker. None si no hay datos."""
    try:
        yt = yf.Ticker(ticker)
        info = yt.info or {}
        if not (info.get("sector") or info.get("marketCap") or info.get("shortName")):
            return None
        hist = None
        try:
            h = yt.history(period="1y", interval="1d", auto_adjust=True)
            if h is not None and not h.empty:
                hist = h.rename(columns=str.lower)
        except Exception:
            hist = None
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        mcap = info.get("marketCap")
        return NameData(
            ticker=ticker,
            sector=info.get("sector", "n/d"),
            industry=info.get("industry", "n/d"),
            price=float(price) if price else None,
            fundamentals_text=_fundamentals_text(info),
            technical_text=_technical_text(info, hist),
            market_cap=float(mcap) if mcap else None,
            news=_news(yt),
        )
    except Exception:
        return None
