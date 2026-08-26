"""Universo de escaneo: TODO el mercado US vía el screener público de NASDAQ (gratis).

Filtra por precio y liquidez en DÓLARES con tope duro; foto con bolsa CERRADA (volumen completo)."""

from __future__ import annotations

import logging
import re
import time
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# In-memory cache; daily refresh (composition changes slowly).
_cache: tuple[date, list[str]] | None = None
_NASDAQ_RETRIES = 4
_NASDAQ_BACKOFF = 20.0
# Tandas de snapshot a conservar -- mismo criterio y mismo número que `universe_global.py`
# (`_SYNCS_A_CONSERVAR`): el mínimo que permite diffear qué entró y qué salió sin acumular
# 3.000 filas por día para siempre sin que nadie las lea.
_SNAPSHOTS_A_CONSERVAR = 2

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
    """Screener ticker → yfinance format; filters out preferred/series/warrants.

    Accepts letters and classes with slash (BRK/B → BRK-B)."""
    if not _SYMBOL_RE.match(symbol):
        return None
    return symbol.replace("/", "-")


def _from_nasdaq() -> list[tuple[str, float, float]]:
    """Eligible rows: [(symbol, price, volume)] without liquidity gate.

    Liquidity filter applied at read time for dynamic threshold adjustments."""
    params = {"tableonly": "true", "limit": "0", "download": "true"}
    rows: list[dict] = []
    # Retries with exponential backoff; NASDAQ sometimes returns 200 with empty body.
    for intento in range(_NASDAQ_RETRIES):
        try:
            with httpx.Client(timeout=30.0, headers=_NASDAQ_HEADERS) as client:
                resp = client.get(NASDAQ_SCREENER_URL, params=params)
                resp.raise_for_status()
                rows = (resp.json().get("data") or {}).get("rows") or []
        except Exception as exc:  # noqa: BLE001 — se reintenta y, si no, sale por el raise final
            logger.warning("NASDAQ falló (intento %d/%d): %s", intento + 1, _NASDAQ_RETRIES, exc)
        if rows:
            break
        if intento + 1 < _NASDAQ_RETRIES:
            time.sleep(_NASDAQ_BACKOFF * (2 ** intento))
    if not rows:
        raise RuntimeError(f"NASDAQ no devolvió listado en {_NASDAQ_RETRIES} intentos")

    cap_min = settings.universe_market_cap_min
    cap_max = settings.universe_market_cap_max
    price_min = settings.universe_min_price
    # Dedup de clases: por empresa, nos quedamos con la más LÍQUIDA → {company_key: (sym, px, vol)}
    best: dict[str, tuple[str, float, float]] = {}
    for row in rows:
        symbol = _norm_symbol((row.get("symbol") or "").strip().upper())
        if symbol is None:
            continue
        cap = _parse_market_cap(row.get("marketCap", ""))
        if cap is None or not (cap_min <= cap <= cap_max):
            continue
        # Precio vivo reciente (lastsale): sin precio → fuera; suelo de config (higiene anti-penny).
        price = _parse_market_cap(row.get("lastsale", ""))  # el parser ya quita el '$'
        if price is None or price < price_min:
            continue
        vol = _parse_market_cap(row.get("volume", "")) or 0.0   # mismo parser (número plano)
        key = _company_key(row.get("name", ""), symbol)
        if key not in best or vol > best[key][2]:
            best[key] = (symbol, price, vol)
    return sorted(best.values())


def _sobre_suelo(filas: list[tuple[str, float, float]]) -> list[tuple[str, float, float]]:
    """Filas que superan el suelo de liquidez, de MÁS a MENOS dinero negociado."""
    minimo = settings.universe_min_dollar_volume
    return sorted((f for f in filas if f[1] * f[2] >= minimo), key=lambda f: -(f[1] * f[2]))


def _liquidos(filas: list[tuple[str, float, float]]) -> list[str]:
    """Eligible universe: dollar-volume floor + hard cap on names scanned.

    Returned alphabetically (not by volume) for stable rotation in sample_for_scan."""
    return sorted(sym for sym, _px, _vol in _sobre_suelo(filas)[:settings.universe_max_names])


def build_universe(force_refresh: bool = False) -> list[str]:
    """Universo EN VIVO desde NASDAQ, cacheado por día.

    OJO: con el mercado ABIERTO el volumen va a medias y esto devuelve una fracción del mercado.
    El escaneo usa `universe_for_scan`, que prefiere la foto del último cierre.
    """
    global _cache
    if not force_refresh and _cache is not None and _cache[0] == date.today():
        return _cache[1]
    try:
        symbols = _liquidos(_from_nasdaq())
        if symbols:
            logger.info("Universo NASDAQ (en vivo): %d nombres elegibles.", len(symbols))
            _cache = (date.today(), symbols)
            return symbols
    except Exception:
        logger.exception("Fallo consultando NASDAQ → usando SEED de fallback.")
    logger.warning("Usando SEED de fallback (no autónomo).")
    return list(_SEED_FALLBACK)


