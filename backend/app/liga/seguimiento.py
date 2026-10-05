"""Batch summaries and review cursors for a user's own strategies."""

from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.comparativa import RentabilidadAcumulada, acumular_periodos
from app.liga.db import db_usuario

router = APIRouter(tags=["liga-seguimiento"])


class ResultadoReciente(BaseModel):
    inscripcion_id: int
    jornada_id: int
    dia_fin: date
    rentabilidad: Decimal
    sp500: Decimal
    diferencia_sp: Decimal


class CambioCartera(BaseModel):
    jornada_anterior_id: int
    jornada_actual_id: int
    tickers_anteriores: list[str]
    tickers_actuales: list[str]
    entradas: list[str]
    salidas: list[str]
    nueva_desde_revision: bool


class SeguimientoOut(BaseModel):
    estrategia_id: str
    nombre: str
    estado: str
    primera_revision: bool
    resultado_nuevo: bool
    ultima_inscripcion_id: int | None
    ultimo_resultado_inscripcion_id: int | None
    ultima_revision_inscripcion_id: int | None
    ultima_revision_resultado_inscripcion_id: int | None
    acumulado: RentabilidadAcumulada | None = None
    resultado: ResultadoReciente | None
    cambio_cartera: CambioCartera | None
    cambio_desde_revision: CambioCartera | None = None
    # Por qué la última cartera se formó sin la pregunta propia, si fue así.
    sin_pregunta: Literal["sin_ia", "tope", "incompleta", "tiempo"] | None = None


class RevisionItem(BaseModel):
    estrategia_id: uuid.UUID
    inscripcion_id: int | None = Field(default=None, ge=1)
    resultado_inscripcion_id: int | None = Field(default=None, ge=1)


class RevisionesIn(BaseModel):
    items: list[RevisionItem] = Field(min_length=1, max_length=50)


class RevisionesOut(BaseModel):
    actualizadas: int


_RESUMENES = text("""
    with propias as (
      select e.id, e.nombre, e.estado, e.creada
      from liga.estrategias e
      where e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
    ),
    formadas as (
      select i.id, i.estrategia_id, i.jornada_id, j.dia_base,
             row_number() over (
               partition by i.estrategia_id order by j.dia_base desc, j.id desc, i.id desc
             ) as orden
      from liga.inscripciones i
      join liga.jornadas j on j.id = i.jornada_id
      join propias e on e.id = i.estrategia_id
      where i.estado in ('formada', 'cerrada')
    ),
    dos_carteras as (
      select f.estrategia_id, f.id, f.jornada_id, f.orden, p.ticker
      from formadas f
      left join liga.posiciones p on p.inscripcion_id = f.id
      where f.orden <= 2
    ),
    carteras as (
      select estrategia_id,
             max(id) filter (where orden = 1) as ultima_inscripcion_id,
             max(jornada_id) filter (where orden = 1) as jornada_actual_id,
             max(jornada_id) filter (where orden = 2) as jornada_anterior_id,
             array_agg(ticker order by ticker)
               filter (where orden = 1 and ticker is not null) as tickers_actuales,
             array_agg(ticker order by ticker)
               filter (where orden = 2 and ticker is not null) as tickers_anteriores
      from dos_carteras group by estrategia_id
    ),
    resultados_ordenados as (
      select i.estrategia_id, i.id as inscripcion_id, i.jornada_id,
             j.dia_fin, r.rentabilidad, j.sp_rentabilidad,
             row_number() over (
               partition by i.estrategia_id order by j.dia_fin desc, j.id desc, i.id desc
             ) as orden
      from liga.resultados r
      join liga.inscripciones i on i.id = r.inscripcion_id
      join liga.jornadas j on j.id = i.jornada_id
      join propias e on e.id = i.estrategia_id
      where j.estado = 'cerrada'
    ),
    historial as (
      select i.estrategia_id,
             jsonb_agg(jsonb_build_object(
               'dia_base', j.dia_base, 'dia_fin', j.dia_fin,
               'rentabilidad', r.rentabilidad, 'sp500', j.sp_rentabilidad
             ) order by j.dia_base, j.id, i.id) as periodos
      from liga.resultados r
      join liga.inscripciones i on i.id = r.inscripcion_id
      join liga.jornadas j on j.id = i.jornada_id
      join propias e on e.id = i.estrategia_id
      where j.estado = 'cerrada' and r.rentabilidad is not null
        and j.sp_rentabilidad is not null
      group by i.estrategia_id
    )
    select e.id as estrategia_id, e.nombre, e.estado,
           c.ultima_inscripcion_id, c.jornada_actual_id, c.jornada_anterior_id,
           c.tickers_actuales, c.tickers_anteriores,
           r.inscripcion_id as resultado_inscripcion_id, r.jornada_id as resultado_jornada_id,
           r.dia_fin, r.rentabilidad, r.sp_rentabilidad,
           h.periodos as historial_periodos,
           m.usuario_id as marca_usuario_id,
           m.inscripcion_id as revisada_inscripcion_id,
           m.resultado_inscripcion_id as revisado_resultado_inscripcion_id,
           revisada.jornada_id as revisada_jornada_id,
           (select array_agg(p.ticker order by p.ticker) from liga.posiciones p
            where p.inscripcion_id = revisada.id) as tickers_revisados,
           (select d.motivo from liga.formaciones_degradadas d
            where d.inscripcion_id = c.ultima_inscripcion_id) as sin_pregunta
    from propias e
    left join carteras c on c.estrategia_id = e.id
    left join resultados_ordenados r on r.estrategia_id = e.id and r.orden = 1
    left join historial h on h.estrategia_id = e.id
    left join liga.estrategias_revisadas m
      on m.estrategia_id = e.id and m.usuario_id = (select auth.uid())
    left join liga.inscripciones revisada
      on revisada.id = m.inscripcion_id and revisada.estrategia_id = e.id
    order by e.creada desc, e.id
""")


