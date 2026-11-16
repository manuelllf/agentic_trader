"""Barras diarias (OHLC, volumen, dividendos y splits) de Yahoo, tal como se negociaron.

Mismo criterio que `app.precios`: se deshace el ajuste por splits de Yahoo. Solo `descargar`
usa la red.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TypeGuard

from app.ledger.money import D

logger = logging.getLogger(__name__)

_SEIS = Decimal("0.000001")
INTENTOS_YAHOO = 3
_PAUSA_S = 5.0


@dataclass(frozen=True)
class FilaYahoo:
    """Fila diaria en float tal como la entrega Yahoo (ajustada por los splits posteriores)."""

    dia: date
    open: float
    high: float
    low: float
    close: float
    volume: float
    dividend: float
    split: float


@dataclass(frozen=True)
class Barra:
    dia: date
    apertura: Decimal | None
    maximo: Decimal | None
    minimo: Decimal | None
    cierre: Decimal
    volumen: int | None
    dividendo: Decimal
    split: Decimal  # 1 = no hubo split


def _valido(x: float | None) -> TypeGuard[float]:
    return x is not None and not math.isnan(x)


def _dec(x: float) -> Decimal:
    return D(x).quantize(_SEIS)


def _precio(x: float | None, factor: float) -> Decimal | None:
    return _dec(x * factor) if _valido(x) else None


def deshacer_ajuste(filas: list[FilaYahoo]) -> list[Barra]:
    """Filas de Yahoo a barras tal como se negociaron, ordenadas por día.

    El split de un día afecta a los días anteriores, no al propio día; split 0 o NaN es 1."""
    factor = 1.0
    out: list[Barra] = []
    for f in sorted(filas, key=lambda r: r.dia, reverse=True):
        if not _valido(f.close) or f.close <= 0:
            continue
        split = f.split if _valido(f.split) and f.split > 0 else 1.0
        dividendo = f.dividend if _valido(f.dividend) else 0.0
        volumen = int(round(f.volume / factor)) if _valido(f.volume) else None
        out.append(Barra(
            dia=f.dia,
            apertura=_precio(f.open, factor),
            maximo=_precio(f.high, factor),
            minimo=_precio(f.low, factor),
            cierre=_dec(f.close * factor),
            volumen=volumen,
            dividendo=_dec(dividendo * factor),
            split=_dec(split),
        ))
        factor *= split
    return sorted(out, key=lambda b: b.dia)


def _campo(r, nombre: str, defecto: float) -> float:  # noqa: ANN001
    v = r.get(nombre, defecto)
    try:
        return float(v)
    except (TypeError, ValueError):
        return defecto


def descargar(tickers: list[str], desde: date) -> dict[str, list[Barra]]:
    """Barras de Yahoo desde `desde` hasta hoy; un ticker sin datos no aparece."""
    import yfinance as yf

    tickers = list(dict.fromkeys(t for t in tickers if t))
    if not tickers:
        return {}
    # Yahoo a veces responde vacío a un lote grande y a la siguiente vez sí: se reintenta.
    df = None
    for intento in range(1, INTENTOS_YAHOO + 1):
        try:
            df = yf.download(tickers, start=desde, interval="1d", auto_adjust=False, actions=True,
                             group_by="ticker", threads=True, progress=False, timeout=10)
        except Exception:
            logger.exception("Yahoo falló (intento %d de %d)", intento, INTENTOS_YAHOO)
            df = None
        if df is not None and not df.empty:
            break
        if intento < INTENTOS_YAHOO:
            time.sleep(_PAUSA_S)
    if df is None or df.empty:
        logger.error("Yahoo no devolvió barras para %d tickers tras %d intentos",
                     len(tickers), INTENTOS_YAHOO)
        return {}
    multi = getattr(df.columns, "nlevels", 1) > 1
    nan = float("nan")
    out: dict[str, list[Barra]] = {}
    for t in tickers:
        try:
            sub = df[t] if multi else df
        except KeyError:
            continue
        filas = [
            FilaYahoo(
                dia=idx.date(),
                open=_campo(r, "Open", nan),
                high=_campo(r, "High", nan),
                low=_campo(r, "Low", nan),
                close=_campo(r, "Close", nan),
                volume=_campo(r, "Volume", nan),
                dividend=_campo(r, "Dividends", 0.0),
                split=_campo(r, "Stock Splits", 0.0),
            )
            for idx, r in sub.iterrows()
        ]
        barras = deshacer_ajuste(filas)
        if barras:
            out[t] = barras
    return out


def barra_del_dia(barras: list[Barra], dia: date) -> Barra | None:
    """La barra de ese día exacto, o None si no hubo sesión."""
    return next((b for b in barras if b.dia == dia), None)


def ultimo_cierre_hasta(barras: list[Barra], dia: date) -> Barra | None:
    """Última barra con fecha igual o anterior a `dia` (cubre festivos y fines de semana)."""
    previas = [b for b in barras if b.dia <= dia]
    return max(previas, key=lambda b: b.dia) if previas else None
