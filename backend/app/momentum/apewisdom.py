"""Captura diaria de ApeWisdom (menciones sociales en Reddit) -- FASE 1: solo guardar.

apewisdom.io es publico y gratis, sin API key. Guarda una foto diaria por ticker para poder
medir mas adelante que es una "ruptura de menciones" de verdad -- hoy no hay ni un dia de
datos propios para fijar ningun umbral sin inventarselo (ver docs/momentum-sala-real-x.md,
seccion de universo y descubrimiento).

No dispara nada mas: no crea candidatos, no entra al universo, no gasta LLM. Eso es fase 2,
cuando haya semanas de datos reales para calibrar el umbral -- igual que el universo de 34
tickers no se fijo a ojo, se valido primero con datos.
"""
from __future__ import annotations

import logging
from datetime import date

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_URL = "https://apewisdom.io/api/v1.0/filter/all-stocks/page/1"


def _num(v) -> int | None:  # noqa: ANN001
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def capturar(db: Session) -> int:
    """Guarda la foto de hoy (top ~100 tickers por menciones). Idempotente por fecha+ticker --
    correr el job dos veces el mismo dia no duplica filas."""
    resp = httpx.get(_URL, timeout=15)
    resp.raise_for_status()
    resultados = resp.json().get("results", [])
    hoy = date.today()
    guardadas = 0
    for r in resultados:
        ticker = (r.get("ticker") or "").strip().upper()
        if not ticker:
            continue
        existe = db.execute(text(
            "select 1 from momentum_apewisdom where fecha = :f and ticker = :t"
        ), {"f": hoy, "t": ticker}).first()
        if existe:
            continue
        db.execute(text("""
            insert into momentum_apewisdom
              (fecha, ticker, rank, mentions, mentions_24h_ago, upvotes)
            values (:f, :t, :rank, :mentions, :m24, :up)
        """), {
            "f": hoy, "t": ticker, "rank": _num(r.get("rank")), "mentions": _num(r.get("mentions")),
            "m24": _num(r.get("mentions_24h_ago")), "up": _num(r.get("upvotes")),
        })
        guardadas += 1
    db.commit()
    return guardadas