def _ultimo_snapshot_at(db) -> datetime | None:  # noqa: ANN001
    from sqlalchemy import func

    from app.models import NasdaqSnapshotTicker

    at = db.query(func.max(NasdaqSnapshotTicker.snapshot_at)).scalar()
    if at is None:
        return None
    # SQLite devuelve el datetime naive pese a DateTime(timezone=True) -- mismo patrón que
    # `fundamentals.foto_reciente`. En Postgres ya viene aware, esto no cambia nada ahí.
    return at if at.tzinfo is not None else at.replace(tzinfo=UTC)


def _filas_de(db, at: datetime) -> list[tuple[str, float, float]]:  # noqa: ANN001
    """Filas `(ticker, price, volume)` de una tanda concreta -- común a
    `refresh_snapshot_and_report`/`universe_for_scan`, que leen la misma tanda por motivos
    distintos (informar vs decidir el universo de escaneo)."""
    from app.models import NasdaqSnapshotTicker

    return [(t, float(px), float(vol)) for t, px, vol in
            db.query(NasdaqSnapshotTicker.ticker, NasdaqSnapshotTicker.price,
                     NasdaqSnapshotTicker.volume)
            .filter(NasdaqSnapshotTicker.snapshot_at == at).all()]


def _podar_snapshots(db) -> int:  # noqa: ANN001
    """Deja solo las `_SNAPSHOTS_A_CONSERVAR` tandas más recientes -- mismo patrón que
    `universe_global._podar`."""
    from app.models import NasdaqSnapshotTicker

    fechas = [f for (f,) in db.query(NasdaqSnapshotTicker.snapshot_at)
              .distinct().order_by(NasdaqSnapshotTicker.snapshot_at.desc()).all()]
    viejas = fechas[_SNAPSHOTS_A_CONSERVAR:]
    if not viejas:
        return 0
    n = (db.query(NasdaqSnapshotTicker)
         .filter(NasdaqSnapshotTicker.snapshot_at.in_(viejas))
         .delete(synchronize_session=False))
    db.commit()
    return n


def snapshot_date(db) -> date | None:  # noqa: ANN001
    """Fecha (ET) de la foto guardada, o None si no hay. Lectura barata, sin red."""
    at = _ultimo_snapshot_at(db)
    if at is None:
        return None
    return at.astimezone(ZoneInfo(settings.scan_timezone)).date()


def refresh_snapshot(db) -> int:  # noqa: ANN001
    """Snapshot universe and persist como tanda NUEVA (append-only, igual que `UniverseTicker` —
    no pisa la anterior, así se ve qué entra y qué sale día a día). Called with market closed
    (daily volume complete). Returns row count."""
    from app.models import NasdaqSnapshotTicker

    filas = _from_nasdaq()
    snapshot_at = datetime.now(UTC)
    db.bulk_insert_mappings(NasdaqSnapshotTicker, [
        {"snapshot_at": snapshot_at, "ticker": s, "price": px, "volume": vol}
        for s, px, vol in filas
    ])
    db.commit()
    _podar_snapshots(db)
    logger.info("Foto del universo: %d filas elegibles, %d sobre el suelo de liquidez, "
                "%d tras el tope.", len(filas), len(_sobre_suelo(filas)), len(_liquidos(filas)))
    return len(filas)


def refresh_snapshot_and_report(db) -> dict:  # noqa: ANN001
    """Manual snapshot refresh; returns {"at": iso, "size": n} for API.

    Always forces download (unlike scheduled job); no today-check."""
    refresh_snapshot(db)                     # descarga y persiste; si falla, la excepción sube
    at = _ultimo_snapshot_at(db)
    filas = _filas_de(db, at) if at else []
    return {"at": at.isoformat() if at else None, "size": len(_liquidos(filas))}


def universe_for_scan(db) -> tuple[list[str], dict]:  # noqa: ANN001
    """(symbols, provenance) for scan; prefers last-close snapshot.

    Provenance travels to report; sobre_suelo > size = cap bite."""
    at = _ultimo_snapshot_at(db)
    if at is not None:
        filas = _filas_de(db, at)
        if filas:
            symbols = _liquidos(filas)
            dias = (datetime.now(UTC) - at).days
            return symbols, {"fuente": "cierre", "at": at.isoformat(), "dias": dias,
                             "size": len(symbols), "sobre_suelo": len(_sobre_suelo(filas))}

    try:
        filas = _from_nasdaq()
        symbols = _liquidos(filas)
        if symbols:
            return symbols, {"fuente": "vivo", "at": None, "dias": None, "size": len(symbols),
                             "sobre_suelo": len(_sobre_suelo(filas))}
    except Exception:
        logger.exception("Fallo consultando NASDAQ y sin foto previa → SEED de fallback.")
    return list(_SEED_FALLBACK), {"fuente": "seed", "at": None, "dias": None,
                                  "size": len(_SEED_FALLBACK),
                                  "sobre_suelo": len(_SEED_FALLBACK)}


def sample_for_scan(always_include: list[str], n: int | None, offset: int = 0,
                    universe: list[str] | None = None) -> list[str]:
    """Names to scan: always_include (positions/watchlist) + rotating universe window.

    If n is None: full universe. Else: rotating window (wraps) for weekly coverage without repeat."""
    always = list(dict.fromkeys(t.upper() for t in always_include if t))  # dedup, mantiene orden
    if universe is None:                       # sin universo dado, en vivo (tests y usos sueltos)
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
