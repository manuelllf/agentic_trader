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

import logging
import math
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import yfinance as yf

from app.screener import technicals as ta
from app.screener import yahoo_scraper

logger = logging.getLogger(__name__)

# Ventana de reutilización de la foto: dentro de ella el escaneo NO vuelve a pedirle nada a
# Yahoo (protección contra el 401 masivo que motivó el cache; ver `FundamentalsSnapshot`).
# 24h -> 12h: para una decisión real queremos dato fresco o casi (medio día, no un día entero);
# quien quiera evitar la espera de un gather completo (pruebas a mitad de mes) pide
# explícitamente `ttl_h=inf` vía `reutilizar_ultima_foto`, no un default silenciosamente largo.
_FOTO_TTL_H = 12.0

# Pausa tras cada petición Yahoo (módulo, no parámetro gather): scan_service fija antes gather.
# 0.0 defecto (sin pausa) para tests; no es kwarg para mantener firma estable ante stubs.
_GATHER_PACE_S = 0.0

# _FOTO_LOCK serializa TODO acceso a `db` desde `gather()` (lectura y escritura): la Session de
# SQLAlchemy no es thread-safe, ni siquiera para un `SELECT` concurrente con otro hilo.
# _SCRAPER_LOCK: consentimiento/crumb una sola vez/proceso; si falla, todo a yfinance puro.
_FOTO_LOCK = threading.Lock()
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


def foto_reciente(db, ticker: str, ttl_h: float = _FOTO_TTL_H) -> NameData | None:  # noqa: ANN001
    """Última foto de este ticker si cae dentro de la ventana. Sustituye la lectura del cache."""
    from app.models import (
        FundamentalsSnapshot,
        FundamentalsSnapshotMetric,
        FundamentalsSnapshotNews,
    )

    # `_FOTO_LOCK` cubre TODO acceso a `db` (lectura y escritura, incluidas noticias/métricas
    # hermanas): `gather()` llama a `foto_reciente`/`foto_guardar` con el MISMO `db` desde
    # `_GATHER_WORKERS` hilos a la vez, y una `Session` de SQLAlchemy no es thread-safe ni para
    # LEER — sin el lock, "This session is provisioning a new connection; concurrent operations
    # are not permitted" (visto en producción, 23-ago).
    with _FOTO_LOCK:
        row = (db.query(FundamentalsSnapshot)
               .filter(FundamentalsSnapshot.ticker == ticker)
               .order_by(FundamentalsSnapshot.captured_at.desc())
               .first())
        if not row:
            return None
        # SQLite devuelve el datetime naive pese a DateTime(timezone=True) — mismo patrón que
        # watchlist.py::_aware().
        at = row.captured_at
        at = at if at.tzinfo is not None else at.replace(tzinfo=UTC)
        if (datetime.now(UTC) - at).total_seconds() / 3600 >= ttl_h:
            return None
        noticias = [n.texto for n in
                   db.query(FundamentalsSnapshotNews)
                   .filter(FundamentalsSnapshotNews.fundamentals_snapshot_id == row.id)
                   .order_by(FundamentalsSnapshotNews.posicion)
                   .all()]
        metricas_crudas = {m.clave: (m.valor_num if m.valor_num is not None else m.valor_texto)
                           for m in db.query(FundamentalsSnapshotMetric)
                           .filter(FundamentalsSnapshotMetric.fundamentals_snapshot_id == row.id)
                           .all()}
    # Reconstruye el prompt con la MISMA función que lo monta en vivo (`_fundamentals_text`):
    # nunca se reimplementa el formateo, así que el texto reconstruido es idéntico al original.
    # `currentPrice` no es uno de los ~85 (viaja aparte, ya materializado en `row.price`) — se
    # inyecta solo para esta llamada, no contamina `fundamentales_crudos` del resultado.
    texto = _fundamentals_text({**metricas_crudas, "currentPrice": row.price})
    return NameData(
        ticker=row.ticker, sector=row.sector or "n/d", industry=row.industry or "n/d",
        price=row.price, fundamentals_text=texto,
        technical_text=row.technical_text or "", market_cap=row.market_cap,
        news=noticias, earnings_text=row.earnings_text or "", name=row.name or "",
        target_high=row.target_high, target_mean=row.target_mean,
        pe_trailing=row.pe_trailing, pe_forward=row.pe_forward,
        high_52w=row.high_52w, low_52w=row.low_52w,
        fundamentales_crudos=metricas_crudas,
    )


