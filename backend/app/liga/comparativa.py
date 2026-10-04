"""Comparable financial return windows and ranking movement from official league periods."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, localcontext

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session


class RentabilidadAcumulada(BaseModel):
    rentabilidad: Decimal
    sp500: Decimal
    diferencia_pp: Decimal
    desde: date
    hasta: date
    periodos: int
    incompleta: bool


@dataclass(frozen=True)
class PeriodoOficial:
    estrategia_id: str
    temporada_id: int
    jornada_id: int
    numero: int
    dia_base: date
    dia_fin: date
    rentabilidad: Decimal
    sp500: Decimal
    puntos: int
    creada: datetime


def _factor_clasificacion(retorno: Decimal) -> Decimal:
    """Match the positive floor used by `liga.v_clasificacion` for ordering only."""
    return max(Decimal("0.000000001"), Decimal(1) + retorno / 100)


def _diferencia_clasificacion(factor: Decimal, factor_sp: Decimal) -> Decimal:
    return ((factor - factor_sp) * 100).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP)


def retornos_acumulados(db: Session, estrategia_ids: list[str]) -> dict[str, dict]:
    """Compone retornos emparejados con el S&P del último tramo contiguo; los huecos reinician el tramo."""
    ids = list(dict.fromkeys(estrategia_ids))
    if not ids:
        return {}
    rows = db.execute(text("""
        select e.id::text as estrategia_id, j.temporada_id, j.id as jornada_id, j.numero,
               j.dia_base, j.dia_fin, r.rentabilidad, j.sp_rentabilidad as sp500,
               r.puntos, e.creada
        from liga.resultados r
        join liga.inscripciones i on i.id = r.inscripcion_id
        join liga.jornadas j on j.id = i.jornada_id
        join liga.estrategias e on e.id = i.estrategia_id
        where e.id::text = any(cast(:ids as text[]))
          and j.estado = 'cerrada' and r.rentabilidad is not null
          and j.sp_rentabilidad is not null
        order by e.id, j.dia_base, j.id, i.id
    """), {"ids": ids}).mappings().all()
    grouped: dict[str, list[PeriodoOficial]] = defaultdict(list)
    for row in rows:
        grouped[row["estrategia_id"]].append(PeriodoOficial(
            estrategia_id=row["estrategia_id"], temporada_id=row["temporada_id"],
            jornada_id=row["jornada_id"], numero=row["numero"], dia_base=row["dia_base"],
            dia_fin=row["dia_fin"], rentabilidad=Decimal(row["rentabilidad"]),
            sp500=Decimal(row["sp500"]), puntos=row["puntos"], creada=row["creada"],
        ))

    salida: dict[str, dict] = {}
    for estrategia_id in ids:
        resumen = acumular_periodos([
            {"dia_base": p.dia_base, "dia_fin": p.dia_fin,
             "rentabilidad": p.rentabilidad, "sp500": p.sp500}
            for p in grouped.get(estrategia_id, [])
        ])
        if resumen:
            salida[estrategia_id] = resumen
    return salida


def acumular_periodos(periodos: list[dict]) -> dict | None:
    """Pure form shared by the public batch query and the owner's tracking projection."""
    if not periodos:
        return None
    normalizados = [{
        "dia_base": (date.fromisoformat(p["dia_base"]) if isinstance(p["dia_base"], str)
                     else p["dia_base"]),
        "dia_fin": (date.fromisoformat(p["dia_fin"]) if isinstance(p["dia_fin"], str)
                    else p["dia_fin"]),
        "rentabilidad": Decimal(str(p["rentabilidad"])),
        "sp500": Decimal(str(p["sp500"])),
    } for p in periodos]
    ventana = [normalizados[-1]]
    for periodo in reversed(normalizados[:-1]):
        if periodo["dia_fin"] != ventana[0]["dia_base"]:
            break
        ventana.insert(0, periodo)
    # A return below -100% is impossible for a long-only portfolio and cannot be
    # repaired by clamping its growth factor. Refuse to publish a misleading total.
    if any(not periodo[campo].is_finite() or periodo[campo] < -100
           for periodo in ventana for campo in ("rentabilidad", "sp500")):
        return None
    with localcontext() as ctx:
        ctx.prec = 32
        factor = Decimal(1)
        factor_sp = Decimal(1)
        for periodo in ventana:
            factor *= Decimal(1) + periodo["rentabilidad"] / 100
            factor_sp *= Decimal(1) + periodo["sp500"] / 100
        retorno = ((factor - 1) * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        sp500 = ((factor_sp - 1) * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return {
        "rentabilidad": retorno, "sp500": sp500,
        "diferencia_pp": (retorno - sp500).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP),
        "desde": ventana[0]["dia_base"], "hasta": ventana[-1]["dia_fin"],
        "periodos": len(ventana), "incompleta": len(ventana) < len(normalizados),
    }


def movimientos_clasificacion(db: Session, temporada_id: int) -> dict[str, int]:
    """Compara los dos últimos cortes oficiales con los mismos desempates que la clasificación."""
    rows = db.execute(text("""
        select e.id::text as estrategia_id, e.creada, j.id as jornada_id, j.dia_fin,
               r.puntos, r.rentabilidad, j.sp_rentabilidad
        from liga.resultados r
        join liga.inscripciones i on i.id = r.inscripcion_id
        join liga.jornadas j on j.id = i.jornada_id
        join liga.estrategias e on e.id = i.estrategia_id
        where j.temporada_id = :temporada and j.estado = 'cerrada'
        order by j.dia_fin, j.id, e.id
    """), {"temporada": temporada_id}).mappings().all()
    period_end_dates = db.execute(text("""
        select dia_fin from liga.jornadas
        where temporada_id = :temporada and estado = 'cerrada'
        order by dia_fin, id
    """), {"temporada": temporada_id}).scalars().all()
    if len(period_end_dates) < 2:
        return {}
    previous_cutoff, current_cutoff = period_end_dates[-2:]

    def positions(cutoff: date) -> dict[str, int]:
        points: dict[str, int] = defaultdict(int)
        ret_factor: dict[str, Decimal] = defaultdict(lambda: Decimal(1))
        sp_factor: dict[str, Decimal] = defaultdict(lambda: Decimal(1))
        created: dict[str, datetime] = {}
        for row in rows:
            if row["dia_fin"] > cutoff:
                break
            key = row["estrategia_id"]
            points[key] += row["puntos"]
            # Match v_clasificacion's exact tie-break math. The floor is only for
            # ranking positions; financial return values above remain unmodified.
            ret_factor[key] *= _factor_clasificacion(Decimal(row["rentabilidad"]))
            sp_factor[key] *= _factor_clasificacion(Decimal(row["sp_rentabilidad"]))
            created[key] = row["creada"]
        def diff(key: str) -> Decimal:
            return _diferencia_clasificacion(ret_factor[key], sp_factor[key])
        ordered = sorted(points, key=lambda key: (-points[key], -diff(key), created[key], key))
        return {key: index + 1 for index, key in enumerate(ordered)}

    before = positions(previous_cutoff)
    current = positions(current_cutoff)
    return {key: before[key] - place for key, place in current.items() if key in before}


def movimientos_grupo(db: Session, temporada_id: int,
                      estrategia_por_miembro: dict[str, str]) -> dict[str, int]:
    """Mantiene la misma estrategia representativa en ambos cortes para comparar posiciones del grupo."""
    if len(estrategia_por_miembro) < 2:
        return {}
    period_end_dates = db.execute(text("""
        select dia_fin from liga.jornadas
        where temporada_id = :temporada and estado = 'cerrada'
        order by dia_fin, id
    """), {"temporada": temporada_id}).scalars().all()
    if len(period_end_dates) < 2:
        return {}
    previous_cutoff, current_cutoff = period_end_dates[-2:]
    rows = db.execute(text("""
        select e.id::text as estrategia_id, miembro.alias, j.dia_fin, r.puntos,
               r.rentabilidad, j.sp_rentabilidad
        from jsonb_to_recordset(cast(:mapa as jsonb)) as miembro(estrategia_id text, alias text)
        join liga.estrategias e on e.id::text = miembro.estrategia_id
        join liga.inscripciones i on i.estrategia_id = e.id
        join liga.jornadas j on j.id = i.jornada_id
        join liga.resultados r on r.inscripcion_id = i.id
        where j.temporada_id = :temporada and j.estado = 'cerrada'
        order by j.dia_fin, j.id, miembro.alias
    """), {
        "temporada": temporada_id,
        "mapa": json.dumps([{"estrategia_id": estrategia_id, "alias": alias}
                            for alias, estrategia_id in estrategia_por_miembro.items()]),
    }).mappings().all()

    def positions(cutoff: date) -> dict[str, int]:
        points: dict[str, int] = defaultdict(int)
        ret_factor: dict[str, Decimal] = defaultdict(lambda: Decimal(1))
        sp_factor: dict[str, Decimal] = defaultdict(lambda: Decimal(1))
        for row in rows:
            if row["dia_fin"] > cutoff:
                break
            alias = row["alias"]
            points[alias] += row["puntos"]
            ret_factor[alias] *= _factor_clasificacion(Decimal(row["rentabilidad"]))
            sp_factor[alias] *= _factor_clasificacion(Decimal(row["sp_rentabilidad"]))
        def diff(alias: str) -> Decimal:
            return _diferencia_clasificacion(ret_factor[alias], sp_factor[alias])
        ordered = sorted(points, key=lambda alias: (-points[alias], -diff(alias), alias))
        return {alias: index + 1 for index, alias in enumerate(ordered)}

    before = positions(previous_cutoff)
    current = positions(current_cutoff)
    return {alias: before[alias] - place for alias, place in current.items() if alias in before}
