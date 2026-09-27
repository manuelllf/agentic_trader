"""Temporadas y jornadas (D13): la temporada 1 es 2027 entero, 12 jornadas que cuentan; antes, una
pretemporada que se juega y no cuenta, con los meses que aún no han empezado hasta diciembre de
2026. Las fechas de cada jornada salen del calendario de la NYSE (`motor.calendario`).

Idempotente: una temporada que ya existe (por nombre) no se toca, y sus jornadas son únicas por
(temporada, número) y se crean con ella en la misma transacción.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.liga.models import Jornada, Temporada
from app.liga.motor import calendario
from app.liga.procesos import casa
from app.liga.procesos.comun import (
    Fabrica,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    hoy_bolsa,
    para_json,
    sesion,
)

PRETEMPORADA = "Pretemporada"
TEMPORADA_1 = "Temporada 1"
ANIO_TEMPORADA_1 = 2027


@dataclass(frozen=True)
class JornadaPlan:
    numero: int
    anio: int
    mes: int
    fechas: calendario.FechasJornada


@dataclass(frozen=True)
class TemporadaPlan:
    nombre: str
    cuenta: bool
    jornadas: tuple[JornadaPlan, ...]


def _jornadas(meses: list[tuple[int, int]]) -> tuple[JornadaPlan, ...]:
    return tuple(JornadaPlan(i, a, m, calendario.jornada_del_mes(a, m))
                 for i, (a, m) in enumerate(meses, 1))


def planificar(hoy: date) -> list[TemporadaPlan]:
    """Lo que debería existir visto desde `hoy` (fecha de bolsa). Sin meses libres antes de 2027,
    no hay pretemporada."""
    meses_pre: list[tuple[int, int]] = []
    a, m = (hoy.year + 1, 1) if hoy.month == 12 else (hoy.year, hoy.month + 1)
    while a < ANIO_TEMPORADA_1:
        meses_pre.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    planes = []
    if meses_pre:
        planes.append(TemporadaPlan(PRETEMPORADA, False, _jornadas(meses_pre)))
    planes.append(TemporadaPlan(TEMPORADA_1, True,
                                _jornadas([(ANIO_TEMPORADA_1, mes) for mes in range(1, 13)])))
    return planes


def _existentes(db: Session) -> dict[str, Temporada]:
    return {t.nombre: t for t in db.scalars(select(Temporada).order_by(Temporada.id))}


def _resumen(plan: TemporadaPlan) -> dict:
    return {"nombre": plan.nombre, "cuenta": plan.cuenta, "jornadas": [
        {"numero": j.numero, "mes": f"{j.anio}-{j.mes:02d}", "dia_base": j.fechas.dia_base,
         "dia_inicio": j.fechas.dia_inicio, "dia_fin": j.fechas.dia_fin,
         "cierre_inscripcion": j.fechas.cierre_inscripcion} for j in plan.jornadas]}


def estado(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        return para_json({"temporadas": [
            {"id": t.id, "nombre": t.nombre, "cuenta": t.cuenta, "n_jornadas": t.n_jornadas,
             "estado": t.estado,
             "jornadas_creadas": len(db.scalars(select(Jornada.id).where(
                 Jornada.temporada_id == t.id)).all())}
            for t in _existentes(db).values()]})


def vista_previa(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None) -> dict:
    with sesion(fabrica) as db:
        existentes = _existentes(db)
        planes = planificar(hoy_bolsa(ahora))
        return para_json({
            "crearia": [_resumen(p) for p in planes if p.nombre not in existentes],
            "ya_existen": [p.nombre for p in planes if p.nombre in existentes],
            "casa_por_crear": casa.casas_que_faltan(db),
        })


def ejecutar(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None,
             actor: str | None = None) -> dict:
    try:
        with candado("temporadas", fabrica), sesion(fabrica) as db:
            existentes = _existentes(db)
            creadas = []
            for plan in planificar(hoy_bolsa(ahora)):
                if plan.nombre in existentes:
                    continue
                t = Temporada(nombre=plan.nombre, n_jornadas=len(plan.jornadas), cuenta=plan.cuenta)
                db.add(t)
                db.flush()
                for j in plan.jornadas:
                    db.add(Jornada(temporada_id=t.id, numero=j.numero,
                                   dia_base=j.fechas.dia_base, dia_inicio=j.fechas.dia_inicio,
                                   dia_fin=j.fechas.dia_fin,
                                   cierre_inscripcion=j.fechas.cierre_inscripcion))
                creadas.append(plan.nombre)
            casas = casa.asegurar(db)
            resultado = {"creadas": creadas, "casa": casas}
            if creadas or casas["creadas"]:
                auditar(db, "proceso.temporadas", None, resultado, actor)
            db.commit()
            return para_json(resultado)
    except Exception as e:
        auditar_fallo(fabrica, "temporadas", None, e, actor)
        raise
