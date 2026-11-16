"""Jornadas de la liga sobre el calendario de la Bolsa de Nueva York (plan §8).

Una jornada es una semana de bolsa: la cartera se fija con el cierre de `dia_base` (el corte:
último día de bolsa de la semana anterior) y juega de `dia_inicio` a `dia_fin` (primer y último
día de bolsa de la semana). Qué días hay sesión lo dice `app.mercado.calendario`.
Todo va en fecha de bolsa. Lo único con hora es el cierre de inscripción: las 18:00 de Nueva York
del `dia_base`, con margen sobre el escaneo mensual de las 16:45. Se ancla a Nueva York y no a
Madrid porque cambian de horario en fechas distintas y el cierre de inscripción tiene que caer
siempre después del escaneo y antes de la apertura.
"""

from __future__ import annotations

import calendar
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.mercado.calendario import (
    DESDE,
    HASTA,
    TZ_NUEVA_YORK,
    calendario,
    dias_de_bolsa,
    es_dia_de_bolsa,
    es_primer_dia_de_bolsa,
    es_ultimo_dia_de_bolsa,
    fecha_de_bolsa,
    sesiones,
)

# Lo de mercado se usa desde aquí en toda la liga: se expone junto a lo propio de las jornadas.
__all__ = [
    "DESDE", "HASTA", "HORA_APERTURA", "HORA_CIERRE_CAMBIOS", "HORA_CIERRE_INSCRIPCION",
    "HORA_CIERRE_JORNADA", "TZ_NUEVA_YORK", "FechasJornada", "calendario", "cierre_de_cambios",
    "cortes_entre", "dias_de_bolsa", "es_corte", "es_dia_de_bolsa", "es_primer_dia_de_bolsa",
    "es_ultimo_dia_de_bolsa", "escaneo_de_la_semana", "jornada_del_mes", "jornada_semanal",
    "jornadas_semanales",
]

HORA_CIERRE_INSCRIPCION = time(18, 0)
# Desde cuándo se cierra sola la jornada que acaba hoy: pasado el margen de la fuente de precios.
HORA_CIERRE_JORNADA = time(17, 30)
# Hasta cuándo se pueden cambiar empresas en una cartera ya formada: media hora antes de abrir.
HORA_CIERRE_CAMBIOS = time(9, 0)
# Abre la bolsa de Nueva York.
HORA_APERTURA = time(9, 30)


def cierre_de_cambios(dia_inicio: date) -> datetime:
    """El momento en que ya no se puede cambiar la cartera formada de la jornada que empieza."""
    return datetime.combine(dia_inicio, HORA_CIERRE_CAMBIOS, tzinfo=TZ_NUEVA_YORK)


@dataclass(frozen=True)
class FechasJornada:
    dia_base: date
    dia_inicio: date
    dia_fin: date
    cierre_inscripcion: datetime


def jornada_del_mes(anio: int, mes: int) -> FechasJornada:
    if not 1 <= mes <= 12:
        raise ValueError(f"mes fuera de rango: {mes}")
    ultimo = calendar.monthrange(anio, mes)[1]
    dias = dias_de_bolsa(date(anio, mes, 1), date(anio, mes, ultimo))
    if not dias:
        raise ValueError(f"no hay días de bolsa en {mes}/{anio}")
    todas = sesiones()
    i = bisect_left(todas, dias[0])
    if i == 0:
        raise ValueError(f"no hay día base para {mes}/{anio}: el calendario empieza en {DESDE}")
    dia_base = todas[i - 1]
    return FechasJornada(
        dia_base=dia_base,
        dia_inicio=dias[0],
        dia_fin=dias[-1],
        cierre_inscripcion=datetime.combine(
            dia_base, HORA_CIERRE_INSCRIPCION, tzinfo=TZ_NUEVA_YORK),
    )


def cortes_entre(desde: date, hasta: date) -> list[date]:
    """Devuelve los cortes semanales del intervalo, incluidos sus extremos."""
    desde, hasta = fecha_de_bolsa(desde), fecha_de_bolsa(hasta)
    if desde > hasta:
        return []
    todas = sesiones()
    cortes: list[date] = []
    for dia in dias_de_bolsa(desde, hasta):
        siguiente = bisect_right(todas, dia)
        if siguiente == len(todas):
            if es_corte(dia):
                cortes.append(dia)
            continue
        proximo = todas[siguiente]
        if dia.isocalendar()[:2] != proximo.isocalendar()[:2]:
            cortes.append(dia)
    return cortes


def es_corte(d: date) -> bool:
    """Indica si la fecha es el último día de bolsa de su semana."""
    d = fecha_de_bolsa(d)
    fin_semana = d + timedelta(days=6 - d.weekday())
    return dias_de_bolsa(d, min(fin_semana, HASTA)) == [d]


def jornada_semanal(dia_base: date) -> FechasJornada:
    """Forma la jornada desde la sesión posterior al corte hasta el siguiente corte."""
    if not es_corte(dia_base):
        raise ValueError(f"{dia_base} no es un corte")
    todas = sesiones()
    siguiente = bisect_right(todas, dia_base)
    if siguiente == len(todas):
        raise ValueError(f"no hay sesión posterior a {dia_base} en el calendario")
    dia_inicio = todas[siguiente]
    fin_semana = min(dia_inicio + timedelta(days=6 - dia_inicio.weekday()), HASTA)
    dia_fin = cortes_entre(dia_inicio, fin_semana)[0]
    return FechasJornada(
        dia_base=dia_base,
        dia_inicio=dia_inicio,
        dia_fin=dia_fin,
        cierre_inscripcion=datetime.combine(
            dia_base, HORA_CIERRE_INSCRIPCION, tzinfo=TZ_NUEVA_YORK),
    )


def escaneo_de_la_semana(dia_base: date) -> date | None:
    """El último día de bolsa de un mes que cae en la semana que cierra este corte, si hay uno:
    el día del escaneo mensual de esa semana."""
    if not es_corte(dia_base):
        raise ValueError(f"{dia_base} no es un corte")
    lunes = dia_base - timedelta(days=dia_base.weekday())
    for dia in dias_de_bolsa(lunes, dia_base):
        if es_ultimo_dia_de_bolsa(dia):
            return dia
    return None


def jornadas_semanales(desde: date, hasta: date) -> list[FechasJornada]:
    """Devuelve las jornadas con corte y todas sus sesiones dentro del intervalo."""
    jornadas: list[FechasJornada] = []
    for corte in cortes_entre(desde, hasta):
        if corte == sesiones()[-1]:
            break
        jornada = jornada_semanal(corte)
        if jornada.dia_fin > hasta:
            break
        if jornada.dia_inicio >= desde:
            jornadas.append(jornada)
    return jornadas
