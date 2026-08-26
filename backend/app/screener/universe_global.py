"""Universo COMPLETO de tickers desde HuggingFace — para la foto, no para el escaneo.

Dataset `adanosorg/free-global-stock-ticker-database` (licencia MIT, Adanos Software GmbH):
~63.000 tickers de 86 mercados con exchange, país, ISIN y tipo de instrumento. Se descarga el
CSV plano por HTTP, sin `datasets` ni `huggingface_hub`: es una tabla, no hace falta media
librería de ML para leerla.

El escaneo sigue tirando de las ~3.000 de NASDAQ (`universe.py`). Esto ensancha lo que se puede
FOTOGRAFIAR, que es otra cosa.
"""

from __future__ import annotations

import concurrent.futures
import csv
import io
import logging
import threading
import time
from datetime import UTC, datetime

import httpx

logger = logging.getLogger(__name__)

# Estado de la sincronización en segundo plano (mismo patrón que `foto_service.py`): la
# descarga+insert de ~63.000 filas dentro del propio request HTTP superaba el timeout del proxy
# (Railway corta ~30-60s) y como el único log era al final, un corte a mitad no dejaba NADA en
# logs -- visto en vivo el 25-ago-2026. Se lanza en un hilo y se consulta por polling, igual que
# la foto de fundamentales.
_state: dict = {
    "status": "idle",       # idle | running | done | error
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
}
_lock = threading.Lock()


def get_status() -> dict:
    with _lock:
        return dict(_state)

DATASET = "adanosorg/free-global-stock-ticker-database"
URL_CSV = f"https://huggingface.co/datasets/{DATASET}/resolve/main/tickers.csv"

_TIMEOUT = 120.0
_LOTE = 2_000
# HuggingFace corta la conexión a mitad de la descarga de vez en cuando ("incomplete chunked
# read", visto en vivo el 25-ago-2026, a la fila 44.000 de 63.000) -- es un corte de red
# transitorio de su lado, no un timeout nuestro, así que reintentar desde cero basta.
_REINTENTOS = 3
_ESPERA_REINTENTO_S = (10.0, 30.0)
# Cuántas tandas de sync se conservan. Dos es el mínimo que permite diffear qué entró y qué
# salió; más son 63.000 filas por tanda sin nadie que las lea (revisar junto con la retención).
_SYNCS_A_CONSERVAR = 2

# (columna del CSV, campo del modelo). El CSV trae además `etf_category` y `aliases`, fuera:
# el primero solo aplica a ETFs y el segundo es ayuda de búsqueda de su propio buscador.
_COLUMNAS = [
    ("ticker", "ticker"), ("exchange", "exchange"), ("name", "name"),
    ("asset_type", "asset_type"), ("stock_sector", "sector"),
    ("country", "country"), ("country_code", "country_code"), ("isin", "isin"),
]

# Venues que ya cotizan con el ticker pelado en Yahoo (sin importar el país de incorporación de
# la empresa -- hay ADRs/listados directos cayman, australianos, etc. bajo NASDAQ/NYSE). Medido
# en vivo (26-ago-2026): TODO lo demás (SZSE, TSE, KRX, LSE, ASX... 35.261 de 54.037 tickers)
# devuelve "sin datos" con el ticker pelado, sin excepciones encontradas -- necesitan el símbolo
# con sufijo que solo Yahoo mismo sabe dar (`_resolver_simbolo_por_isin`).
_EXCHANGES_SIN_SUFIJO = {"NASDAQ", "NYSE", "NYSE ARCA", "BATS", "NYSE MKT", "OTC"}

# El ISIN no vale como símbolo de consulta directo (`v8/finance/chart/<ISIN>` da 404) -- SOLO el
# buscador de Yahoo lo resuelve al símbolo real. 4 hilos: mismo ritmo ya validado para golpear
# Yahoo en `scan_service._GATHER_WORKERS`/`foto_service`.
_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
_SEARCH_HEADERS = {"User-Agent": "Mozilla/5.0"}
_RESOLVE_WORKERS = 4
_RESOLVE_429_BACKOFF_S = (3.0, 8.0)


# Topes de las columnas VARCHAR (ver `UniverseTicker`): el dataset es ajeno y Postgres sí
# rechaza un valor más largo, a diferencia de SQLite.
_TOPES = {"ticker": 32, "exchange": 32, "asset_type": 16, "sector": 64,
          "country": 64, "country_code": 8, "isin": 16, "name": 4096}


