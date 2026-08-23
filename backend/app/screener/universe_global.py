"""Universo COMPLETO de tickers desde HuggingFace — para la foto, no para el escaneo.

Dataset `adanosorg/free-global-stock-ticker-database` (licencia MIT, Adanos Software GmbH):
~63.000 tickers de 86 mercados con exchange, país, ISIN y tipo de instrumento. Se descarga el
CSV plano por HTTP, sin `datasets` ni `huggingface_hub`: es una tabla, no hace falta media
librería de ML para leerla.

El escaneo sigue tirando de las ~3.000 de NASDAQ (`universe.py`). Esto ensancha lo que se puede
FOTOGRAFIAR, que es otra cosa.
"""

from __future__ import annotations

import csv
import logging
from datetime import UTC, datetime

import httpx

logger = logging.getLogger(__name__)

DATASET = "adanosorg/free-global-stock-ticker-database"
URL_CSV = f"https://huggingface.co/datasets/{DATASET}/resolve/main/tickers.csv"

_TIMEOUT = 120.0
_LOTE = 2_000
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


def sincronizar(db, url: str = URL_CSV) -> dict:  # noqa: ANN001
    """Descarga el universo y lo añade como tanda nueva. No pisa la anterior (append-only)."""
    from app.models import UniverseTicker

    sync_at = datetime.now(UTC)
    total, lote = 0, []
    for fila in _filas(url):
        ticker = (fila.get("ticker") or "").strip()
        if not ticker:
            continue
        registro = {"synced_at": sync_at, "source": DATASET}
        for col, campo in _COLUMNAS:
            registro[campo] = _recortar((fila.get(col) or "").strip() or None,
                                        _TOPES.get(campo, 64))
        lote.append(registro)
        if len(lote) >= _LOTE:
            db.bulk_insert_mappings(UniverseTicker, lote)
            total, lote = total + len(lote), []
    if lote:
        db.bulk_insert_mappings(UniverseTicker, lote)
        total += len(lote)
    db.commit()

    podadas = _podar(db)
    logger.info("Universo global sincronizado: %d tickers (%d filas de syncs viejos podadas).",
                total, podadas)
    return {"tickers": total, "synced_at": sync_at.isoformat(), "podadas": podadas,
            "source": DATASET}



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


def tickers(db, exchange: str | None = None, asset_type: str | None = None) -> list[str]:  # noqa: ANN001
    """Tickers de la última tanda, opcionalmente filtrados por mercado o tipo."""
    from app.models import UniverseTicker

    ultimo = ultimo_sync(db)
    if ultimo is None:
        return []
    q = db.query(UniverseTicker.ticker).filter(UniverseTicker.synced_at == ultimo)
    if exchange:
        q = q.filter(UniverseTicker.exchange == exchange)
    if asset_type:
        q = q.filter(UniverseTicker.asset_type == asset_type)
    return [t for (t,) in q.all()]
