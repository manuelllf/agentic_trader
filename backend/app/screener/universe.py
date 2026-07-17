"""Universo de escaneo — se genera DINÁMICAMENTE sobre TODO el mercado US.

Fuente: **API pública de screener de NASDAQ** (gratis, SIN key) — devuelve TODO el mercado US
(NYSE+NASDAQ+AMEX, no solo NASDAQ) con market cap, precio y sector en una llamada. Filtramos
localmente por elegibilidad OBJETIVA (no opinión, fiel al paper): cap, volumen, precio vivo ≥$20
y dedup de clases de acción (GOOGL/GOOG → la más líquida). Cero listas a mano, cero sesgo.

Fallback: si NASDAQ falla (red), un SEED offline mínimo solo para no bloquear la maquinaria.
"""

from __future__ import annotations

import logging
import re
from datetime import date

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Caché en memoria: el universo se refresca 1 vez al día (la composición cambia despacio).
_cache: tuple[date, list[str]] | None = None

NASDAQ_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks"
_NASDAQ_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

# Fallback offline mínimo (placeholder). Solo si no hay red/fuente.
_SEED_FALLBACK: list[str] = [
    "LSCC", "POWI", "SITM", "CRDO", "AMBA", "INDI", "PATH", "GTLB", "S", "CFLT",
    "FROG", "DOCN", "FSLY", "ESTC", "AI", "BBAI", "SOUN", "ZETA", "IONQ", "RGTI",
    "QBTS", "ASTS", "RKLB", "RDW", "LUNR", "SOFI", "UPST", "AFRM", "LMND", "MQ",
    "MARA", "RIOT", "CLSK", "IREN", "CIFR", "WULF", "HUT", "NBIS", "CRSP", "NTLA",
]


def _parse_market_cap(raw: str) -> float | None:
    """'1,234,567,890' / '$1.2B' / '' → float o None."""
    if not raw:
        return None
    s = raw.replace(",", "").replace("$", "").strip()
    m = re.match(r"^([0-9.]+)\s*([BMK]?)$", s, re.IGNORECASE)
    if not m:
        try:
            return float(s)
        except ValueError:
            return None
    val = float(m.group(1))
    mult = {"B": 1e9, "M": 1e6, "K": 1e3, "": 1.0}[m.group(2).upper()]
    return val * mult


# Descriptores de tipo de valor: al cortar el nombre por aquí queda el nombre de la EMPRESA,
# lo que permite detectar clases de una misma compañía (GOOGL/GOOG, FOX/FOXA) y deduplicarlas.
_CLASS_MARKERS = (
    " common stock", " class ", " ordinary shares", " capital stock", " ordinary share",
    " american depositary", " depositary", " preferred", " series ", " warrant",
    " rights", " units", " unit", " subordinate", " notes",
)


def _company_key(name: str, symbol: str) -> str:
    """Nombre de empresa normalizado para deduplicar clases. Cae al símbolo si no hay nombre."""
    s = (name or "").lower()
    cut = min((i for i in (s.find(m) for m in _CLASS_MARKERS) if i != -1), default=-1)
    if cut != -1:
        s = s[:cut]
    s = re.sub(r"[^a-z0-9]", "", s)
    return s or symbol.lower()


_SYMBOL_RE = re.compile(r"^[A-Z]+(/[A-Z])?$")  # acción común, con clase opcional (BRK/B)


def _norm_symbol(symbol: str) -> str | None:
    """Ticker del screener → formato yfinance, o None si no es acción común.

    Acepta letras y clases con barra (BRK/B → BRK-B); descarta preferentes/series ('^'),
    warrants, units y símbolos raros.
    """
    if not _SYMBOL_RE.match(symbol):
        return None
    return symbol.replace("/", "-")


def _from_nasdaq() -> list[str]:
    params = {"tableonly": "true", "limit": "0", "download": "true"}
    with httpx.Client(timeout=30.0, headers=_NASDAQ_HEADERS) as client:
        resp = client.get(NASDAQ_SCREENER_URL, params=params)
        resp.raise_for_status()
        rows = resp.json()["data"]["rows"]

    cap_min = settings.universe_market_cap_min
    cap_max = settings.universe_market_cap_max
    vol_min = settings.universe_min_avg_volume
    price_min = settings.universe_min_price
    # Dedup de clases: por empresa, nos quedamos con la más LÍQUIDA → {company_key: (symbol, vol)}
    best: dict[str, tuple[str, float]] = {}
    for row in rows:
        symbol = _norm_symbol((row.get("symbol") or "").strip().upper())
        if symbol is None:
            continue
        cap = _parse_market_cap(row.get("marketCap", ""))
        if cap is None or not (cap_min <= cap <= cap_max):
            continue
        vol = _parse_market_cap(row.get("volume", ""))  # mismo parser (número plano)
        if vol is not None and vol < vol_min:
            continue
        # Precio vivo reciente (lastsale): sin precio → fuera; suelo $20 (higiene, no market cap).
        price = _parse_market_cap(row.get("lastsale", ""))  # el parser ya quita el '$'
        if price is None or price < price_min:
            continue
        key = _company_key(row.get("name", ""), symbol)
        if key not in best or (vol or 0.0) > best[key][1]:
            best[key] = (symbol, vol or 0.0)
    return sorted(sym for sym, _vol in best.values())


def build_universe(force_refresh: bool = False) -> list[str]:
    """Genera el universo desde NASDAQ (todo el mercado US, filtro objetivo por cap).

    Se cachea por día: el primer escaneo de la jornada lo pide a NASDAQ, el resto reutiliza.
    """
    global _cache
    if not force_refresh and _cache is not None and _cache[0] == date.today():
        return _cache[1]
    try:
        symbols = _from_nasdaq()
        if symbols:
            logger.info("Universo NASDAQ: %d nombres en la franja objetivo.", len(symbols))
            _cache = (date.today(), symbols)
            return symbols
    except Exception:
        logger.exception("Fallo consultando NASDAQ → usando SEED de fallback.")
    logger.warning("Usando SEED de fallback (no autónomo).")
    return list(_SEED_FALLBACK)


def sample_for_scan(always_include: list[str], n: int | None, offset: int = 0) -> list[str]:
    """Nombres a analizar en un escaneo.

    `always_include` (posiciones + watchlist, SIEMPRE dentro) + el universo. Si `n` es None (o
    ≥ tamaño total) → TODO el universo (cobertura completa). Si `n` es un número → ventana
    ROTATORIA de tamaño n a partir de `offset` (envuelve al final del universo ordenado), para que
    semanas consecutivas tejan el universo SIN REPETIR. El caller persiste `offset` (0 = desde el
    inicio). El universo llega ordenado, así que cada ventana es un tramo estable y disjunto.
    """
    always = list(dict.fromkeys(t.upper() for t in always_include if t))  # dedup, mantiene orden
    universe = build_universe()
    pool = [t for t in universe if t not in set(always)]
    if n is None or n >= len(always) + len(pool):
        return always + pool                       # universo entero
    take = max(0, n - len(always))
    if not pool or take == 0:
        return always
    off = offset % len(pool)
    window = (pool[off:] + pool[:off])[:take]      # ventana rotatoria (envuelve)
    return always + window