def _filas(url: str):  # noqa: ANN201
    """Streaming: 63.000 filas no caben cómodas en memoria dos veces (bytes crudos + dicts)."""
    with httpx.stream("GET", url, timeout=_TIMEOUT, follow_redirects=True) as r:
        r.raise_for_status()
        yield from csv.DictReader(r.iter_lines())


def _recortar(valor: str | None, tope: int) -> str | None:
    """El dataset es ajeno: un nombre larguísimo no puede tirar la sincronización entera."""
    if not valor:
        return None
    return valor[:tope]


def _insertar_filas(db, filas, sync_at: datetime, ya_insertados: set[str] | None = None) -> int:  # noqa: ANN001
    """Lógica común de inserción, sea el origen la descarga o un CSV subido a mano.

    `ya_insertados` (tickers ya en BD para este `sync_at`, de un intento anterior que se cortó
    a mitad) se salta en vez de reinsertar -- retomar es gratis porque el dataset es casi
    estático, y descargar nada de nuevo lo que ya teníamos sería tirar minutos de descarga real.

    Log de progreso cada lote (no solo al final): si el proceso muere a mitad, antes no quedaba
    NINGÚN rastro en logs de por dónde iba -- ahora sí."""
    from app.models import UniverseTicker

    vistos = ya_insertados or set()
    total, lote = len(vistos), []
    for fila in filas:
        ticker = (fila.get("ticker") or "").strip()
        if not ticker or ticker in vistos:
            continue
        vistos.add(ticker)
        registro = {"synced_at": sync_at, "source": DATASET}
        for col, campo in _COLUMNAS:
            registro[campo] = _recortar((fila.get(col) or "").strip() or None,
                                        _TOPES.get(campo, 64))
        lote.append(registro)
        if len(lote) >= _LOTE:
            db.bulk_insert_mappings(UniverseTicker, lote)
            total, lote = total + len(lote), []
            logger.info("Universo global: %d filas insertadas hasta ahora.", total)
    if lote:
        db.bulk_insert_mappings(UniverseTicker, lote)
        total += len(lote)
    db.commit()
    return total


def sincronizar(db, url: str = URL_CSV) -> dict:  # noqa: ANN001
    """Descarga el universo y lo añade como tanda nueva. No pisa la anterior (append-only).

    HuggingFace corta la conexión de vez en cuando a mitad de la descarga. Como el dataset es
    prácticamente estático, un reintento retoma donde se quedó (salta los tickers que ya están
    insertados para este `sync_at`) en vez de tirar lo ya descargado y empezar de cero."""
    from app.models import UniverseTicker

    sync_at = datetime.now(UTC)
    ultimo_error: Exception | None = None
    for intento in range(_REINTENTOS):
        if intento > 0:
            espera = _ESPERA_REINTENTO_S[min(intento - 1, len(_ESPERA_REINTENTO_S) - 1)]
            logger.warning("Universo global: reintentando descarga tras fallo (%s), espera %.0fs.",
                          ultimo_error, espera)
            time.sleep(espera)
        ya = {t for (t,) in db.query(UniverseTicker.ticker)
              .filter(UniverseTicker.synced_at == sync_at).all()}
        try:
            total = _insertar_filas(db, _filas(url), sync_at, ya_insertados=ya)
            break
        except httpx.HTTPError as exc:
            ultimo_error = exc
    else:
        raise RuntimeError(
            f"Descarga del universo global falló tras {_REINTENTOS} intentos: {ultimo_error}"
        ) from ultimo_error

    _resolver_todo(db, sync_at)
    podadas = _podar(db)
    logger.info("Universo global sincronizado: %d tickers (%d filas de syncs viejos podadas).",
                total, podadas)
    return {"tickers": total, "synced_at": sync_at.isoformat(), "podadas": podadas,
            "source": DATASET}


def sincronizar_desde_archivo(db, contenido: bytes) -> dict:  # noqa: ANN001
    """Igual que `sincronizar()` pero desde un CSV ya descargado a mano (mismo formato que
    `URL_CSV`) -- para cuando la red de HuggingFace no coopera y toca revisar el fichero antes
    de subirlo, o simplemente evitar la descarga en el propio servidor."""
    sync_at = datetime.now(UTC)
    filas = csv.DictReader(io.StringIO(contenido.decode("utf-8-sig")))
    total = _insertar_filas(db, filas, sync_at)

    _resolver_todo(db, sync_at)
    podadas = _podar(db)
    logger.info("Universo global sincronizado desde archivo: %d tickers (%d filas viejas podadas).",
                total, podadas)
    return {"tickers": total, "synced_at": sync_at.isoformat(), "podadas": podadas,
            "source": f"{DATASET} (subido a mano)"}


