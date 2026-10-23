"""Novedades propias desde la última visita o el último cierre de la hoja."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.liga import comparativa
from app.liga.motor.calendario import DESDE, dias_de_bolsa
from app.liga.motor.rentabilidad import _curvas, rentabilidad_sp
from app.liga.procesos.diario import SPY

_NY = ZoneInfo("America/New_York")
_MADRID = ZoneInfo("Europe/Madrid")


class MovidaOut(BaseModel):
    ticker: str
    nombre: str | None
    aportacion: Decimal


class SemanaOut(BaseModel):
    dia_inicio: date
    dia_fin: date
    rentabilidad: Decimal
    sp500: Decimal | None
    puntos: int
    puesto: int | None
    de: int | None
    movimiento: int | None


class RentabilidadOut(BaseModel):
    rentabilidad: Decimal
    sp500: Decimal | None


class CambioOut(BaseModel):
    accion: Literal["quitar", "recuperar", "volver"]
    ticker: str | None
    fecha: date
    cuenta_desde: date | None
    entra: str | None = None


class EstrategiaNovedadesOut(BaseModel):
    estrategia_id: uuid.UUID
    nombre: str
    semana: SemanaOut | None
    movidas: list[MovidaOut]
    desde_lunes: RentabilidadOut | None
    cambios: list[CambioOut]


class NovedadesOut(BaseModel):
    desde: datetime
    estrategias: list[EstrategiaNovedadesOut]


def _posiciones(db: Session, inscripcion_id: int) -> list:
    return db.execute(text("""
        select ticker, peso from liga.posiciones where inscripcion_id = :i
        order by ticker
    """), {"i": inscripcion_id}).all()


def _cierres(db: Session, inicio: date, fin: date) -> dict[str, list[precios.Cierre]]:
    rows = db.execute(text("""
        select ticker, dia, cierre, dividendo, split
        from liga.cierres_de_mis_posiciones(:desde, :hasta)
    """), {"desde": inicio - timedelta(days=10), "hasta": fin})
    cierres: dict[str, list[precios.Cierre]] = {}
    for ticker, dia, cierre, dividendo, split in rows:
        cierres.setdefault(ticker, []).append(
            precios.Cierre(dia, float(cierre), float(dividendo), float(split)))
    for serie in cierres.values():
        serie.sort(key=lambda c: c.dia)
    return cierres


def _aportaciones(db: Session, posiciones: list, inicio: date, fin: date,
                  *, cierres: dict[str, list[precios.Cierre]] | None = None
                  ) -> dict[str, Decimal] | None:
    total = sum((p.peso for p in posiciones), Decimal(0))
    if not total:
        return None
    sesiones = dias_de_bolsa(DESDE, inicio - timedelta(days=1))
    if not sesiones:
        return None
    base = sesiones[-1]
    if cierres is None:
        cierres = _cierres(db, inicio, fin)
    salida = {}
    for p in posiciones:
        try:
            curva = _curvas([(p.ticker, p.peso)], cierres, base)[p.ticker]
        except ValueError:
            continue
        r = curva.en(fin) / curva.en(base) - 1
        salida[p.ticker] = p.peso / total * r * 100
    return salida


def _movidas(db: Session, jornada) -> list[MovidaOut]:
    aportaciones = _aportaciones(db, _posiciones(db, jornada.inscripcion_id),
                                jornada.dia_inicio, jornada.dia_fin) or {}
    nombres = dict(db.execute(text("""
        select distinct on (ticker) ticker, name from fundamentals_snapshot
        where foto_id = :f order by ticker, id desc
    """), {"f": jornada.foto_id}).all())
    return [MovidaOut(ticker=t, nombre=nombres.get(t), aportacion=aportaciones[t])
            for t in sorted(aportaciones, key=lambda t: (-abs(aportaciones[t]), t))[:5]]


def _desde_lunes(db: Session, estrategia_id: uuid.UUID, hoy: date) -> RentabilidadOut | None:
    inscripcion = db.execute(text("""
        select i.id from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
        where i.estrategia_id = :e and j.estado = 'formada'
        order by j.dia_inicio desc, j.id desc limit 1
    """), {"e": estrategia_id}).scalar()
    if inscripcion is None:
        return None
    lunes = hoy - timedelta(days=hoy.weekday())
    sesiones = dias_de_bolsa(DESDE, lunes - timedelta(days=1))
    if not sesiones:
        return None
    base = sesiones[-1]
    cierres = _cierres(db, lunes, hoy)
    aportaciones = _aportaciones(db, _posiciones(db, inscripcion), lunes, hoy, cierres=cierres)
    if aportaciones is None:
        return None
    cierres_sp = cierres.get(SPY, [])
    sp500 = (rentabilidad_sp(cierres_sp, base, hoy)
             if any(c.dia == base for c in cierres_sp) else None)
    return RentabilidadOut(rentabilidad=sum(aportaciones.values(), Decimal(0)), sp500=sp500)


def construir(db: Session, ahora: datetime | None = None) -> NovedadesOut | None:
    desde = db.execute(text("select liga.novedades_desde()")).scalar()
    if desde is None:
        return None
    hoy = (ahora or datetime.now(UTC)).astimezone(_NY).date()
    estrategias = db.execute(text("""
        select id, nombre from liga.estrategias
        where dueno_id = (select auth.uid()) and tipo = 'usuario'
          and estado in ('apuntada', 'jugando') order by creada
    """)).all()
    salida = []
    for e in estrategias:
        jornada = db.execute(text("""
            select i.id as inscripcion_id, j.id, j.temporada_id, j.foto_id,
                   j.dia_inicio, j.dia_fin, r.rentabilidad, r.puntos, j.sp_rentabilidad as sp500
            from liga.jornadas j join liga.inscripciones i on i.jornada_id = j.id
            join liga.resultados r on r.inscripcion_id = i.id
            where i.estrategia_id = :e and j.estado = 'cerrada'
              and j.dia_fin >= (cast(:desde as timestamptz) at time zone 'America/New_York')::date
            order by j.dia_fin desc, j.id desc limit 1
        """), {"e": e.id, "desde": desde}).one_or_none()
        cambios = []
        for f in db.execute(text("""
            select c.estrategia_id::text, c.accion, c.ticker, c.jornada_id,
                   c.creada, j.dia_inicio, j.estado, j.dia_base
            from liga.mis_cambios_desde(:desde) c
            left join liga.jornadas j on j.id = c.jornada_id
            where c.estrategia_id = :e order by c.creada
        """), {"desde": desde, "e": e.id}):
            accion = f.accion.removeprefix("cambios.")
            entra = None
            if accion == "quitar" and f.estado in ("formada", "cerrada"):
                inscripcion = db.execute(text("""
                    select id from liga.inscripciones
                    where estrategia_id = :e and jornada_id = :j
                """), {"e": e.id, "j": f.jornada_id}).scalar()
                anterior = db.execute(text("""
                    select i.id from liga.inscripciones i
                    join liga.jornadas j on j.id = i.jornada_id
                    where i.estrategia_id = :e and j.estado in ('formada', 'cerrada')
                      and j.dia_base < :base
                    order by j.dia_base desc, j.id desc limit 1
                """), {"e": e.id, "base": f.dia_base}).scalar()
                if inscripcion is not None and anterior is not None:
                    actuales = {p.ticker for p in _posiciones(db, inscripcion)}
                    anteriores = {p.ticker for p in _posiciones(db, anterior)}
                    entradas = actuales - anteriores
                    if len(entradas) == 1:
                        entra = next(iter(entradas))
            cambios.append(CambioOut(
                accion=accion, ticker=f.ticker,
                fecha=f.creada.astimezone(_MADRID).date(), cuenta_desde=f.dia_inicio,
                entra=entra))
        if jornada is None and not cambios:
            continue
        semana = None
        if jornada is not None:
            filas = db.execute(text("""
                select v.puntos, v.dif_sp, e.creada, v.estrategia_id
                from liga.v_clasificacion v join liga.estrategias e on e.id = v.estrategia_id
                where v.temporada_id = :t
            """), {"t": jornada.temporada_id}).all()
            ordenadas = sorted(filas, key=lambda f: (-f.puntos, -f.dif_sp, f.creada,
                                                     str(f.estrategia_id)))
            puesto = next((n for n, f in enumerate(ordenadas, 1)
                           if str(f.estrategia_id) == str(e.id)), None)
            movimiento = (comparativa.movimientos_clasificacion(db, jornada.temporada_id)
                          .get(str(e.id))) if puesto is not None else None
            semana = SemanaOut(dia_inicio=jornada.dia_inicio, dia_fin=jornada.dia_fin,
                               rentabilidad=jornada.rentabilidad, sp500=jornada.sp500,
                               puntos=jornada.puntos, puesto=puesto,
                               de=len(filas) if puesto is not None else None, movimiento=movimiento)
        salida.append(EstrategiaNovedadesOut(
            estrategia_id=e.id, nombre=e.nombre, semana=semana,
            movidas=_movidas(db, jornada) if jornada is not None else [],
            desde_lunes=_desde_lunes(db, e.id, hoy), cambios=cambios))
    return NovedadesOut(desde=desde, estrategias=salida) if salida else None