def foto_guardar(db, ticker: str, data: NameData, es_dataset: bool = False) -> None:  # noqa: ANN001
    """Añade una foto NUEVA (nunca pisa la anterior): es el histórico, no un cache. Columnas
    propias, nunca un blob — ver `app.models.FundamentalsSnapshot`. Los ~85 campos de
    `fundamentals_text` se guardan en crudo (`FundamentalsSnapshotMetric`), NUNCA el texto ya
    formateado: es lo que se le mandó al LLM, no un dato — se reconstruye al leer.

    `es_dataset`: de qué universo vino ESTA captura (global/HuggingFace o NASDAQ/escaneo)
    — no cambia la identidad (`ticker`), solo la etiqueta de origen de la fila."""
    from app.models import (
        FundamentalsSnapshot,
        FundamentalsSnapshotMetric,
        FundamentalsSnapshotNews,
    )

    with _FOTO_LOCK:
        fila = FundamentalsSnapshot(
            ticker=ticker, sector=data.sector, industry=data.industry, name=data.name,
            price=data.price, market_cap=data.market_cap,
            target_high=data.target_high, target_mean=data.target_mean,
            pe_trailing=data.pe_trailing, pe_forward=data.pe_forward,
            high_52w=data.high_52w, low_52w=data.low_52w,
            technical_text=data.technical_text, earnings_text=data.earnings_text,
            es_dataset=es_dataset,
        )
        db.add(fila)
        db.flush()   # asigna fila.id sin comprometer la transacción, para las hermanas
        for i, titular in enumerate(data.news):
            db.add(FundamentalsSnapshotNews(
                fundamentals_snapshot_id=fila.id, posicion=i, texto=titular))
        for clave, valor in data.fundamentales_crudos.items():
            db.add(FundamentalsSnapshotMetric(
                fundamentals_snapshot_id=fila.id, clave=clave,
                valor_num=valor if isinstance(valor, float) else None,
                valor_texto=valor if isinstance(valor, str) else None,
            ))
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
    # Los mismos números que ya van dentro de `fundamentals_text`/`technical_text`, pero como
    # NÚMERO: el texto no se puede agregar (mediana de P/E por sector, distancia al máximo).
    pe_trailing: float | None = None
    pe_forward: float | None = None
    high_52w: float | None = None
    low_52w: float | None = None
    # Los ~85 campos de `fundamentals_text` (Exhibit 2B), EN CRUDO — clave de yfinance → valor
    # sin formatear. Es lo que se persiste (`fundamentals_snapshot_metric`, relacional, nunca
    # texto ni JSON); `fundamentals_text` sigue viajando al prompt tal cual, sin tocar.
    fundamentales_crudos: dict[str, float | str] = field(default_factory=dict)


def numero_finito(v: object) -> float | None:
    """Cualquier valor crudo de `.info` a `float`, nunca `inf`/`-inf`/`nan`: yfinance los emite
    cuando el ratio de origen divide por ~0 (ganancias nulas → P/E "infinito"). Sin este
    guardarraíl llegan como número válido hasta la fila entera del ticker — visto en producción
    con `trailingPE` reventando el INSERT (Postgres no acepta `Infinity` en JSON). Compartido
    por `metricas()` aquí y por `yahoo_scraper.gather_scraper()` para price/market_cap/target,
    los mismos campos que antes hacían `float(x) if x else None` sin este filtro."""
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _num(info: dict, key: str) -> float | None:
    return numero_finito(info.get(key))


def metricas(info: dict) -> dict:
    """Campos numéricos de `.info` que la foto materializa (ver `FundamentalsSnapshot`)."""
    return {
        "pe_trailing": _num(info, "trailingPE"),
        "pe_forward": _num(info, "forwardPE"),
        "high_52w": _num(info, "fiftyTwoWeekHigh"),
        "low_52w": _num(info, "fiftyTwoWeekLow"),
    }