def _heredar_simbolos(db, sync_at: datetime) -> int:  # noqa: ANN001
    """Copia `yahoo_symbol` de la tanda anterior por ISIN antes de resolver nada -- el ISIN no
    cambia entre sincronizaciones, así que volver a resolver el mismo ticker cada vez sería
    tirar minutos de peticiones reales a la basura (el dataset es prácticamente estático)."""
    from app.models import UniverseTicker

    anterior = (db.query(UniverseTicker.synced_at)
               .filter(UniverseTicker.synced_at < sync_at, UniverseTicker.ticker.isnot(None))
               .distinct().order_by(UniverseTicker.synced_at.desc()).first())
    if not anterior:
        return 0
    previos = dict(
        db.query(UniverseTicker.isin, UniverseTicker.yahoo_symbol)
        .filter(UniverseTicker.synced_at == anterior[0], UniverseTicker.yahoo_symbol.isnot(None))
        .all()
    )
    if not previos:
        return 0
    nuevos = (db.query(UniverseTicker.id, UniverseTicker.isin)
             .filter(UniverseTicker.synced_at == sync_at, UniverseTicker.isin.in_(previos.keys()))
             .all())
    actualizaciones = [{"id": id_, "yahoo_symbol": previos[isin]} for id_, isin in nuevos]
    if actualizaciones:
        db.bulk_update_mappings(UniverseTicker, actualizaciones)
        db.commit()
    return len(actualizaciones)


def _resolver_simbolo_por_isin(isin: str) -> str | None:
    """Yahoo no acepta el ISIN como símbolo de consulta directo (`v8/finance/chart/<ISIN>` da
    404) -- solo su buscador lo resuelve al símbolo real con sufijo (comprobado en vivo: China,
    Corea, Japón, UK). Devuelve None si Yahoo no tiene ese ISIN (algunos mercados del dataset,
    ej. Nigeria, no están cubiertos -- no es un fallo, es que no hay nada que resolver)."""
    for espera in (*_RESOLVE_429_BACKOFF_S, None):
        try:
            r = httpx.get(_SEARCH_URL, params={"q": isin, "quotesCount": 1, "newsCount": 0},
                         headers=_SEARCH_HEADERS, timeout=15)
        except httpx.HTTPError:
            return None
        if r.status_code == 429 and espera is not None:
            time.sleep(espera)
            continue
        if r.status_code != 200:
            return None
        quotes = (r.json() or {}).get("quotes") or []
        return quotes[0].get("symbol") if quotes else None
    return None


def _resolver_simbolos(db, sync_at: datetime) -> None:  # noqa: ANN001
    """Resuelve `yahoo_symbol` para los tickers de mercados no-US de esta tanda que no vinieron
    ya heredados de `_heredar_simbolos`. 4 hilos (mismo ritmo ya validado contra Yahoo que
    `scan_service`/`foto_service`) -- esto es aparte del scraper de fundamentales, así que no
    comparte su circuit breaker ni su caché de sesión."""
    from app.models import UniverseTicker

    candidatos = (
        db.query(UniverseTicker.id, UniverseTicker.isin)
        .filter(UniverseTicker.synced_at == sync_at,
               UniverseTicker.yahoo_symbol.is_(None),
               UniverseTicker.isin.isnot(None),
               UniverseTicker.exchange.isnot(None),
               ~UniverseTicker.exchange.in_(_EXCHANGES_SIN_SUFIJO))
        .all()
    )
    if not candidatos:
        return
    logger.info("Universo global: resolviendo símbolo de Yahoo para %d tickers no-US.",
               len(candidatos))

    resueltos, sin_cobertura, actualizaciones = 0, 0, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=_RESOLVE_WORKERS) as pool:
        futuros = {pool.submit(_resolver_simbolo_por_isin, isin): id_ for id_, isin in candidatos}
        for i, fut in enumerate(concurrent.futures.as_completed(futuros), start=1):
            simbolo = fut.result()
            if simbolo:
                actualizaciones.append({"id": futuros[fut], "yahoo_symbol": simbolo})
                resueltos += 1
            else:
                sin_cobertura += 1
            if len(actualizaciones) >= _LOTE:
                db.bulk_update_mappings(UniverseTicker, actualizaciones)
                db.commit()
                actualizaciones = []
            if i % _LOTE == 0:
                logger.info("Universo global: %d/%d símbolos resueltos hasta ahora.",
                           i, len(candidatos))
    if actualizaciones:
        db.bulk_update_mappings(UniverseTicker, actualizaciones)
        db.commit()
    logger.info("Universo global: símbolos resueltos %d, sin cobertura en Yahoo %d (de %d).",
               resueltos, sin_cobertura, len(candidatos))