@router.get("/seguimiento", response_model=list[SeguimientoOut])
def mis_seguimientos(db: Session = Depends(db_usuario)) -> list[SeguimientoOut]:
    """Read all owned strategy summaries in one query; no public or house strategy is returned."""
    rows = db.execute(_RESUMENES).mappings().all()
    out: list[SeguimientoOut] = []
    for row in rows:
        r = None
        if row["resultado_inscripcion_id"] is not None:
            r = ResultadoReciente(
                inscripcion_id=row["resultado_inscripcion_id"],
                jornada_id=row["resultado_jornada_id"],
                dia_fin=row["dia_fin"],
                rentabilidad=row["rentabilidad"],
                sp500=row["sp_rentabilidad"],
                diferencia_sp=row["rentabilidad"] - row["sp_rentabilidad"],
            )

        primera = row["marca_usuario_id"] is None
        cambio = None
        if (row["jornada_anterior_id"] is not None
                and row["jornada_actual_id"] is not None):
            actual = sorted(row["tickers_actuales"] or [])
            anterior = sorted(row["tickers_anteriores"] or [])
            ultima_id = row["ultima_inscripcion_id"]
            revisada_id = row["revisada_inscripcion_id"]
            cambio = CambioCartera(
                jornada_anterior_id=row["jornada_anterior_id"],
                jornada_actual_id=row["jornada_actual_id"],
                tickers_anteriores=anterior,
                tickers_actuales=actual,
                entradas=sorted(set(actual) - set(anterior)),
                salidas=sorted(set(anterior) - set(actual)),
                nueva_desde_revision=bool(
                    ultima_id and (revisada_id is None or ultima_id > revisada_id)
                ),
            )

        desde_revision = None
        if row["revisada_jornada_id"] is not None and row["jornada_actual_id"] is not None:
            actual = sorted(row["tickers_actuales"] or [])
            revisados = sorted(row["tickers_revisados"] or [])
            desde_revision = CambioCartera(
                jornada_anterior_id=row["revisada_jornada_id"],
                jornada_actual_id=row["jornada_actual_id"],
                tickers_anteriores=revisados, tickers_actuales=actual,
                entradas=sorted(set(actual) - set(revisados)),
                salidas=sorted(set(revisados) - set(actual)),
                nueva_desde_revision=row["ultima_inscripcion_id"] != row["revisada_inscripcion_id"],
            )

        ultimo_resultado = row["resultado_inscripcion_id"]
        revisado_resultado = row["revisado_resultado_inscripcion_id"]
        resultado_nuevo = bool(
            not primera and ultimo_resultado
            and (revisado_resultado is None or ultimo_resultado > revisado_resultado)
        )
        out.append(SeguimientoOut(
            estrategia_id=str(row["estrategia_id"]), nombre=row["nombre"], estado=row["estado"],
            primera_revision=primera, resultado_nuevo=resultado_nuevo,
            ultima_inscripcion_id=row["ultima_inscripcion_id"],
            ultimo_resultado_inscripcion_id=ultimo_resultado,
            ultima_revision_inscripcion_id=row["revisada_inscripcion_id"],
            ultima_revision_resultado_inscripcion_id=revisado_resultado,
            acumulado=(RentabilidadAcumulada.model_validate(resumen)
                       if (resumen := acumular_periodos(row["historial_periodos"] or []))
                       else None),
            resultado=r, cambio_cartera=cambio, cambio_desde_revision=desde_revision,
            sin_pregunta=row["sin_pregunta"],
        ))
    return out


