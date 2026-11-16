"""Calendario de la Bolsa de Nueva York (NYSE): qué días hay sesión.

Festivos y fines de semana salen de `exchange_calendars`. Todo va en fecha de bolsa (date), nunca
en datetime, para que el «día» no dependa de la zona horaria.
"""

from __future__ import annotations

import calendar as _cal
from bisect import bisect_left, bisect_right
from datetime import date, datetime
from functools import cache
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from exchange_calendars import ExchangeCalendar

CALENDARIO = "XNYS"
# Rango explícito: sin `end`, la librería solo llega a un año vista.
DESDE = date(2000, 1, 1)
HASTA = date(2045, 12, 31)
TZ_NUEVA_YORK = ZoneInfo("America/New_York")


@cache
def calendario() -> ExchangeCalendar:
    """El calendario de la NYSE, construido una sola vez por proceso (tarda medio segundo)."""
    import exchange_calendars as xcals

    return xcals.get_calendar(CALENDARIO, start=DESDE.isoformat(), end=HASTA.isoformat())


@cache
def sesiones() -> tuple[date, ...]:
    """Todas las sesiones del rango cargado, en orden."""
    return tuple(s.date() for s in calendario().sessions)


@cache
def _sesiones_conjunto() -> frozenset[date]:
    return frozenset(sesiones())


def fecha_de_bolsa(d: date) -> date:
    """Valida que `d` es una fecha (no un datetime) dentro del calendario cargado."""
    # Un datetime pasaría por date, y con zona horaria su «día» sería ambiguo.
    if isinstance(d, datetime) or not isinstance(d, date):
        raise TypeError(f"hace falta una fecha de bolsa (date), no {d!r}")
    if not DESDE <= d <= HASTA:
        raise ValueError(f"{d} está fuera del calendario cargado ({DESDE} a {HASTA})")
    return d


def es_dia_de_bolsa(d: date) -> bool:
    return fecha_de_bolsa(d) in _sesiones_conjunto()


def dias_de_bolsa(desde: date, hasta: date) -> list[date]:
    """Días de bolsa entre `desde` y `hasta`, los dos incluidos, en orden."""
    desde, hasta = fecha_de_bolsa(desde), fecha_de_bolsa(hasta)
    todas = sesiones()
    return list(todas[bisect_left(todas, desde):bisect_right(todas, hasta)])


def es_ultimo_dia_de_bolsa(d: date) -> bool:
    """Si `d` es la última sesión de su mes."""
    if not es_dia_de_bolsa(d):
        return False
    ultimo = _cal.monthrange(d.year, d.month)[1]
    return not dias_de_bolsa(d, d.replace(day=ultimo))[1:]


def es_primer_dia_de_bolsa(d: date) -> bool:
    """Si `d` es la primera sesión de su mes."""
    if not es_dia_de_bolsa(d):
        return False
    return not dias_de_bolsa(d.replace(day=1), d)[:-1]