def _rellenar_simbolos_bare(db, sync_at: datetime) -> int:  # noqa: ANN001
    """Copia `ticker` a `yahoo_symbol` en los venues que ya cotizan pelados
    (`_EXCHANGES_SIN_SUFIJO`) y siguen sin él tras heredar/resolver.

    Sin esto, `yahoo_symbol IS NULL` mezclaba dos cosas distintas: "cotiza pelado, nunca hizo
    falta resolverlo" y "no se le encontró símbolo de verdad" -- y el gather no podía distinguir
    un ticker sin comprobar de uno sin comprobar QUE de verdad no tiene búsqueda posible. Tras
    esto, `yahoo_symbol IS NULL` significa solo lo segundo (ver `simbolos()`)."""
    from app.models import UniverseTicker

    candidatos = (
        db.query(UniverseTicker.id, UniverseTicker.ticker)
        .filter(UniverseTicker.synced_at == sync_at,
               UniverseTicker.yahoo_symbol.is_(None),
               UniverseTicker.exchange.in_(_EXCHANGES_SIN_SUFIJO))
        .all()
    )
    if not candidatos:
        return 0
    actualizaciones = [{"id": id_, "yahoo_symbol": ticker} for id_, ticker in candidatos]
    db.bulk_update_mappings(UniverseTicker, actualizaciones)
    db.commit()
    return len(actualizaciones)


def _resolver_todo(db, sync_at: datetime) -> None:  # noqa: ANN001
    """Heredar + resolver + rellenar bare, en ese orden -- llamado tras insertar cualquier tanda
    nueva (por red o por archivo), antes de podar la anterior (`_heredar_simbolos` todavía la
    necesita)."""
    heredados = _heredar_simbolos(db, sync_at)
    if heredados:
        logger.info("Universo global: %d símbolos heredados de la sincronización anterior.",
                   heredados)
    _resolver_simbolos(db, sync_at)
    rellenados = _rellenar_simbolos_bare(db, sync_at)
    if rellenados:
        logger.info("Universo global: %d símbolos bare rellenados (ticker == yahoo_symbol).",
                   rellenados)


def _run(contenido: bytes | None = None) -> None:
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        result = (sincronizar_desde_archivo(db, contenido) if contenido is not None
                 else sincronizar(db))
        with _lock:
            _state.update(status="done", result=result, error=None,
                          finished_at=datetime.now(UTC).isoformat())
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallo sincronizando el universo global.")
        with _lock:
            _state.update(status="error", error=str(exc),
                          finished_at=datetime.now(UTC).isoformat())
    finally:
        db.close()


def start(contenido: bytes | None = None) -> bool:
    """Lanza la sincronización en segundo plano (por red, o desde un CSV subido a mano si se
    pasa `contenido`). False si ya hay una en marcha."""
    with _lock:
        if _state["status"] == "running":
            return False
        _state.update(status="running", started_at=datetime.now(UTC).isoformat(),
                      finished_at=None, result=None, error=None)
    threading.Thread(target=_run, args=(contenido,), daemon=True).start()
    return True


def _podar(db) -> int:  # noqa: ANN001
    """Deja solo las `_SYNCS_A_CONSERVAR` tandas más recientes."""
    from app.models import UniverseTicker

    fechas = [f for (f,) in db.query(UniverseTicker.synced_at)
              .distinct().order_by(UniverseTicker.synced_at.desc()).all()]
    viejas = fechas[_SYNCS_A_CONSERVAR:]
    if not viejas:
        return 0
    n = (db.query(UniverseTicker)
         .filter(UniverseTicker.synced_at.in_(viejas))
         .delete(synchronize_session=False))
    db.commit()
    return n


def ultimo_sync(db) -> datetime | None:  # noqa: ANN001
    from sqlalchemy import func

    from app.models import UniverseTicker

    return db.query(func.max(UniverseTicker.synced_at)).scalar()


def _filtrar(q, countries: list[str] | None, exchanges: list[str] | None):  # noqa: ANN001, ANN201
    """Filtro común país/mercado (multi-select, AND entre sí) para `tickers`/`contar`."""
    from app.models import UniverseTicker

    if countries:
        q = q.filter(UniverseTicker.country.in_(countries))
    if exchanges:
        q = q.filter(UniverseTicker.exchange.in_(exchanges))
    return q


