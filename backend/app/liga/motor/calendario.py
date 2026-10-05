"""Calendario de la Bolsa de Nueva York (NYSE) para las jornadas de la liga (plan §8).

Una jornada es un mes de bolsa: la cartera se fija con el cierre de `dia_base` (último día de
bolsa del mes anterior) y juega de `dia_inicio` a `dia_fin` (primer y último día de bolsa del
mes). Los fines de semana y festivos se saltan solos con `exchange_calendars`. Todo va en fecha de
bolsa. Lo único con hora es el cierre de inscripción (el corte): las 18:00 de Nueva York del
`dia_base`, con margen sobre el escaneo oficial, que arranca a las 16:45 de ese mismo día. Se ancla
a la hora de Nueva York y no a la de Madrid porque las dos cambian de horario en fechas distintas y
el corte tiene que caer siempre después del escaneo y antes de la apertura.
"""

from __future__ import annotations

import calendar
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import date, datetime, time
from functools import cache
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from exchange_calendars import ExchangeCalendar

CALENDARIO = "XNYS"
# Rango explícito: sin `end`, la librería solo llega a un año vista y la temporada lo supera.
DESDE = date(2000, 1, 1)
HASTA = date(2045, 12, 31)
TZ_NUEVA_YORK = ZoneInfo("America/New_York")
HORA_CIERRE_INSCRIPCION = time(18, 0)


@dataclass(frozen=True)
class FechasJornada:
    dia_base: date
    dia_inicio: date
    dia_fin: date
    cierre_inscripcion: datetime


@cache
def calendario() -> ExchangeCalendar:
    """El calendario de la NYSE, construido una sola vez por proceso (tarda medio segundo)."""
    import exchange_calendars as xcals

    return xcals.get_calendar(CALENDARIO, start=DESDE.isoformat(), end=HASTA.isoformat())


@cache
def _sesiones() -> tuple[date, ...]:
    return tuple(s.date() for s in calendario().sessions)


@cache
def _sesiones_conjunto() -> frozenset[date]:
    return frozenset(_sesiones())


def es_dia_de_bolsa(d: date) -> bool:
    return _fecha(d) in _sesiones_conjunto()


def dias_de_bolsa(desde: date, hasta: date) -> list[date]:
    """Días de bolsa entre `desde` y `hasta`, los dos incluidos, en orden."""
    desde, hasta = _fecha(desde), _fecha(hasta)
    sesiones = _sesiones()
    return list(sesiones[bisect_left(sesiones, desde):bisect_right(sesiones, hasta)])


def jornada_del_mes(anio: int, mes: int) -> FechasJornada:
    if not 1 <= mes <= 12:
        raise ValueError(f"mes fuera de rango: {mes}")
    ultimo = calendar.monthrange(anio, mes)[1]
    dias = dias_de_bolsa(date(anio, mes, 1), date(anio, mes, ultimo))
    if not dias:
        raise ValueError(f"no hay días de bolsa en {mes}/{anio}")
    sesiones = _sesiones()
    i = bisect_left(sesiones, dias[0])
    if i == 0:
        raise ValueError(f"no hay día base para {mes}/{anio}: el calendario empieza en {DESDE}")
    dia_base = sesiones[i - 1]
    return FechasJornada(
        dia_base=dia_base,
        dia_inicio=dias[0],
        dia_fin=dias[-1],
        cierre_inscripcion=datetime.combine(
            dia_base, HORA_CIERRE_INSCRIPCION, tzinfo=TZ_NUEVA_YORK),
    )


def es_ultimo_dia_de_bolsa(d: date) -> bool:
    """Si `d` es la última sesión de su mes: el día en que corre el escaneo con decisión, tras el
    cierre, para que la jornada del mes siguiente tenga notas oficiales antes del corte."""
    if not es_dia_de_bolsa(d):
        return False
    ultimo = calendar.monthrange(d.year, d.month)[1]
    return not dias_de_bolsa(d, d.replace(day=ultimo))[1:]


def es_primer_dia_de_bolsa(d: date) -> bool:
    """Si `d` es la primera sesión de su mes (el día en que empieza la jornada y corre el escaneo de
    decisión de Alpha)."""
    if not es_dia_de_bolsa(d):
        return False
    return not dias_de_bolsa(d.replace(day=1), d)[:-1]


def _fecha(d: date) -> date:
    # Un datetime pasaría por date, y con zona horaria su «día» sería ambiguo.
    if isinstance(d, datetime) or not isinstance(d, date):
        raise TypeError(f"hace falta una fecha de bolsa (date), no {d!r}")
    if not DESDE <= d <= HASTA:
        raise ValueError(f"{d} está fuera del calendario cargado ({DESDE} a {HASTA})")
    return d