@router.post("/seguimiento/revisado", response_model=RevisionesOut)
def marcar_revisadas(body: RevisionesIn, db: Session = Depends(db_usuario)) -> RevisionesOut:
    """Acknowledge only cursors returned to this user; upserts are batch and monotonic."""
    items = body.items
    ids = [item.estrategia_id for item in items]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "No repitas una estrategia en la misma revisión.")

    payload = json.dumps([item.model_dump(mode="json") for item in items])
    # Validate all cursors together so one forged id never partially acknowledges the batch.
    validos = db.execute(text("""
        with recibidos as (
          select * from jsonb_to_recordset(cast(:datos as jsonb)) as x(
            estrategia_id uuid, inscripcion_id bigint, resultado_inscripcion_id bigint
          )
        )
        select count(*)
        from recibidos r
        join liga.estrategias e on e.id = r.estrategia_id
        where e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
          and (r.inscripcion_id is null or exists (
            select 1 from liga.inscripciones i
            where i.id = r.inscripcion_id and i.estrategia_id = e.id
          ))
          and (r.resultado_inscripcion_id is null or exists (
            select 1 from liga.resultados res
            join liga.inscripciones i on i.id = res.inscripcion_id
            where res.inscripcion_id = r.resultado_inscripcion_id and i.estrategia_id = e.id
          ))
    """), {"datos": payload}).scalar_one()
    if validos != len(items):
        raise HTTPException(404, "No encontramos una revisión tuya.")

    db.execute(text("""
        with recibidos as (
          select * from jsonb_to_recordset(cast(:datos as jsonb)) as x(
            estrategia_id uuid, inscripcion_id bigint, resultado_inscripcion_id bigint
          )
        )
        insert into liga.estrategias_revisadas
          (usuario_id, estrategia_id, inscripcion_id, resultado_inscripcion_id)
        select (select auth.uid()), estrategia_id, inscripcion_id, resultado_inscripcion_id
        from recibidos
        on conflict (usuario_id, estrategia_id) do update set
          inscripcion_id = case
            when excluded.inscripcion_id is null then estrategias_revisadas.inscripcion_id
            when estrategias_revisadas.inscripcion_id is null
              or excluded.inscripcion_id >= estrategias_revisadas.inscripcion_id
              then excluded.inscripcion_id else estrategias_revisadas.inscripcion_id end,
          resultado_inscripcion_id = case
            when excluded.resultado_inscripcion_id is null
              then estrategias_revisadas.resultado_inscripcion_id
            when estrategias_revisadas.resultado_inscripcion_id is null
              or excluded.resultado_inscripcion_id >= estrategias_revisadas.resultado_inscripcion_id
              then excluded.resultado_inscripcion_id
            else estrategias_revisadas.resultado_inscripcion_id end
    """), {"datos": payload})
    return RevisionesOut(actualizadas=len(items))