def tickers(db, exchange: str | None = None, asset_type: str | None = None,  # noqa: ANN001
           countries: list[str] | None = None, exchanges: list[str] | None = None) -> list[str]:
    """Tickers de la última tanda, opcionalmente filtrados por mercado, tipo, país(es) o
    mercado(s) (multi-select — `exchange` sigue existiendo aparte por compatibilidad, pero
    `exchanges` es el que usa el picker nuevo)."""
    from app.models import UniverseTicker

    ultimo = ultimo_sync(db)
    if ultimo is None:
        return []
    q = db.query(UniverseTicker.ticker).filter(UniverseTicker.synced_at == ultimo)
    if exchange:
        q = q.filter(UniverseTicker.exchange == exchange)
    if asset_type:
        q = q.filter(UniverseTicker.asset_type == asset_type)
    q = _filtrar(q, countries, exchanges)
    return [t for (t,) in q.all()]


def simbolos(db, exchange: str | None = None, asset_type: str | None = None,  # noqa: ANN001
            countries: list[str] | None = None,
            exchanges: list[str] | None = None) -> list[tuple[str, str | None]]:
    """Como `tickers()` pero devuelve (ticker, yahoo_symbol) -- para que la foto le pregunte a
    Yahoo por el símbolo con sufijo correcto cuando exista, sin perder el ticker del dataset
    como identidad de guardado (`foto_service.py`).

    Excluye `yahoo_symbol IS NULL`: tras `_resolver_todo` eso significa "sin ISIN o sin
    cobertura en el buscador de Yahoo" (los que sí cotizan pelados ya llevan `yahoo_symbol
    == ticker`, ver `_rellenar_simbolos_bare`), así que pedirle esto a Yahoo es un 404 seguro --
    ahorra la petición y el log."""
    from app.models import UniverseTicker

    ultimo = ultimo_sync(db)
    if ultimo is None:
        return []
    q = (db.query(UniverseTicker.ticker, UniverseTicker.yahoo_symbol)
         .filter(UniverseTicker.synced_at == ultimo, UniverseTicker.yahoo_symbol.isnot(None)))
    if exchange:
        q = q.filter(UniverseTicker.exchange == exchange)
    if asset_type:
        q = q.filter(UniverseTicker.asset_type == asset_type)
    q = _filtrar(q, countries, exchanges)
    return [(t, s) for t, s in q.all()]


def contar(db, countries: list[str] | None = None, exchanges: list[str] | None = None,  # noqa: ANN001
          asset_type: str | None = "Stock") -> int:
    """Cuenta EXACTA de tickers para una combinación de filtros — para el aviso de "vas a
    capturar N tickers" antes de confirmar, sin traerse la lista entera."""
    from app.models import UniverseTicker

    ultimo = ultimo_sync(db)
    if ultimo is None:
        return 0
    q = db.query(UniverseTicker.ticker).filter(UniverseTicker.synced_at == ultimo)
    if asset_type:
        q = q.filter(UniverseTicker.asset_type == asset_type)
    q = _filtrar(q, countries, exchanges)
    return q.count()


def opciones(db, asset_type: str | None = "Stock") -> dict:  # noqa: ANN001
    """Países y mercados de la última tanda con su recuento real (solo `asset_type`, "Stock"
    por defecto — lo que de verdad se va a capturar), para que el picker nunca sea "elige a
    ciegas". `None` en `ultimo_sync` → sin sincronizar todavía, listas vacías."""
    from sqlalchemy import func

    from app.models import UniverseTicker

    ultimo = ultimo_sync(db)
    if ultimo is None:
        return {"synced_at": None, "total": 0, "countries": [], "exchanges": []}

    base = db.query(UniverseTicker).filter(UniverseTicker.synced_at == ultimo)
    if asset_type:
        base = base.filter(UniverseTicker.asset_type == asset_type)
    total = base.count()

    base_grp = db.query(UniverseTicker).filter(UniverseTicker.synced_at == ultimo)
    if asset_type:
        base_grp = base_grp.filter(UniverseTicker.asset_type == asset_type)

    paises = (
        base_grp.with_entities(UniverseTicker.country, func.count(UniverseTicker.ticker))
        .filter(UniverseTicker.country.isnot(None))
        .group_by(UniverseTicker.country)
        .order_by(func.count(UniverseTicker.ticker).desc())
        .all()
    )
    mercados = (
        base_grp.with_entities(UniverseTicker.exchange, func.count(UniverseTicker.ticker))
        .filter(UniverseTicker.exchange.isnot(None))
        .group_by(UniverseTicker.exchange)
        .order_by(func.count(UniverseTicker.ticker).desc())
        .all()
    )
    return {
        "synced_at": ultimo.isoformat(),
        "total": total,
        "countries": [{"country": c, "count": n} for c, n in paises],
        "exchanges": [{"exchange": e, "count": n} for e, n in mercados],
    }
