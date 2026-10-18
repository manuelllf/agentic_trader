"""API pública de la liga (`/liga/publico`): portada, clasificación y jornadas. Todo va como anon
en Postgres, así que lo que no es público (borradores, ocultos, carteras) no sale ni por error.
Las carteras de la casa no se publican nunca (D4): aquí solo hay resultados y puntos."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import estrategias, gestion
from app.liga.auth import Identidad, identidad_opcional
from app.liga.comparativa import (
    RentabilidadAcumulada,
    clasificacion_viva,
    movimientos_clasificacion,
    retornos_acumulados,
)
from app.liga.db import db_anon
from app.liga.procesos import diario, premio, temporadas

Orden = Literal["rentabilidad", "puntos"]


def ordenar_por_rentabilidad(filas: list, acumulados: dict[str, dict]) -> list:
    """Mayor rentabilidad acumulada primero y sin acumulado al final; los empates siguen el
    orden de entrada (puntos, diferencia, alta)."""
    return sorted(filas, key=lambda f: (
        f.eid not in acumulados,
        -acumulados[f.eid]["rentabilidad"] if f.eid in acumulados else Decimal(0)))


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
    id: str | None
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
    clave: str | None = None


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
    acumulado: RentabilidadAcumulada | None = None
    movimiento: int | None = None
    provisional: bool = False


class Clasificacion(BaseModel):
    temporada: TemporadaOut
    total: int
    filas: list[FilaClasificacion]
    # Las del `alias` pedido que quedan fuera de esta página, con su posición real: quien juega
    # se ve aunque esté más abajo de la fila 50. Todo esto ya es público.
    mias: list[FilaClasificacion] = []
    jornada_provisional: int | None = None


class FilaJornada(BaseModel):
    equipo: EquipoOut
    rentabilidad: Decimal | None   # solo con la jornada cerrada
    dif_sp: Decimal | None
    puntos: int | None


class JornadaDetalle(BaseModel):
    jornada: JornadaOut
    total: int                       # inscritas en la jornada; `filas` trae las mejores
    filas: list[FilaJornada]
    # Jornada en juego: las cifras son las del último cierre guardado (`hasta`), no las oficiales.
    provisional: bool = False
    hasta: date | None = None
    actualizado: datetime | None = None
    en_vivo: bool = False
    precios_pendientes: int = 0


# La portada y la jornada se piden sin sesión y en cada visita: acotadas para que crecer la liga
# no las haga cada vez más pesadas.
_TOPE_FILAS_JORNADA = 200
_TOPE_VIVA = 5000     # la tabla viva ordena en memoria: se leen todas las visibles, no solo 200


class Portada(BaseModel):
    temporada: TemporadaOut | None
    proxima: JornadaOut | None       # la siguiente por empezar (inscripción abierta o cerrada)
    en_juego: JornadaOut | None
    ultima_cerrada: JornadaDetalle | None
    registro_abierto: bool           # interruptor de emergencia (plan §14, `liga.registro.abierto`)
    apuntadas: int = 0               # estrategias de usuario apuntadas a la próxima jornada
    inscritas_en_juego: int = 0      # estrategias que juegan la jornada en curso, casa incluida


class TemporadaPremioOut(BaseModel):
    id: int
    nombre: str
    clave: str | None = None
    n_jornadas: int = 0


class PremioOut(BaseModel):
    """El premio anual a la vista de todos, sin nombres; `visible` falso: nada que enseñar."""

    visible: bool
    temporada: TemporadaPremioOut | None = None
    calculado: bool = False          # la temporada ya cerró y el reparto está hecho
    cuentas: int = 0                 # las que optan (con la temporada cerrada: las elegibles)
    escalon: int = 0                 # 0: sin activar; 1: reducido; 2: completo
    umbral_basico: int | None = None
    umbral_completo: int | None = None
    importes: dict[str, list[int]] = {}


_EQUIPO = """
    e.id::text as eid, e.nombre, e.forma, e.dibujo, e.color1, e.color2, e.iniciales,
    e.casa_clave, p.alias
"""
_JOIN_EQUIPO = """
    join liga.estrategias e on e.id = {col}
    left join liga.perfiles p on p.id = e.dueno_id
