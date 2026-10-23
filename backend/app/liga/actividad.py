"""Actividad pública de los cortes cerrados de la liga."""

from datetime import date
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import comparativa


class ActividadItem(BaseModel):
    tipo: Literal["cambio", "puesto"]
    dia: date
    equipo: str
    autor: str | None
    entradas: list[str] = []
    salidas: list[str] = []
    saltos: int | None = None


class ActividadOut(BaseModel):
    temporada_id: int | None
    items: list[ActividadItem]


def actividad(db: Session, temporada_id: int | None, limite: int) -> ActividadOut:
    if temporada_id is None:
        return ActividadOut(temporada_id=None, items=[])
    cambios = db.execute(text("""
        select estrategia_id::text, dia, entradas, salidas
        from liga.actividad_publica(:t, :l)
    """), {"t": temporada_id, "l": 50}).all()
    movimientos = comparativa.movimientos_clasificacion(db, temporada_id)
    ultimo = db.execute(text("""
        select max(dia_fin) from liga.jornadas
        where temporada_id = :t and estado = 'cerrada'
    """), {"t": temporada_id}).scalar_one()
    ids = list({c.estrategia_id for c in cambios} | set(movimientos))
    equipos = db.execute(text("""
        select e.id::text as eid, e.nombre, e.tipo, e.visibilidad, e.oculta, p.alias
        from liga.estrategias e
        left join liga.perfiles p on p.id = e.dueno_id
        where e.id::text = any(cast(:ids as text[]))
    """), {"ids": ids}).all() if ids else []
    publicados = {e.eid: e for e in equipos
                  if e.tipo == "usuario" and e.visibilidad == "publicada" and not e.oculta}
    visibles = {e.eid: e for e in equipos if e.tipo == "casa" or e.eid in publicados}
    items = []
    for c in cambios:
        e = publicados.get(c.estrategia_id)
        if e is not None:
            items.append(ActividadItem(tipo="cambio", dia=c.dia, equipo=e.nombre,
                                       autor=e.alias, entradas=c.entradas, salidas=c.salidas))
    if ultimo is not None:
        for eid, saltos in movimientos.items():
            e = visibles.get(eid)
            if e is not None and saltos != 0:
                items.append(ActividadItem(tipo="puesto", dia=ultimo, equipo=e.nombre,
                                           autor=None if e.tipo == "casa" else e.alias,
                                           saltos=saltos))
    items.sort(key=lambda item: (-item.dia.toordinal(), item.equipo))
    return ActividadOut(temporada_id=temporada_id, items=items[:limite])
