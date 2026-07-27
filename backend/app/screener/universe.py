"""Universo de escaneo — se genera DINÁMICAMENTE sobre TODO el mercado US.

Fuente: **API pública de screener de NASDAQ** (gratis, SIN key) — devuelve TODO el mercado US
(NYSE+NASDAQ+AMEX, no solo NASDAQ) con market cap, precio y volumen en una llamada. Filtramos
localmente por elegibilidad OBJETIVA (no opinión): precio ≥$5, **volumen en DÓLARES ≥$3M**,
SIN suelo de capitalización, dedup de clases de acción (GOOGL/GOOG → la más líquida) y **tope
de 2.600 nombres por dinero negociado**. Cero listas a mano, cero sesgo.

Tres decisiones que parecen detalles y no lo son:

1. **SNAPSHOT DIARIO CON LA SESIÓN CERRADA.** El campo `volume` de NASDAQ es el volumen
   ACUMULADO DE LA SESIÓN EN CURSO, no una media (verificado: AAPL marcaba 28,7M a mitad de
   sesión con una media de 48,9M). Como el escaneo corre 45 min después de abrir, filtrar en
   caliente dejaba fuera a casi todo el mercado (426 nombres el 21-jul frente a ~2.600) y, peor,
   dejaba dentro justo a los que tenían actividad anormal esa mañana — un sesgo de "valores en
   juego hoy" que nadie pidió. Por eso el universo se fotografía UNA VEZ AL DÍA con la bolsa
   cerrada (`refresh_snapshot`, lo llama el job de las 16:30 ET) y los escaneos leen esa foto.
2. **LIQUIDEZ EN DÓLARES, NO EN ACCIONES.** Contar acciones castiga a los valores caros: PLMR
   mueve $41M al día y se quedaba fuera por no llegar a 300k acciones. Lo que importa para poder
   entrar y salir es el dinero negociado.
3. **TOPE DURO ADEMÁS DEL SUELO.** Un umbral fijo deja el tamaño del universo —y por tanto el
   coste, que es una llamada de Flash por nombre— en manos de lo movida que estuviera la sesión
   fotografiada: la misma descarga da 2.317 o 2.731 nombres según cuánto se hubiera negociado
   ya. El tope de `universe_max_names` corta por dinero negociado, así que el gasto queda
   acotado por diseño y lo que se cae son siempre los menos líquidos.

Fallback: si no hay foto y NASDAQ falla, un SEED offline mínimo solo para no bloquear la
maquinaria — pero eso se anuncia a gritos en el informe del escaneo (40 nombres no son un
universo).
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Caché en memoria: el universo se refresca 1 vez al día (la composición cambia despacio).
_cache: tuple[date, list[str]] | None = None
_SNAPSHOT_KEY = "universe_snapshot"     # foto del universo del último cierre (tabla Meta)
_NASDAQ_RETRIES = 4
_NASDAQ_BACKOFF = 20.0                  # segundos; se dobla en cada intento (20 · 40 · 80)

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


def _from_nasdaq() -> list[tuple[str, float, float]]:
    """Filas elegibles del screener: [(símbolo, precio, volumen)], sin la puerta de liquidez.

    La liquidez se aplica al LEER (`_liquidos`) para poder mover el listón sin volver a pedir
    nada a NASDAQ; aquí solo va la higiene que no depende de la hora (símbolo, cap, precio,
    dedup de clases).
    """
    params = {"tableonly": "true", "limit": "0", "download": "true"}
    rows: list[dict] = []
    # Reintentos con espera creciente: NASDAQ responde 200 con el cuerpo VACÍO cuando no le
    # apetece servir (visto varias veces seguidas, y no es un bloqueo a nuestra IP). Como esto
    # se pide una vez al día, esperar un par de minutos sale gratis y evita quedarnos sin foto.
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
    """Universo elegible: suelo de liquidez EN DÓLARES + tope duro por dinero negociado.

    Son dos cortes porque hacen cosas distintas. El SUELO es higiene: por debajo de
    `universe_min_dollar_volume` no hay mercado en el que entrar y salir. El TOPE es
    PRESUPUESTO: el pre-scorer gasta una llamada por nombre, así que el universo no puede
    depender de a qué hora se sacó la foto ni de si aquel viernes de agosto la sesión estuvo
    muerta. En una sesión normal muerde el tope; en una floja, el suelo.

    Se devuelve ALFABÉTICO, no por volumen: la ventana rotatoria de `sample_for_scan` necesita
    un orden estable entre escaneos, y el ranking de volumen del día no lo es.
    """
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


def snapshot_date(db) -> date | None:  # noqa: ANN001
    """Fecha (ET) de la foto guardada, o None si no hay. Lectura barata, sin red."""
    from app.models import Meta

    row = db.get(Meta, _SNAPSHOT_KEY)
    if not row:
        return None
    try:
        at = datetime.fromisoformat(json.loads(row.value)["at"])
    except (ValueError, KeyError, TypeError):
        return None
    return at.astimezone(ZoneInfo(settings.scan_timezone)).date()


def refresh_snapshot(db) -> int:  # noqa: ANN001
    """Fotografía el universo y lo persiste. Se llama CON LA BOLSA CERRADA (job de 16:30 ET),
    que es cuando el volumen del día ya está completo. Devuelve cuántas filas guardó."""
    from app.models import Meta

    filas = _from_nasdaq()
    payload = json.dumps({"at": datetime.now(UTC).isoformat(),
                          "rows": [[s, px, vol] for s, px, vol in filas]})
    row = db.get(Meta, _SNAPSHOT_KEY)
    if row:
        row.value = payload
    else:
        db.add(Meta(key=_SNAPSHOT_KEY, value=payload))
    db.commit()
    logger.info("Foto del universo: %d filas elegibles, %d sobre el suelo de liquidez, "
                "%d tras el tope.", len(filas), len(_sobre_suelo(filas)), len(_liquidos(filas)))
    return len(filas)


def universe_for_scan(db) -> tuple[list[str], dict]:  # noqa: ANN001
    """(símbolos, procedencia) para un escaneo. Prefiere la foto del último cierre.

    `procedencia` = {"fuente": cierre|vivo|seed, "at": iso|None, "dias": int|None, "size": n,
    "sobre_suelo": n} y viaja al informe del escaneo: si algún día se trabaja con 40 nombres, con
    una foto de hace una semana o con un tope que se está comiendo media bolsa, tiene que verse
    en la web, no en los logs. `sobre_suelo` > `size` significa que mordió el tope.
    """
    from app.models import Meta

    row = db.get(Meta, _SNAPSHOT_KEY)
    if row:
        try:
            data = json.loads(row.value)
            filas = [(s, float(px), float(vol)) for s, px, vol in data.get("rows", [])]
        except Exception:
            logger.exception("Foto del universo ilegible → se reconstruye en vivo.")
            filas = []
        if filas:
            symbols = _liquidos(filas)
            at = data.get("at", "")
            try:
                dias = (datetime.now(UTC) - datetime.fromisoformat(at)).days
            except ValueError:
                dias = None
            return symbols, {"fuente": "cierre", "at": at, "dias": dias, "size": len(symbols),
                             "sobre_suelo": len(_sobre_suelo(filas))}

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
    """Nombres a analizar en un escaneo.

    `always_include` (posiciones + watchlist, SIEMPRE dentro) + el universo. Si `n` es None (o
    ≥ tamaño total) → TODO el universo (cobertura completa). Si `n` es un número → ventana
    ROTATORIA de tamaño n a partir de `offset` (envuelve al final del universo ordenado), para que
    semanas consecutivas tejan el universo SIN REPETIR. El caller persiste `offset` (0 = desde el
    inicio). El universo llega ordenado, así que cada ventana es un tramo estable y disjunto.
    """
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