# Mínimo de nombres para publicar la mediana de un sector: con 3 o 4 la mediana la mueve
# cualquiera. Es el mismo suelo con el que se midieron las medianas del A/B.
_MIN_POR_SECTOR = 6


def medianas_pe_por_sector(datos: list[NameData]) -> dict[str, dict[str, float]]:
    """Mediana de P/E trailing Y forward por sector, calculada sobre el UNIVERSO PROPIO.

    Nunca de una fuente externa: el numerador (`trailingPE`/`forwardPE` de yfinance) y el sector
    salen de aquí, y mezclar metodologías da el doble de diferencia (Financial Services: 14,46
    propio vs 7,35 de un agregado externo). Mediana y no media: un P/E de 300 no la destroza.
    `{sector: {"trailing": x, "forward": y}}` — una clave falta si ese sector no llegó a
    `_MIN_POR_SECTOR` muestras para ESE campo (trailing y forward pueden fallar por separado,
    un nombre puede traer uno y no el otro).

    Sesgo conocido y sin esconder: con el universo cortado a los ~3.000 de más volumen, esto es
    la mediana de las GRANDES capitalizaciones del sector, no la del sector entero.
    """
    import statistics
    from collections import defaultdict

    trailing: dict[str, list[float]] = defaultdict(list)
    forward: dict[str, list[float]] = defaultdict(list)
    for d in datos:
        if not d.sector:
            continue
        if d.pe_trailing and d.pe_trailing > 0:
            trailing[d.sector].append(d.pe_trailing)
        if d.pe_forward and d.pe_forward > 0:
            forward[d.sector].append(d.pe_forward)
    out: dict[str, dict[str, float]] = {}
    for sector in set(trailing) | set(forward):
        entrada = {}
        if len(trailing.get(sector, [])) >= _MIN_POR_SECTOR:
            entrada["trailing"] = round(statistics.median(trailing[sector]), 2)
        if len(forward.get(sector, [])) >= _MIN_POR_SECTOR:
            entrada["forward"] = round(statistics.median(forward[sector]), 2)
        if entrada:
            out[sector] = entrada
    return out


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


def _valores_crudos(info: dict) -> dict[str, float | str]:
    """Los mismos ~85 campos de `_fundamentals_text`, SIN formatear — lo que se persiste
    relacional en `fundamentals_snapshot_metric`. Mismo criterio de "ausente se omite" que
    `_fmt`; los numéricos pasan por `numero_finito` (mismo guardarraíl que evitó el fallo de
    `Infinity`). No incluye "Avg dollar volume/day": es aritmética derivada de `averageVolume`
    (ya en el catálogo) y el precio (ya su propia columna), se recalcula al reconstruir."""
    out: dict[str, float | str] = {}
    for key, _label, kind in _FUNDAMENTAL_FIELDS:
        v = info.get(key)
        if kind == "str":
            if v not in (None, "") and not (isinstance(v, str) and v.strip().lower() == "none"):
                out[key] = str(v)
            continue
        f = numero_finito(v)
        if f is not None:
            out[key] = f
    return out


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


# Backoff SOLO ante 429 (rate-limit real): un timeout/HTTP 5xx no se beneficia de esperar y ya
# cae a yfinance abajo. Medido en local (24-ago-2026): a partir de 6 hilos el 429 llega en racha
# sostenida, no aislado -- 2 reintentos cortos separan un pico puntual de un bloqueo real (que
# el circuit breaker de `foto_service.capturar` corta más arriba, no aquí).
_429_BACKOFF_S = (3.0, 8.0)


def _gather_scraper_con_backoff(s, crumb: str, ticker: str,  # noqa: ANN001
                                query_symbol: str | None = None):
    for espera in _429_BACKOFF_S:
        try:
            return yahoo_scraper.gather_scraper(s, crumb, ticker, query_symbol=query_symbol)
        except yahoo_scraper.TransportError as exc:
            if "HTTP 429" not in str(exc):
                raise
            time.sleep(espera)
    return yahoo_scraper.gather_scraper(s, crumb, ticker, query_symbol=query_symbol)