"""


def _equipo(f, con_id: bool) -> EquipoOut:  # noqa: ANN001
    # El UUID permite abrir y copiar estrategias: solo se muestra con sesión.
    return EquipoOut(
        id=f.eid if con_id else None, nombre=f.nombre, casa=f.casa_clave, autor=f.alias,
        escudo=EscudoOut(forma=f.forma, dibujo=f.dibujo, color1=f.color1, color2=f.color2,
                         iniciales=f.iniciales))


def _fila(posicion: int, f, con_id: bool, acumulado: dict | None = None,
          movimiento: int | None = None,
          provisional: bool = False) -> FilaClasificacion:  # noqa: ANN001
    return FilaClasificacion(
        posicion=posicion, equipo=_equipo(f, con_id), puntos=f.puntos, jornadas=f.jornadas,
        ganadas=f.ganadas, empatadas=f.empatadas, perdidas=f.perdidas, dif_sp=f.dif_sp,
        acumulado=RentabilidadAcumulada.model_validate(acumulado) if acumulado else None,
        movimiento=movimiento, provisional=provisional)


def _temporada(db: Session, temporada_id: int | None) -> TemporadaOut | None:
    """La pedida; si no, la que está en juego; si no, la próxima; si no, la última cerrada."""
    filtro = "where id = :t" if temporada_id else ""
    f = db.execute(text(f"""
        select id, nombre, cuenta, estado, n_jornadas from liga.temporadas {filtro}
        order by case estado when 'en_juego' then 0 when 'programada' then 1 else 2 end,
                 case when estado = 'cerrada' then -id else id end
        limit 1"""), {"t": temporada_id}).one_or_none()
    if f is None:
        return None
    return TemporadaOut(**f._mapping, clave=temporadas.CLAVES_TEMPORADA.get(f.nombre))


def _jornada(db: Session, where: str, params: dict, orden: str) -> JornadaOut | None:
    f = db.execute(text(f"""
        select id, temporada_id, numero, dia_inicio, dia_fin, cierre_inscripcion, estado,
               sp_rentabilidad
        from liga.jornadas where {where} order by {orden} limit 1"""), params).one_or_none()
    return JornadaOut(**f._mapping) if f else None


def _con_sp_vivo(j: JornadaOut) -> JornadaOut:
    """El S&P del mes en curso, hasta el último cierre guardado (la jornada formada aún no lo
    tiene guardado: se fija al cerrarla)."""
    if j.estado != "formada":
        return j
    v = diario.vivo(j.id)
    return j.model_copy(update={"sp_rentabilidad": v["sp"]}) if v else j


def _filas_vivas(filas: list[FilaJornada], vivo: dict, ids: list) -> list[FilaJornada]:
    """Las filas de una jornada en juego con la rentabilidad y los puntos provisionales, de
    mejor a peor. Una inscripción sin cálculo (precio que falta) queda al final, sin cifras."""
    por = vivo["por_inscripcion"]
    salida = []
    for fila, iid in zip(filas, ids, strict=True):
        f = por.get(iid)
        if f is None or f.get("rentabilidad") is None:
            salida.append(fila)
            continue
        salida.append(fila.model_copy(update={
            "rentabilidad": f["rentabilidad"], "dif_sp": f["dif"], "puntos": f["puntos"]}))
    salida.sort(key=lambda f: (f.rentabilidad is None, -(f.rentabilidad or 0)))
    return salida


def _detalle(db: Session, j: JornadaOut, con_id: bool) -> JornadaDetalle:
    en_juego = j.estado == "formada"
    filas = db.execute(text(f"""
        select i.id as iid, {_EQUIPO}, r.rentabilidad, r.puntos
        from liga.inscripciones i
        {_JOIN_EQUIPO.format(col="i.estrategia_id")}
        left join liga.resultados r on r.inscripcion_id = i.id
        where i.jornada_id = :j
        order by r.puntos desc nulls last, r.rentabilidad desc nulls last, e.creada
        limit :tope
    """), {"j": j.id, "tope": _TOPE_VIVA if en_juego else _TOPE_FILAS_JORNADA}).all()
    total = db.execute(text("select count(*) from liga.inscripciones where jornada_id = :j"),
                       {"j": j.id}).scalar_one()
    sp = j.sp_rentabilidad
    salida = [FilaJornada(equipo=_equipo(f, con_id), rentabilidad=f.rentabilidad, puntos=f.puntos,
                          dif_sp=(f.rentabilidad - sp) if f.rentabilidad is not None
                          and sp is not None else None)
              for f in filas]
    vivo = diario.vivo(j.id) if en_juego else None
    if vivo:
        salida = _filas_vivas(salida, vivo, [f.iid for f in filas])[:_TOPE_FILAS_JORNADA]
        j = j.model_copy(update={"sp_rentabilidad": vivo["sp"]})
    return JornadaDetalle(jornada=j, total=total, filas=salida, provisional=bool(vivo),
                          hasta=vivo["dia"] if vivo else None,
                          actualizado=vivo.get("actualizado") if vivo else None,
                          en_vivo=vivo.get("en_vivo", False) if vivo else False,
                          precios_pendientes=vivo.get("precios_pendientes", 0) if vivo else 0)


def _clasificacion_viva_activa() -> bool:
    return gestion._ajuste_booleano("liga.clasificacion_viva", True)


def _general_viva(db: Session, t: TemporadaOut, jornada, vivo: dict,
                  desde: int, cuantos: int, alias: str | None,
                  orden: Orden, con_id: bool) -> Clasificacion:
    vivas = clasificacion_viva(db, t.id, vivo, jornada)
    oficiales = db.execute(text(f"""
        select {_EQUIPO}, e.creada, c.puntos, c.jornadas, c.ganadas,
               c.empatadas, c.perdidas, c.dif_sp
        from liga.v_clasificacion c
        {_JOIN_EQUIPO.format(col="c.estrategia_id")}
        where c.temporada_id = :t
    """), {"t": t.id}).all()
    filas = {f.eid: SimpleNamespace(**f._mapping) for f in oficiales}
    nuevas = [eid for eid in vivas if eid not in filas]
    if nuevas:
        equipos = db.execute(text(f"""
            select {_EQUIPO}, e.creada
            from liga.estrategias e
            left join liga.perfiles p on p.id = e.dueno_id
            where e.id::text = any(cast(:ids as text[]))
        """), {"ids": nuevas}).all()
        filas.update({f.eid: SimpleNamespace(**f._mapping) for f in equipos})
    acumulados = retornos_acumulados(db, list(filas))
    for eid, v in vivas.items():
        if eid not in filas:
            continue
        f = filas[eid]
        for campo in ("puntos", "jornadas", "ganadas", "empatadas", "perdidas", "dif_sp"):
            setattr(f, campo, getattr(v, campo))
        acumulados.pop(eid, None)
        if v.acumulado is not None:
            acumulados[eid] = v.acumulado
    ordenadas = sorted(filas.values(), key=lambda f: (
        -f.puntos, -f.dif_sp, f.creada, f.eid))
    if orden == "rentabilidad":
        ordenadas = ordenar_por_rentabilidad(ordenadas, acumulados)
    movimientos = movimientos_clasificacion(db, t.id) if orden == "puntos" else {}

    def fila(i: int, f) -> FilaClasificacion:
        return _fila(i + 1, f, con_id, acumulados.get(f.eid),
                     movimientos.get(f.eid), provisional=f.eid in vivas)

    return Clasificacion(
        temporada=t, total=len(ordenadas), jornada_provisional=jornada.numero,
        filas=[fila(i, f) for i, f in enumerate(ordenadas) if desde <= i < desde + cuantos],
        mias=[fila(i, f) for i, f in enumerate(ordenadas)
              if (i < desde or i >= desde + cuantos)
              and alias and f.alias == alias.strip().lower()][:10])


@router.get("/clasificacion", response_model=Clasificacion)
def clasificacion(temporada: int | None = None, desde: int = Query(0, ge=0),
                  cuantos: int = Query(50, ge=1, le=100),
                  alias: str | None = Query(None, min_length=1, max_length=20),
                  orden: Orden = Query("rentabilidad"),
                  db: Session = Depends(db_anon),
                  ident: Identidad | None = Depends(identidad_opcional)) -> Clasificacion:
    """Por defecto, rentabilidad acumulada de la temporada; con `orden=puntos`, puntos,
    luego diferencia compuesta contra el S&P y fecha de alta."""
    con_id = ident is not None
    t = _temporada(db, temporada)
    if t is None:
        raise HTTPException(404, "Esa temporada no existe.")
    if _clasificacion_viva_activa():
        en_juego = db.execute(text("""
            select id, numero, dia_base from liga.jornadas
            where temporada_id = :t and estado = 'formada'
            order by dia_base desc limit 1
        """), {"t": t.id}).one_or_none()
        if en_juego is not None:
            vivo = diario.vivo(en_juego.id)
            if vivo and vivo.get("sp") is not None:
                return _general_viva(db, t, en_juego, vivo, desde, cuantos, alias, orden, con_id)
    base = f"""
        from liga.v_clasificacion c
        {_JOIN_EQUIPO.format(col="c.estrategia_id")}
        where c.temporada_id = :t
    """
    total = db.execute(text(f"select count(*) {base}"), {"t": t.id}).scalar_one()
    columnas = f"{_EQUIPO}, c.puntos, c.jornadas, c.ganadas, c.empatadas, c.perdidas, c.dif_sp"
    orden_sql = "c.puntos desc, c.dif_sp desc, e.creada, e.id"
    consulta = f"select {columnas} {base} order by {orden_sql}"
    if orden == "rentabilidad":
        todas = db.execute(text(consulta), {"t": t.id}).all()
        acumulados = retornos_acumulados(db, [f.eid for f in todas])
        ordenadas = ordenar_por_rentabilidad(todas, acumulados)
        filas = ordenadas[desde:desde + cuantos]
        mias = []
        if alias:
            mias = [
                _fila(i + 1, f, con_id, acumulados.get(f.eid))
                for i, f in enumerate(ordenadas)
                if i >= desde + cuantos and f.alias == alias.strip().lower()
            ][:10]
        return Clasificacion(
            temporada=t, total=total,
            filas=[_fila(desde + i + 1, f, con_id, acumulados.get(f.eid))
                   for i, f in enumerate(filas)],
            mias=mias)
    filas = db.execute(text(f"""
        {consulta}
        offset :desde limit :cuantos
    """), {"t": t.id, "desde": desde, "cuantos": cuantos}).all()
    fuera = []
    if alias:
        fuera = db.execute(text(f"""
            select * from (
              select {columnas},
                     row_number() over (
                       order by {orden_sql}) as pos
              {base}
            ) r
            where r.alias = :alias and r.pos > :ultima
            order by r.pos limit 10
        """), {"t": t.id, "alias": alias.strip().lower(), "ultima": desde + cuantos}).all()
    visibles = [f.eid for f in filas] + [f.eid for f in fuera]
    acumulados = retornos_acumulados(db, visibles)
    movimientos = movimientos_clasificacion(db, t.id)
    return Clasificacion(
        temporada=t, total=total,
        filas=[_fila(desde + i + 1, f, con_id, acumulados.get(f.eid), movimientos.get(f.eid))
               for i, f in enumerate(filas)],
        mias=[_fila(f.pos, f, con_id, acumulados.get(f.eid), movimientos.get(f.eid))
              for f in fuera])


@router.get("/jornada/{jornada_id}", response_model=JornadaDetalle)
def jornada(jornada_id: int, db: Session = Depends(db_anon),
            ident: Identidad | None = Depends(identidad_opcional)) -> JornadaDetalle:
    con_id = ident is not None
    j = _jornada(db, "id = :j", {"j": jornada_id}, "id")
    if j is None:
        raise HTTPException(404, "Esa jornada no existe.")
    return _detalle(db, j, con_id)


def _en_juego(db: Session) -> JornadaOut | None:
    j = _jornada(db, "estado = 'formada'", {}, "dia_inicio desc")
    return _con_sp_vivo(j) if j else None


@router.get("/premio", response_model=PremioOut, dependencies=[Depends(db_anon)])
def premio_anual() -> PremioOut:
    return PremioOut(**premio.estado_publico())


@router.get("/portada", response_model=Portada)
def portada(db: Session = Depends(db_anon),
            ident: Identidad | None = Depends(identidad_opcional)) -> Portada:
    """Solo datos reales: si aún no hay jornadas, la portada lo dice (plan §17)."""
    con_id = ident is not None
    cerrada = _jornada(db, "estado = 'cerrada'", {}, "dia_fin desc")
    en_juego = _en_juego(db)
    inscritas = db.execute(text("select count(*) from liga.inscripciones where jornada_id = :j"),
                           {"j": en_juego.id}).scalar_one() if en_juego else 0
    return Portada(
        temporada=_temporada(db, None),
        proxima=_jornada(db, "estado = 'programada'", {}, "dia_inicio"),
        en_juego=en_juego,
        ultima_cerrada=_detalle(db, cerrada, con_id) if cerrada else None,
        registro_abierto=gestion.registro_abierto(),
        apuntadas=estrategias.contar_apuntadas(),
        inscritas_en_juego=inscritas,
    )
