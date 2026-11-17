"""Horario del agente: cuándo despierta cada tarea, en hora de Nueva York.
También calcula las tareas perdidas que hay que recuperar al arrancar."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum

from app.agente.config import AgenteSettings, ajustes
from app.mercado.calendario import TZ_NUEVA_YORK, es_dia_de_bolsa

# Hasta cuántos días naturales atrás buscar una tarea perdida (cubre un fin de semana largo).
DIAS_ATRAS_MAXIMO = 10


class Tarea(StrEnum):
    VIGIA_PREVIO = "vigia_previo"
    EJECUCION = "ejecucion"
    PREPARACION = "preparacion"
    DESPERTAR = "despertar"
    CONSOLIDACION = "consolidacion"


_CAMPO_HORA: dict[Tarea, str] = {
    Tarea.VIGIA_PREVIO: "hora_vigia_previo",
    Tarea.EJECUCION: "hora_ejecucion",
    Tarea.PREPARACION: "hora_preparacion",
    Tarea.DESPERTAR: "hora_despertar",
    Tarea.CONSOLIDACION: "hora_consolidacion",
}


def hora_de(tarea: Tarea, ajustes: AgenteSettings = ajustes) -> time:
    return getattr(ajustes, _CAMPO_HORA[tarea])


def programa_del_dia(
    d: date, ajustes: AgenteSettings = ajustes
) -> list[tuple[Tarea, datetime]]:
    """Las tareas del día con su hora de Nueva York, en orden; vacío si no es día de bolsa."""
    if not es_dia_de_bolsa(d):
        return []
    programa = [
        (tarea, datetime.combine(d, hora_de(tarea, ajustes), tzinfo=TZ_NUEVA_YORK))
        for tarea in Tarea
    ]
    return sorted(programa, key=lambda par: par[1])


def clave(tarea: Tarea, d: date) -> str:
    """Clave única de la tabla de ejecuciones: una tarea por fecha de Nueva York."""
    return f"{tarea.value}:{d.isoformat()}"


def en_hora_punta_deepseek(momento: datetime) -> bool:
    """Si el momento cae en hora punta de DeepSeek, de lunes a viernes en UTC."""
    _exige_zona(momento)
    utc = momento.astimezone(UTC)
    if utc.weekday() >= 5:
        return False
    # A estas horas DeepSeek es más caro y lento.
    return 1 <= utc.hour < 4 or 6 <= utc.hour < 10


def pendientes_al_arrancar(
    ahora: datetime, hechas: set[str], ajustes: AgenteSettings = ajustes
) -> list[tuple[Tarea, date]]:
    """Las tareas perdidas que hay que hacer una vez al arrancar, en orden de hora programada."""
    _exige_zona(ahora)
    hoy = ahora.astimezone(TZ_NUEVA_YORK).date()
    pendientes: list[tuple[datetime, Tarea, date]] = []
    for tarea in Tarea:
        ocurrencia = _ultima_ocurrencia(tarea, ahora, hoy, ajustes)
        if ocurrencia is None:
            continue
        d, momento = ocurrencia
        if clave(tarea, d) in hechas:
            continue
        # Con precios de otro día ya no valen la ejecución ni la preparación: se espera.
        if tarea in (Tarea.EJECUCION, Tarea.PREPARACION) and d != hoy:
            continue
        pendientes.append((momento, tarea, d))
    pendientes.sort(key=lambda pendiente: pendiente[0])
    return [(tarea, d) for _, tarea, d in pendientes]


def _ultima_ocurrencia(
    tarea: Tarea, ahora: datetime, hoy: date, ajustes: AgenteSettings
) -> tuple[date, datetime] | None:
    # Se recorre hacia atrás día a día: el primero que encaja es el más reciente.
    for atras in range(DIAS_ATRAS_MAXIMO + 1):
        d = hoy - timedelta(days=atras)
        for programada, momento in programa_del_dia(d, ajustes):
            if programada is tarea and momento <= ahora:
                return d, momento
    return None


def _exige_zona(momento: datetime) -> None:
    if momento.utcoffset() is None:
        raise ValueError("hace falta un datetime con zona horaria")
