"""Barras diarias (OHLC, volumen, dividendos y splits) de Yahoo, tal como se negociaron.

Mismo criterio que `app.precios`: se deshace el ajuste por splits de Yahoo. Solo `descargar` y
`descargar_extendido` usan la red.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime
from datetime import time as hora
from decimal import Decimal
from enum import StrEnum
from typing import Any, TypeGuard

from app.ledger.money import D
from app.mercado.calendario import TZ_NUEVA_YORK

logger = logging.getLogger(__name__)

_SEIS = Decimal("0.000001")
INTENTOS_YAHOO = 3
_PAUSA_S = 5.0


class Franja(StrEnum):
    """Horario extendido de Nueva York, fuera de la sesión regular (9:30 a 16:00)."""

    PREMARKET = "premarket"
    POSTMARKET = "postmarket"


_FRANJAS = {Franja.PREMARKET: (hora(4, 0), hora(9, 30)),
            Franja.POSTMARKET: (hora(16, 0), hora(20, 0))}


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


def _bajar(tickers: list[str], **opciones: Any) -> Any:  # noqa: ANN401
    """Pide un lote a Yahoo; None si no devuelve nada tras los reintentos."""
    import yfinance as yf

    # Yahoo a veces responde vacío a un lote grande y a la siguiente vez sí: se reintenta.
    df = None
    for intento in range(1, INTENTOS_YAHOO + 1):
        try:
            df = yf.download(tickers, auto_adjust=False, group_by="ticker", threads=True,
                             progress=False, timeout=10, **opciones)
        except Exception:
            logger.exception("Yahoo falló (intento %d de %d)", intento, INTENTOS_YAHOO)
            df = None
        if df is not None and not df.empty:
            return df
        if intento < INTENTOS_YAHOO:
            time.sleep(_PAUSA_S)
    logger.error("Yahoo no devolvió barras para %d tickers tras %d intentos",
                 len(tickers), INTENTOS_YAHOO)
    return None


def _tabla_de_cada_ticker(df: Any, tickers: list[str]) -> Iterator[tuple[str, Any]]:  # noqa: ANN401
    """La tabla de cada ticker del lote; el que Yahoo no trae no aparece."""
    multi = getattr(df.columns, "nlevels", 1) > 1
    for t in tickers:
        try:
            yield t, (df[t] if multi else df)
        except KeyError:
            continue


def descargar(tickers: list[str], desde: date) -> dict[str, list[Barra]]:
    """Barras de Yahoo desde `desde` hasta hoy; un ticker sin datos no aparece."""
    tickers = list(dict.fromkeys(t for t in tickers if t))
    if not tickers:
        return {}
    df = _bajar(tickers, start=desde, interval="1d", actions=True)
    if df is None:
        return {}
    nan = float("nan")
    out: dict[str, list[Barra]] = {}
    for t, sub in _tabla_de_cada_ticker(df, tickers):
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


@dataclass(frozen=True)
class Extendido:
    """Último precio y volumen acumulado de una franja de horario extendido."""

    ticker: str
    ultimo: Decimal
    volumen: int
    hasta: datetime  # hora de Nueva York de la última barra


def _resumir_franja(ticker: str, tabla: Any, dia: date, franja: Franja) -> Extendido | None:  # noqa: ANN401
    desde, hasta = _FRANJAS[franja]
    ultimo: float | None = None
    momento: datetime | None = None
    volumen = 0
    for ts, r in tabla.iterrows():
        ts = ts.tz_convert(TZ_NUEVA_YORK) if ts.tzinfo else ts.tz_localize(TZ_NUEVA_YORK)
        if ts.date() != dia or not desde <= ts.time() < hasta:
            continue
        cierre = _campo(r, "Close", float("nan"))
        if not _valido(cierre) or cierre <= 0:
            continue
        v = _campo(r, "Volume", 0.0)
        volumen += int(v) if _valido(v) else 0
        if momento is None or ts >= momento:
            ultimo, momento = cierre, ts.to_pydatetime()
    if ultimo is None or momento is None:
        return None
    return Extendido(ticker, _dec(ultimo), volumen, momento)


def descargar_extendido(tickers: list[str], franja: Franja, dia: date) -> dict[str, Extendido]:
    """Último precio y volumen de la franja de ese día, con barras de un minuto de Yahoo.

    Una empresa sin operaciones en la franja no aparece; sin red devuelve vacío."""
    tickers = list(dict.fromkeys(t for t in tickers if t))
    if not tickers:
        return {}
    df = _bajar(tickers, period="1d", interval="1m", prepost=True)
    if df is None:
        return {}
    out: dict[str, Extendido] = {}
    for t, tabla in _tabla_de_cada_ticker(df, tickers):
        resumen = _resumir_franja(t, tabla, dia, franja)
        if resumen is not None:
            out[t] = resumen
    return out


def barra_del_dia(barras: list[Barra], dia: date) -> Barra | None:
    """La barra de ese día exacto, o None si no hubo sesión."""
    return next((b for b in barras if b.dia == dia), None)


def ultimo_cierre_hasta(barras: list[Barra], dia: date) -> Barra | None:
    """Última barra con fecha igual o anterior a `dia` (cubre festivos y fines de semana)."""
    previas = [b for b in barras if b.dia <= dia]
    return max(previas, key=lambda b: b.dia) if previas else None
