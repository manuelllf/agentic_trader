"""API pública de la liga (`/liga/publico`): portada, clasificación y jornadas. Todo va como anon
en Postgres, así que lo que no es público (borradores, ocultos, carteras) no sale ni por error.
Las carteras de la casa no se publican nunca (D4): aquí solo hay resultados y puntos."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import gestion
from app.liga.db import db_anon


def exigir_visible() -> None:
    """Interruptor de emergencia (plan §14, `liga.visible`): apagado, lo público responde 503 con
    un mensaje tranquilo. El admin no pasa por aquí (entra por `/liga/entrar`, sin esta puerta)."""
    if not gestion.liga_visible():
        raise HTTPException(503, "La liga está en mantenimiento. Vuelve en un rato.")


router = APIRouter(prefix="/publico", dependencies=[Depends(exigir_visible)])


class EscudoOut(BaseModel):
    forma: str
    dibujo: str
    color1: str
    color2: str
    iniciales: str | None


class EquipoOut(BaseModel):
    id: str
    nombre: str
    escudo: EscudoOut
    casa: Literal["alpha", "omega", "lambda"] | None
    autor: str | None          # alias; None en la casa o si el perfil está oculto


class TemporadaOut(BaseModel):
    id: int
    nombre: str
    cuenta: bool
    estado: str
    n_jornadas: int


class JornadaOut(BaseModel):
    id: int
    temporada_id: int
    numero: int
    dia_inicio: date
    dia_fin: date
    cierre_inscripcion: datetime
    estado: str
    sp_rentabilidad: Decimal | None


class FilaClasificacion(BaseModel):
    posicion: int
    equipo: EquipoOut
    puntos: int
    jornadas: int
    ganadas: int
    empatadas: int
    perdidas: int
    dif_sp: Decimal


class Clasificacion(BaseModel):
    temporada: TemporadaOut
    total: int
    filas: list[FilaClasificacion]


class FilaJornada(BaseModel):
    equipo: EquipoOut
    rentabilidad: Decimal | None   # solo con la jornada cerrada
    dif_sp: Decimal | None
    puntos: int | None


class JornadaDetalle(BaseModel):
    jornada: JornadaOut
    total: int                       # inscritas en la jornada; `filas` trae las mejores
    filas: list[FilaJornada]


# La portada y la jornada se piden sin sesión y en cada visita: acotadas para que crecer la liga
# no las haga cada vez más pesadas.
_TOPE_FILAS_JORNADA = 200


class Portada(BaseModel):
    temporada: TemporadaOut | None
    proxima: JornadaOut | None       # la siguiente que admite inscripciones
    en_juego: JornadaOut | None
    ultima_cerrada: JornadaDetalle | None
    registro_abierto: bool           # interruptor de emergencia (plan §14, `liga.registro.abierto`)


_EQUIPO = """
    e.id::text as eid, e.nombre, e.forma, e.dibujo, e.color1, e.color2, e.iniciales,
    e.casa_clave, p.alias
"""
_JOIN_EQUIPO = """
    join liga.estrategias e on e.id = {col}
    left join liga.perfiles p on p.id = e.dueno_id