def gather(ticker: str, db=None, yahoo_symbol: str | None = None,  # noqa: ANN001
          es_dataset: bool = False, ttl_h: float = _FOTO_TTL_H) -> tuple[NameData | None, str | None]:
    """Baja .info + histórico + noticias: devuelve (datos, motivo_si_None) o (data, None).
    Motor: yahoo_scraper primario; fallback yfinance. Reutiliza la foto reciente si cae dentro
    de `ttl_h`. PACE_S fijado por scan_service.

    `yahoo_symbol`: símbolo con sufijo de mercado (`000001.SZ`) para tickers del universo global
    que lo necesitan (ver `universe_global.py`) — se usa SOLO para preguntarle a Yahoo; `ticker`
    (el del dataset) sigue siendo la identidad bajo la que se guarda/lee la foto.
    `es_dataset`: solo etiqueta de qué universo vino esta captura (ver `foto_guardar`).
    `ttl_h`: ventana de reutilización — `float("inf")` = usa la última foto que haya, sin
    importar su antigüedad (botón "reutilizar última foto" de Sala Real)."""
    if db is not None:
        cached = foto_reciente(db, ticker, ttl_h=ttl_h)
        if cached is not None:
            return cached, None

    scraper = _scraper_session()
    if scraper is not None:
        s, crumb = scraper
        try:
            data, motivo = _gather_scraper_con_backoff(s, crumb, ticker, query_symbol=yahoo_symbol)
        except yahoo_scraper.TransportError as exc:
            if _GATHER_PACE_S:
                time.sleep(_GATHER_PACE_S)
            if "HTTP 404" in str(exc):
                # Símbolo inexistente para Yahoo -- no es un fallo de transporte pasajero, es
                # "no existe". yfinance pega al mismo endpoint y da el mismo 404: reintentar solo
                # duplica el log sin cambiar el resultado (medido con los SZSE sin sufijo, 26-ago).
                motivo = f"{exc} (sin reintento: símbolo no encontrado)"
                logger.warning("Gather sin datos para %s: %s", ticker, motivo)
                return None, motivo
            logger.warning("Scraper de Yahoo: fallo de transporte en %s (%s) — reintento vía "
                           "yfinance.", ticker, exc)
            # No hay `return` aquí a propósito: cae al bloque de yfinance puro de abajo, SIN
            # tocarlo, para reintentar este mismo ticker.
        else:
            if _GATHER_PACE_S:
                time.sleep(_GATHER_PACE_S)
            if data is not None:
                if db is not None:
                    foto_guardar(db, ticker, data, es_dataset=es_dataset)
                return data, None
            # "sin_datos" genuino (200 OK, ticker vacío/deslistado): NO se reintenta por
            # yfinance — medido que los mismos tickers fallan igual en los dos sitios.
            if motivo:
                logger.warning("Gather sin datos para %s: %s", ticker, motivo)
            return None, motivo
    try:
        yt = yf.Ticker(yahoo_symbol or ticker)
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
            price=numero_finito(price),
            fundamentals_text=_fundamentals_text(info),
            technical_text=_technical_text(info, hist),
            market_cap=numero_finito(mcap),
            news=_news(yt),
            earnings_text=_earnings_text(info),
            name=info.get("shortName", ""),
            target_high=numero_finito(target_high),
            target_mean=numero_finito(target_mean),
            fundamentales_crudos=_valores_crudos(info),
            **metricas(info),
        )
        if db is not None:
            foto_guardar(db, ticker, data, es_dataset=es_dataset)
        return data, None
    except Exception as exc:
        # Entero, sin cortar a 300: acaba en `ScanRun.failures` y un 401 de Yahoo trae el cuerpo
        # de la respuesta dentro del mensaje — justo la parte que se perdía al recortar.
        motivo = f"{type(exc).__name__}: {exc}"
        logger.warning("Gather sin datos para %s: %s", ticker, motivo)
        return None, motivo
