"""Lecturas que los procesos hacen de las salas (`public`, solo lectura) y de la liga, ya en la
forma del motor. Nada se copia: la foto, las notas de Jev y los precios se leen donde viven."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable
from datetime import date
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.liga.models import Posicion, Receta, RespuestaIA
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import NotasJev, Respuesta
from app.liga.motor.seleccion import Receta as RecetaMotor

# Métricas de la foto que usa el catálogo (claves de yfinance en `fundamentals_snapshot.metricas`).
_METRICAS = {
    "dividendYield": "dividend_yield_pct",
    "revenueGrowth": "crecimiento_ventas",
    "operatingMargins": "margen_operativo",
    "returnOnEquity": "roe",
    "totalDebt": "deuda_total",
    "totalCash": "caja_total",
    "ebitda": "ebitda",
}
_SIN_DATO = {"", "n/d", "none"}


def _texto(valor: str | None) -> str | None:
    if valor is None or valor.strip().lower() in _SIN_DATO:
        return None
    return valor.strip()


def cargar_empresas(db: Session, foto_id: int,
                    tickers: Iterable[str] | None = None) -> list[EmpresaFoto]:
    """Las empresas de una foto, una por ticker (si se capturó dos veces, la última)."""
    filtro_tickers = "and s.ticker = any(:tickers)" if tickers is not None else ""
    params: dict[str, object] = {"f": foto_id}
    if tickers is not None:
        tickers = sorted(set(tickers))
        if not tickers:
            return []
        params["tickers"] = tickers
    filas = db.execute(text(f"""
        select distinct on (s.ticker) s.id, s.ticker, s.name, s.sector, s.industry,
               s.market_cap_usd, s.price, s.high_52w, s.pe_trailing, s.metricas
        from fundamentals_snapshot s
        where s.foto_id = :f
          {filtro_tickers}
        order by s.ticker, s.id desc
    """), params).all()
    return [EmpresaFoto(ticker=f.ticker, nombre=_texto(f.name), sector=_texto(f.sector),
                        industria=_texto(f.industry), market_cap_usd=f.market_cap_usd,
                        precio=f.price, max_52s=f.high_52w, per=f.pe_trailing,
                        **_metricas_catalogo(f.metricas))
            for f in filas]


def _metricas_catalogo(metricas: dict | str | None) -> dict[str, float]:
    """Las métricas del catálogo que vengan como número real en el jsonb de la foto."""
    if isinstance(metricas, str):
        metricas = json.loads(metricas)
    return {destino: float(v) for clave, destino in _METRICAS.items()
            if isinstance(v := (metricas or {}).get(clave), (int, float))
            and not isinstance(v, bool)}


def cargar_notas(db: Session, scan_run_id: int) -> dict[str, NotasJev]:
    """Las 4 notas de Jev de cada empresa del escaneo; sin las 4, la empresa no tiene nota."""
    notas: dict[str, NotasJev] = {}
    for f in db.execute(text("""
        select distinct on (ticker) ticker, jev_fundamentals, jev_valuation, jev_financing,
               jev_catalyst
        from scan_audit
        where scan_run_id = :s and jev_fundamentals is not null
        order by ticker, id desc
    """), {"s": scan_run_id}).all():
        n = NotasJev.desde_bd(f.jev_fundamentals, f.jev_valuation, f.jev_financing,
                              f.jev_catalyst)
        if n is not None:
            notas[f.ticker] = n
    return notas


def n_notas(db: Session, scan_run_id: int) -> int:
    return db.execute(text(
        "select count(distinct ticker) from scan_audit "
        "where scan_run_id = :s and jev_fundamentals is not null"), {"s": scan_run_id}).scalar()


def normalizar_pregunta(pregunta: str) -> str:
    """La misma pregunta escrita con otras mayúsculas, tildes compuestas o espacios es la misma."""
    t = unicodedata.normalize("NFKC", pregunta).casefold()
    return re.sub(r"\s+", " ", t).strip()


def hash_pregunta(pregunta: str) -> str:
    """Clave de la caché `liga.respuestas_ia`: sha256 de la pregunta normalizada."""
    return hashlib.sha256(normalizar_pregunta(pregunta).encode()).hexdigest()


def cargar_respuestas(db: Session, pregunta: str | None, foto_id: int) -> dict[str, Respuesta]:
    """Solo de la caché: aquí no se llama a ninguna IA."""
    if not pregunta:
        return {}
    filas = db.scalars(select(RespuestaIA).where(
        RespuestaIA.pregunta_hash == hash_pregunta(pregunta), RespuestaIA.foto_id == foto_id))
    return {r.ticker: Respuesta(r.si, r.seguridad) for r in filas}


def receta_motor(r: Receta) -> RecetaMotor:
    return RecetaMotor(
        reglas=list(r.reglas or []), excluidas=tuple(r.excluidas or ()),
        pesos={"negocio": r.peso_negocio, "precio": r.peso_precio, "deuda": r.peso_deuda,
               "pronto": r.peso_pronto, "pregunta": r.peso_pregunta},
        n_empresas=r.n_empresas, reparto=r.reparto, max_por_sector=r.max_por_sector,
        catalogo_version=r.catalogo_version)


def con_cierre(db: Session, tickers: Iterable[str], dia: date) -> set[str]:
    """Los tickers que tienen cierre guardado ese día."""
    lista = sorted(set(tickers))
    if not lista:
        return set()
    return set(db.execute(text(
        "select ticker from precio_cierre where dia = :d and ticker = any(:t)"),
        {"d": dia, "t": lista}).scalars())


def posiciones(db: Session, inscripcion_ids: Iterable[int]) -> dict[int, list[tuple[str, Decimal]]]:
    ids = list(inscripcion_ids)
    out: dict[int, list[tuple[str, Decimal]]] = {i: [] for i in ids}
    if not ids:
        return out
    for p in db.scalars(select(Posicion).where(Posicion.inscripcion_id.in_(ids))
                        .order_by(Posicion.inscripcion_id, Posicion.peso.desc(), Posicion.ticker)):
        out[p.inscripcion_id].append((p.ticker, Decimal(p.peso)))
    return out
