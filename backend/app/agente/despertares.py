"""Despertares del agente: la revisión de después del cierre es diaria, y en ella lee las alertas
del vigía y los despertares que se programó él mismo para ese día, con su motivo.

Los topes viven aquí, en código: el modelo elige el día y el motivo, nunca los límites."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.agente.config import AgenteSettings, ajustes
from app.agente.models import Despertar
from app.mercado.calendario import dias_de_bolsa, es_dia_de_bolsa

MAX_MOTIVO = 500
# Días naturales de sobra para contener el horizonte en días de bolsa (festivos incluidos).
_MARGEN_NATURAL = 2


def horizonte(hoy: date, cfg: AgenteSettings = ajustes) -> date:
    """El último día de bolsa que se puede programar desde hoy."""
    n = cfg.despertares_horizonte_dias
    return dias_de_bolsa(hoy + timedelta(days=1), hoy + timedelta(days=n * _MARGEN_NATURAL))[n - 1]


def _lunes(d: date) -> date:
    return d - timedelta(days=d.weekday())


def nuevos_esta_semana(s: Session, hoy: date) -> int:
    """Programados en la semana de hoy, cancelados incluidos: cancelar no devuelve cupo."""
    lunes = _lunes(hoy)
    return s.execute(select(func.count()).select_from(Despertar).where(
        Despertar.programado_el.between(lunes, lunes + timedelta(days=6)))).scalar_one()


def _pendientes(s: Session) -> list[Despertar]:
    s.flush()
    return list(s.execute(select(Despertar).where(Despertar.estado == "pendiente")
                          .order_by(Despertar.fecha_ny)).scalars())


def pendientes(s: Session) -> list[dict[str, Any]]:
    return [{"id": d.id, "date": d.fecha_ny.isoformat(), "reason": d.motivo,
             "scheduled_on": d.programado_el.isoformat()} for d in _pendientes(s)]


def topes(s: Session, hoy: date, cfg: AgenteSettings = ajustes) -> dict[str, Any]:
    """Lo que el modelo necesita saber para no chocar con los límites."""
    return {"pending_max": cfg.despertares_pendientes_max,
            "new_per_week_max": cfg.despertares_semana_max,
            "new_this_week": nuevos_esta_semana(s, hoy),
            "latest_date": horizonte(hoy, cfg).isoformat()}


def programar(s: Session, hoy: date, fecha: date, motivo: str, ejecucion_id: int | None,
              cfg: AgenteSettings = ajustes) -> Despertar:
    """Valida contra los topes y guarda; los errores van en inglés porque los lee el modelo."""
    motivo = motivo.strip()
    if not motivo:
        raise ValueError("reason must not be empty")
    if len(motivo) > MAX_MOTIVO:
        raise ValueError(f"reason must be at most {MAX_MOTIVO} characters")
    if fecha <= hoy:
        raise ValueError("date must be a future trading day")
    if not es_dia_de_bolsa(fecha):
        raise ValueError(f"{fecha.isoformat()} is not a trading day")
    ultimo = horizonte(hoy, cfg)
    if fecha > ultimo:
        raise ValueError(f"date is beyond the horizon of {cfg.despertares_horizonte_dias} "
                         f"trading days (latest {ultimo.isoformat()})")
    actuales = _pendientes(s)
    mismo_dia = next((d for d in actuales if d.fecha_ny == fecha), None)
    if mismo_dia is not None:
        raise ValueError(f"wake-up {mismo_dia.id} is already scheduled for that day; cancel it "
                         "first if you want a different reason")
    if len(actuales) >= cfg.despertares_pendientes_max:
        raise ValueError(f"already {len(actuales)} pending wake-ups, the maximum; cancel one "
                         "first")
    if nuevos_esta_semana(s, hoy) >= cfg.despertares_semana_max:
        raise ValueError(f"weekly limit of {cfg.despertares_semana_max} new wake-ups reached "
                         "(cancelled ones count)")
    d = Despertar(fecha_ny=fecha, motivo=motivo, programado_el=hoy,
                  programado_en_ejecucion=ejecucion_id)
    s.add(d)
    s.flush()
    return d


def cancelar(s: Session, despertar_id: int, motivo: str) -> Despertar:
    motivo = motivo.strip()
    if not motivo:
        raise ValueError("reason must not be empty")
    s.flush()
    d = s.get(Despertar, despertar_id)
    if d is None or d.estado != "pendiente":
        raise ValueError(f"no pending wake-up with id {despertar_id}")
    d.estado = "cancelado"
    d.cancelado_motivo = motivo[:MAX_MOTIVO]
    s.flush()
    return d


def vencer(s: Session, hoy: date, ejecucion_id: int) -> list[dict[str, Any]]:
    """Cierra los pendientes de hoy o anteriores (un día sin revisión no los pierde)."""
    s.flush()
    vencidos = list(s.execute(select(Despertar).where(
        Despertar.estado == "pendiente", Despertar.fecha_ny <= hoy)
        .order_by(Despertar.fecha_ny, Despertar.id)).scalars())
    for d in vencidos:
        d.estado = "hecho"
        d.cerrado_en_ejecucion = ejecucion_id
    s.flush()
    return [{"id": d.id, "date": d.fecha_ny.isoformat(), "reason": d.motivo,
             "scheduled_on": d.programado_el.isoformat()} for d in vencidos]


def razones(s: Session, hoy: date, ejecucion_id: int, hay_alertas: bool) -> dict[str, Any]:
    """La revisión del cierre es diaria; se le suman las alertas y los despertares propios
    vencidos, que se cierran aquí."""
    return {"daily_review": True, "alerts": hay_alertas,
            "scheduled": vencer(s, hoy, ejecucion_id)}


def razones_de(s: Session, ejecucion_id: int | None) -> dict[str, Any] | None:
    """Las razones guardadas en el evento `ciclo_pendiente` de esa ejecución, para el prompt."""
    if ejecucion_id is None:
        return None
    s.flush()
    datos = s.execute(text(
        "select datos from agente.eventos where ejecucion_id = :e and tipo = 'ciclo_pendiente' "
        "order by id desc limit 1"), {"e": ejecucion_id}).scalar()
    return datos or None
