"""Rutas de ligas privadas (`/liga/ligas`, Pro), créditos y reportes (plan §11: F5.4 y el resto
de F5.2/F5.5 del lado del usuario). Cada ruta corre como el usuario (`db_usuario`): RLS decide
qué liga, qué movimiento y qué reporte se ve, así que un ajeno nunca ve lo que no es suyo."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga import acceso, estrategias, ligas
from app.liga.auth import Identidad, require_usuario
from app.liga.comparativa import (
    RentabilidadAcumulada,
    movimientos_grupo,
    retornos_acumulados,
)
from app.liga.db import db_usuario
from app.liga.ia import moderacion
from app.liga.procesos import diario

router = APIRouter(tags=["liga-ligas"])

_CUPO_DEFECTO = 50
# Reportar es puntual (no es un bucle de la app, a diferencia de pruebas o el buscador): un tope
# generoso solo para frenar el abuso, plan §14 (mismo estilo que `_LIMITE_PRUEBAS` de estrategias).
_LIMITE_REPORTES = acceso.LimiteFrecuencia(tope=10, ventana_s=60 * 60)


# ---- Esquemas --------------------------------------------------------------------------------


class LigaCrear(BaseModel):
    nombre: str = Field(min_length=1, max_length=40)
    cupo: int = Field(default=_CUPO_DEFECTO, ge=2, le=200)


class UnirseIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=16)


class LigaResumenOut(BaseModel):
    id: str
    nombre: str
    cupo: int
    oculta: bool
    creada: datetime
    es_dueno: bool
    codigo: str | None      # solo si es_dueno: unirse siempre pasa por `unirse_liga`
    n_miembros: int


class LigaListaOut(LigaResumenOut):
    """Resumen para la lista: resultado del mes de la estrategia que va primera."""
    mes: Decimal | None = None
    sp500_mes: Decimal | None = None
    lider: str | None = None


class MiembroLigaOut(BaseModel):
    alias: str
    es_yo: bool
    unido: datetime
    puntos: int | None
    jornadas: int | None
    dif_sp: Decimal | None
    acumulado: RentabilidadAcumulada | None = None
    movimiento: int | None = None
    estrategia: dict | None = None
    rentabilidad_mes: Decimal | None = None
    diferencia_mes: Decimal | None = None


class LigaDetalleOut(LigaResumenOut):
    miembros: list[MiembroLigaOut]
    jornada_numero: int | None = None
    datos_hasta: date | None = None
    sp500_mes: Decimal | None = None
    en_vivo: bool = False
    consultado: datetime | None = None


# ---- Ayudas ------------------------------------------------------------------------------------


def _resumen(fila, uid: str, n_miembros: int) -> LigaResumenOut:  # noqa: ANN001
    es_dueno = str(fila.dueno_id) == uid
    return LigaResumenOut(
        id=str(fila.id), nombre=fila.nombre, cupo=fila.cupo, oculta=fila.oculta,
        creada=fila.creada, es_dueno=es_dueno, codigo=fila.codigo if es_dueno else None,
        n_miembros=n_miembros)


# ---- Mis ligas y crear ---------------------------------------------------------------------------


@router.get("/ligas", response_model=list[LigaListaOut])
def mis_ligas(ident: Identidad = Depends(require_usuario),
             db: Session = Depends(db_usuario)) -> list[LigaListaOut]:
    filas = db.execute(text("""
        select l.id, l.dueno_id, l.nombre, l.codigo, l.cupo, l.oculta, l.creada,
               (select count(*) from liga.miembros_liga m where m.liga_id = l.id) as n_miembros
        from liga.ligas_privadas l order by l.creada desc
    """)).all()
    lideres, sp = _lideres_del_mes(db, [f.id for f in filas])
    return [
        LigaListaOut(**_resumen(f, ident.uid, f.n_miembros).model_dump(),
                     mes=lideres.get(str(f.id), {}).get("mes"), sp500_mes=sp,
                     lider=lideres.get(str(f.id), {}).get("lider"))
        for f in filas
    ]


@router.post("/ligas", response_model=LigaResumenOut, status_code=201)
def crear_liga(body: LigaCrear, ident: Identidad = Depends(require_usuario),
              db: Session = Depends(db_usuario)) -> LigaResumenOut:
    fila = ligas.crear_liga(db, body.nombre, body.cupo)
    moderacion.evaluar_lista(body.nombre)
    return _resumen(fila, ident.uid, 1)


# ---- Unirse por código -----------------------------------------------------------------------


@router.post("/ligas/unirse", response_model=LigaResumenOut)
def unirse(body: UnirseIn, ident: Identidad = Depends(require_usuario),
          db: Session = Depends(db_usuario)) -> LigaResumenOut:
    espera = ligas.LIMITE_UNIRSE.espera(ident.uid)
    if espera:
        raise HTTPException(429, "Demasiados códigos seguidos. Espera un poco.",
                            headers={"Retry-After": str(espera)})
    liga_id = ligas.unirse_con_codigo(db, ident.uid, body.codigo)
    fila = db.execute(text("""
        select l.id, l.dueno_id, l.nombre, l.codigo, l.cupo, l.oculta, l.creada,
               (select count(*) from liga.miembros_liga m where m.liga_id = l.id) as n_miembros
        from liga.ligas_privadas l where l.id = :i
    """), {"i": liga_id}).one()
    return _resumen(fila, ident.uid, fila.n_miembros)


# ---- Ver una liga: miembros y su clasificación ------------------------------------------------


def _temporada_actual(db: Session) -> int | None:
    """La misma prioridad que la portada pública: en juego, si no la próxima, si no la última."""
    return db.execute(text("""
        select id from liga.temporadas
        order by case estado when 'en_juego' then 0 when 'programada' then 1 else 2 end,
                 case when estado = 'cerrada' then -id else id end
        limit 1
    """)).scalar()


def _jornada_formada(db: Session, temporada: int | None):  # noqa: ANN202
    return db.execute(text("""
        select id, numero from liga.jornadas
        where temporada_id = :t and estado = 'formada' order by dia_base desc limit 1
    """), {"t": temporada}).one_or_none()


def _miembros(db: Session, liga_ids: list, temporada: int | None, jornada_id: int | None):  # noqa: ANN202
    """Miembros de las ligas dadas con la estrategia que los representa y su inscripción del mes."""
    return db.execute(text("""
        select m.liga_id::text as liga_id, p.alias, m.usuario_id::text as usuario_id, m.unido,
               s.estrategia_id, s.puntos, s.jornadas, s.dif_sp, s.nombre, s.forma, s.dibujo,
               s.color1, s.color2, s.iniciales, s.visibilidad, s.inscripcion_id
        from liga.miembros_liga m
        join liga.perfiles p on p.id = m.usuario_id
        left join lateral (
            select e.id::text as estrategia_id, c.puntos, c.jornadas, c.dif_sp,
                   e.nombre, e.forma, e.dibujo, e.color1, e.color2, e.iniciales, e.visibilidad,
                   (select i.id from liga.inscripciones i
                    where i.estrategia_id = e.id and i.jornada_id = :j
                      and i.estado = 'formada' limit 1) as inscripcion_id
            from liga.estrategias e
            left join liga.v_clasificacion c on c.estrategia_id = e.id and c.temporada_id = :t
            where e.dueno_id = m.usuario_id and e.tipo = 'usuario' and not e.oculta
              and (c.estrategia_id is not null or exists (
                select 1 from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
                where i.estrategia_id = e.id and j.temporada_id = :t
                  and i.estado in ('formada', 'cerrada')
              ))
            order by c.puntos desc nulls last, c.dif_sp desc nulls last, e.creada, e.id
            limit 1
        ) s on true
        where m.liga_id = any(:ids)
        order by m.liga_id, coalesce(s.puntos, -1) desc, coalesce(s.dif_sp, -999) desc, p.alias
    """), {"ids": liga_ids, "t": temporada, "j": jornada_id}).all()


def _lideres_del_mes(db: Session, liga_ids: list) -> tuple[dict[str, dict], Decimal | None]:
    """Por liga, la estrategia con mejor resultado del mes y el S&P 500 de esa jornada."""
    if not liga_ids:
        return {}, None
    temporada = _temporada_actual(db)
    jornada = _jornada_formada(db, temporada)
    vivo = diario.vivo(jornada.id) if jornada else None
    if not vivo:
        return {}, None
    por_inscripcion = vivo["por_inscripcion"]
    mejores: dict[str, dict] = {}
    for m in _miembros(db, liga_ids, temporada, jornada.id):
        rentabilidad = por_inscripcion.get(m.inscripcion_id, {}).get("rentabilidad")
        if rentabilidad is None:
            continue
        actual = mejores.get(m.liga_id)
        if actual is None or rentabilidad > actual["mes"]:
            mejores[m.liga_id] = {"mes": rentabilidad, "lider": m.nombre}
    return mejores, vivo["sp"]


@router.get("/ligas/{id}", response_model=LigaDetalleOut)
def ver_liga(id: uuid.UUID, ident: Identidad = Depends(require_usuario),
            db: Session = Depends(db_usuario)) -> LigaDetalleOut:
    fila = db.execute(text("""
        select id, dueno_id, nombre, codigo, cupo, oculta, creada
        from liga.ligas_privadas where id = :i
    """), {"i": id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa liga (o no estás en ella).")
    temporada = _temporada_actual(db)
    jornada = _jornada_formada(db, temporada)
    miembros = _miembros(db, [id], temporada, jornada.id if jornada else None)
    n_miembros = len(miembros)
    estrategia_por_miembro = {
        m.alias: m.estrategia_id for m in miembros if m.estrategia_id is not None
    }
    ids_estrategias = list(estrategia_por_miembro.values())
    acumulados = retornos_acumulados(db, ids_estrategias)
    movimientos = (movimientos_grupo(db, temporada, estrategia_por_miembro)
                   if temporada is not None else {})
    vivo = diario.vivo(jornada.id) if jornada else None
    por_inscripcion = vivo["por_inscripcion"] if vivo else {}
    return LigaDetalleOut(
        **_resumen(fila, ident.uid, n_miembros).model_dump(),
        jornada_numero=jornada.numero if jornada else None,
        datos_hasta=vivo["dia"] if vivo else None,
        sp500_mes=vivo["sp"] if vivo else None,
        en_vivo=vivo.get("en_vivo", False) if vivo else False,
        consultado=vivo.get("actualizado") if vivo else None,
        miembros=[
            MiembroLigaOut(alias=m.alias, es_yo=(m.usuario_id == ident.uid), unido=m.unido,
                          puntos=m.puntos, jornadas=m.jornadas, dif_sp=m.dif_sp,
                          acumulado=(RentabilidadAcumulada.model_validate(acumulados[m.estrategia_id])
                                     if m.estrategia_id in acumulados else None),
                          movimiento=movimientos.get(m.alias),
                          estrategia={"id": m.estrategia_id, "nombre": m.nombre,
                                      "visibilidad": m.visibilidad,
                                      "escudo": {"forma": m.forma, "dibujo": m.dibujo,
                                                 "color1": m.color1, "color2": m.color2,
                                                 "iniciales": m.iniciales}}
                          if m.estrategia_id else None,
                          rentabilidad_mes=por_inscripcion.get(m.inscripcion_id, {}).get(
                              "rentabilidad"),
                          diferencia_mes=por_inscripcion.get(m.inscripcion_id, {}).get("dif"))
            for m in miembros
        ])


# ---- Salir y rotar el código -------------------------------------------------------------------


@router.delete("/ligas/{id}/yo", status_code=204)
def salir(id: uuid.UUID, db: Session = Depends(db_usuario)) -> None:
    fila = db.execute(text("""
        delete from liga.miembros_liga where liga_id = :i and usuario_id = (select auth.uid())
        returning liga_id
    """), {"i": id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No estabas en esa liga.")


@router.delete("/ligas/{id}/miembros/{alias}", status_code=204)
def expulsar(id: uuid.UUID, alias: str, ident: Identidad = Depends(require_usuario),
            db: Session = Depends(db_usuario)) -> None:
    """El dueño expulsa a otro miembro. RLS sola dejaría borrar la propia fila por la política de
    «salir» (aunque sea el dueño): uno mismo se veta a mano, por aquí no. No veta al expulsado:
    para que no vuelva, el dueño rota el código."""
    objetivo = db.execute(text("""
        select m.usuario_id from liga.miembros_liga m
        join liga.perfiles p on p.id = m.usuario_id
        where m.liga_id = :i and p.alias = :alias
    """), {"i": id, "alias": alias}).scalar_one_or_none()
    if objetivo is None or str(objetivo) == ident.uid:
        raise HTTPException(404, "No existe ese miembro en tu liga.")
    fila = db.execute(text(
        "delete from liga.miembros_liga where liga_id = :i and usuario_id = :u "
        "returning usuario_id"),
        {"i": id, "u": objetivo}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe ese miembro en tu liga.")
    ligas.auditar_expulsion(id, str(fila.usuario_id), ident.uid)


@router.post("/ligas/{id}/codigo", response_model=LigaResumenOut)
def rotar_codigo(id: uuid.UUID, ident: Identidad = Depends(require_usuario),
                 db: Session = Depends(db_usuario)) -> LigaResumenOut:
    fila = ligas.regenerar_codigo(db, id)
    if fila is None:
        raise HTTPException(404, "No existe esa liga (o no eres su dueño).")
    n_miembros = db.execute(text(
        "select count(*) from liga.miembros_liga where liga_id = :i"), {"i": id}).scalar_one()
    return _resumen(fila, ident.uid, n_miembros)


# ---- Créditos: saldo y movimientos propios --------------------------------------------------


class MovimientoOut(BaseModel):
    id: int
    importe: Decimal
    motivo: str
    creado: datetime


class CreditosOut(BaseModel):
    saldo: Decimal
    total: int
    movimientos: list[MovimientoOut]


@router.get("/creditos", response_model=CreditosOut)
def creditos(desde: int = Query(0, ge=0), cuantos: int = Query(20, ge=1, le=100),
            db: Session = Depends(db_usuario)) -> CreditosOut:
    saldo = db.execute(text(
        "select saldo from liga.v_saldo where usuario_id = (select auth.uid())")).scalar()
    total = db.execute(text(
        "select count(*) from liga.creditos_movimientos where usuario_id = (select auth.uid())")
    ).scalar_one()
    filas = db.execute(text("""
        select id, importe, motivo, creado from liga.creditos_movimientos
        where usuario_id = (select auth.uid())
        order by creado desc offset :desde limit :cuantos
    """), {"desde": desde, "cuantos": cuantos}).all()
    return CreditosOut(
        saldo=saldo if saldo is not None else Decimal("0"), total=total,
        movimientos=[MovimientoOut(id=f.id, importe=f.importe, motivo=f.motivo, creado=f.creado)
                    for f in filas])


# ---- Reportes -------------------------------------------------------------------------------


class ReporteIn(BaseModel):
    tipo: Literal["alias", "estrategia", "liga", "pregunta"]
    objeto_id: str = Field(min_length=1, max_length=64)
    motivo: str = Field(min_length=1, max_length=400)


class ReporteOut(BaseModel):
    id: int
    tipo: str
    objeto_id: str
    motivo: str
    estado: str
    creado: datetime


@router.post("/reportes", response_model=ReporteOut, status_code=201)
def reportar(body: ReporteIn, ident: Identidad = Depends(require_usuario),
            db: Session = Depends(db_usuario)) -> ReporteOut:
    if not _LIMITE_REPORTES.permitido(ident.uid):
        raise HTTPException(429, "Demasiados reportes seguidos. Espera un poco.")
    try:
        with db.begin_nested():
            fila = db.execute(text("""
                insert into liga.reportes (tipo, objeto_id, motivo)
                values (:tipo, :objeto_id, :motivo)
                returning id, tipo, objeto_id, motivo, estado, creado
            """), {"tipo": body.tipo, "objeto_id": body.objeto_id, "motivo": body.motivo}).one()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return ReporteOut(**fila._mapping)