"""


def _equipo(f) -> EquipoOut:  # noqa: ANN001
    return EquipoOut(
        id=f.eid, nombre=f.nombre, casa=f.casa_clave, autor=f.alias,
        escudo=EscudoOut(forma=f.forma, dibujo=f.dibujo, color1=f.color1, color2=f.color2,
                         iniciales=f.iniciales))


def _temporada(db: Session, temporada_id: int | None) -> TemporadaOut | None:
    """La pedida; si no, la que está en juego; si no, la próxima; si no, la última cerrada."""
    filtro = "where id = :t" if temporada_id else ""
    f = db.execute(text(f"""
        select id, nombre, cuenta, estado, n_jornadas from liga.temporadas {filtro}
        order by case estado when 'en_juego' then 0 when 'programada' then 1 else 2 end,
                 case when estado = 'cerrada' then -id else id end
        limit 1"""), {"t": temporada_id}).one_or_none()
    return TemporadaOut(**f._mapping) if f else None


def _jornada(db: Session, where: str, params: dict, orden: str) -> JornadaOut | None:
    f = db.execute(text(f"""
        select id, temporada_id, numero, dia_inicio, dia_fin, cierre_inscripcion, estado,
               sp_rentabilidad
        from liga.jornadas where {where} order by {orden} limit 1"""), params).one_or_none()
    return JornadaOut(**f._mapping) if f else None


def _detalle(db: Session, j: JornadaOut) -> JornadaDetalle:
    filas = db.execute(text(f"""
        select {_EQUIPO}, r.rentabilidad, r.puntos
        from liga.inscripciones i
        {_JOIN_EQUIPO.format(col="i.estrategia_id")}
        left join liga.resultados r on r.inscripcion_id = i.id
        where i.jornada_id = :j
        order by r.puntos desc nulls last, r.rentabilidad desc nulls last, e.creada
        limit :tope
    """), {"j": j.id, "tope": _TOPE_FILAS_JORNADA}).all()
    total = db.execute(text("select count(*) from liga.inscripciones where jornada_id = :j"),
                       {"j": j.id}).scalar_one()
    sp = j.sp_rentabilidad
    return JornadaDetalle(jornada=j, total=total, filas=[
        FilaJornada(equipo=_equipo(f), rentabilidad=f.rentabilidad, puntos=f.puntos,
                    dif_sp=(f.rentabilidad - sp) if f.rentabilidad is not None and sp is not None
                    else None)
        for f in filas])


@router.get("/clasificacion", response_model=Clasificacion)
def clasificacion(temporada: int | None = None, desde: int = Query(0, ge=0),
                  cuantos: int = Query(50, ge=1, le=100),
                  db: Session = Depends(db_anon)) -> Clasificacion:
    """Puntos, luego diferencia compuesta contra el S&P, luego fecha de alta (plan §8)."""
    t = _temporada(db, temporada)
    if t is None:
        raise HTTPException(404, "Esa temporada no existe.")
    base = f"""
        from liga.v_clasificacion c
        {_JOIN_EQUIPO.format(col="c.estrategia_id")}
        where c.temporada_id = :t
    """
    total = db.execute(text(f"select count(*) {base}"), {"t": t.id}).scalar_one()
    filas = db.execute(text(f"""
        select {_EQUIPO}, c.puntos, c.jornadas, c.ganadas, c.empatadas, c.perdidas, c.dif_sp
        {base}
        order by c.puntos desc, c.dif_sp desc, e.creada, e.id
        offset :desde limit :cuantos
    """), {"t": t.id, "desde": desde, "cuantos": cuantos}).all()
    return Clasificacion(temporada=t, total=total, filas=[
        FilaClasificacion(posicion=desde + i + 1, equipo=_equipo(f), puntos=f.puntos,
                          jornadas=f.jornadas, ganadas=f.ganadas, empatadas=f.empatadas,
                          perdidas=f.perdidas, dif_sp=f.dif_sp)
        for i, f in enumerate(filas)])


@router.get("/jornada/{jornada_id}", response_model=JornadaDetalle)
def jornada(jornada_id: int, db: Session = Depends(db_anon)) -> JornadaDetalle:
    j = _jornada(db, "id = :j", {"j": jornada_id}, "id")
    if j is None:
        raise HTTPException(404, "Esa jornada no existe.")
    return _detalle(db, j)


@router.get("/portada", response_model=Portada)
def portada(db: Session = Depends(db_anon)) -> Portada:
    """Solo datos reales: si aún no hay jornadas, la portada lo dice (plan §17)."""
    hoy = {"hoy": datetime.now().astimezone()}
    cerrada = _jornada(db, "estado = 'cerrada'", {}, "dia_fin desc")
    return Portada(
        temporada=_temporada(db, None),
        proxima=_jornada(db, "estado = 'programada' and cierre_inscripcion > :hoy", hoy,
                         "dia_inicio"),
        en_juego=_jornada(db, "estado = 'formada'", {}, "dia_inicio desc"),
        ultima_cerrada=_detalle(db, cerrada) if cerrada else None,
        registro_abierto=gestion.registro_abierto(),
    )
