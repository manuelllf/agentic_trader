"""Comparable financial return windows and ranking movement from official league periods."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
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


@dataclass(frozen=True)
class FilaViva:
    estrategia_id: str
    puntos: int
    jornadas: int
    ganadas: int
    empatadas: int
    perdidas: int
    dif_sp: Decimal
    acumulado: dict | None
    provisional: bool = True
    serie: list[Decimal] = field(default_factory=list)


def periodos_cerrados(db: Session, ids: list[str]) -> dict[str, list[dict]]:
    ids = list(dict.fromkeys(ids))
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
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row["estrategia_id"]].append({
            campo: row[campo] for campo in (
                "dia_base", "dia_fin", "rentabilidad", "sp500", "puntos",
                "temporada_id", "jornada_id", "numero")
        })
    return dict(grouped)


def retornos_acumulados(db: Session, estrategia_ids: list[str]) -> dict[str, dict]:
    salida: dict[str, dict] = {}
    for estrategia_id, periodos in periodos_cerrados(db, estrategia_ids).items():
        resumen = acumular_periodos(periodos)
        if resumen:
            salida[estrategia_id] = resumen
    return salida


def series_acumuladas(db: Session, estrategia_ids: list[str]) -> dict[str, list[Decimal]]:
    return {eid: serie_acumulada(periodos)
            for eid, periodos in periodos_cerrados(db, estrategia_ids).items()}


def clasificacion_viva(db: Session, temporada_id: int, vivo: dict,
                       jornada) -> dict[str, FilaViva]:
    valores = {str(iid): f for iid, f in vivo["por_inscripcion"].items()
               if f.get("rentabilidad") is not None}
    if not valores:
        return {}
    inscripciones = db.execute(text("""
        select id::text as iid, estrategia_id::text as eid
        from liga.inscripciones
        where id::text = any(cast(:ids as text[])) and jornada_id = :j
    """), {"ids": list(valores), "j": jornada.id}).mappings().all()
    cerrados = periodos_cerrados(db, [i["eid"] for i in inscripciones])
    salida = {}
    for i in inscripciones:
        eid = i["eid"]
        f = valores[i["iid"]]
        periodos = [p for p in cerrados.get(eid, []) if p["temporada_id"] == temporada_id]
        provisional = {
            "dia_base": jornada.dia_base, "dia_fin": vivo["dia"],
            "rentabilidad": Decimal(str(f["rentabilidad"])),
            "sp500": Decimal(str(vivo["sp"])),
        }
        todos = periodos + [provisional]
        factor, factor_sp = Decimal(1), Decimal(1)
        with localcontext() as ctx:
            ctx.prec = 32
            for p in todos:
                factor *= _factor_clasificacion(Decimal(str(p["rentabilidad"])))
                factor_sp *= _factor_clasificacion(Decimal(str(p["sp500"])))
            diferencia = _diferencia_clasificacion(factor, factor_sp)
        puntos = [p["puntos"] for p in periodos] + [f["puntos"]]
        salida[eid] = FilaViva(
            estrategia_id=eid, puntos=sum(puntos), jornadas=len(puntos),
            ganadas=puntos.count(3), empatadas=puntos.count(1), perdidas=puntos.count(0),
            dif_sp=diferencia, acumulado=acumular_periodos(
                cerrados.get(eid, []) + [provisional]),
            serie=serie_acumulada(cerrados.get(eid, []) + [provisional]))
    return salida


def _normalizados(periodos: list[dict]) -> list[dict]:
    return [{
        "dia_base": (date.fromisoformat(p["dia_base"]) if isinstance(p["dia_base"], str)
                     else p["dia_base"]),
        "dia_fin": (date.fromisoformat(p["dia_fin"]) if isinstance(p["dia_fin"], str)
                    else p["dia_fin"]),
        "rentabilidad": Decimal(str(p["rentabilidad"])),
        "sp500": Decimal(str(p["sp500"])),
    } for p in periodos]


def _ventana(periodos: list[dict]) -> list[dict] | None:
    """Los periodos seguidos que cuentan para el acumulado, del último hacia atrás. `None` si algún
    retorno no tiene sentido: ni el acumulado ni su serie se publican."""
    normalizados = _normalizados(periodos)
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
    return ventana


def acumular_periodos(periodos: list[dict]) -> dict | None:
    """Pure form shared by the public batch query and the owner's tracking projection."""
    if not periodos:
        return None
    ventana = _ventana(periodos)
    if ventana is None:
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
        "periodos": len(ventana), "incompleta": len(ventana) < len(periodos),
    }


def serie_acumulada(periodos: list[dict]) -> list[Decimal]:
    """Rentabilidad acumulada (%) al cierre de cada periodo de la ventana, desde 0: la última es
    la de `acumular_periodos`, así que la gráfica acaba en la cifra que se enseña."""
    ventana = _ventana(periodos) if periodos else None
    if not ventana:
        return []
    salida = [Decimal(0)]
    with localcontext() as ctx:
        ctx.prec = 32
        factor = Decimal(1)
        for periodo in ventana:
            factor *= Decimal(1) + periodo["rentabilidad"] / 100
            salida.append(((factor - 1) * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))
    return salida


def movimientos_rentabilidad(db: Session, temporada_id: int) -> dict[str, int]:
    """Como `movimientos_clasificacion`, con el orden por rentabilidad acumulada."""
    ids = db.execute(text("""
        select distinct i.estrategia_id::text
        from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
        where j.temporada_id = :temporada and j.estado = 'cerrada'
    """), {"temporada": temporada_id}).scalars().all()
    periodos = {eid: [p for p in lista if p["temporada_id"] == temporada_id]
                for eid, lista in periodos_cerrados(db, ids).items()}
    cortes = sorted({p["dia_fin"] for lista in periodos.values() for p in lista})
    if len(cortes) < 2:
        return {}

    def posiciones(corte: date) -> dict[str, int]:
        acumulados = {eid: acumular_periodos([p for p in lista if p["dia_fin"] <= corte])
                      for eid, lista in periodos.items()}
        ordenadas = sorted((eid for eid, a in acumulados.items() if a is not None),
                           key=lambda eid: (-acumulados[eid]["rentabilidad"], eid))
        return {eid: indice + 1 for indice, eid in enumerate(ordenadas)}

    antes, ahora = posiciones(cortes[-2]), posiciones(cortes[-1])
    return {eid: antes[eid] - puesto for eid, puesto in ahora.items() if eid in antes}


def rentabilidad_sp_temporada(db: Session, temporada_id: int,
                              sp_vivo: Decimal | float | None) -> Decimal | None:
    """El S&P de la temporada: los cierres de sus jornadas y, si hay una en juego, su cifra viva."""
    cierres = db.execute(text("""
        select sp_rentabilidad from liga.jornadas
        where temporada_id = :temporada and estado = 'cerrada' and sp_rentabilidad is not null
        order by dia_base, id
    """), {"temporada": temporada_id}).scalars().all()
    valores = [*cierres, *([sp_vivo] if sp_vivo is not None else [])]
    if not valores:
        return None
    with localcontext() as ctx:
        ctx.prec = 32
        factor = Decimal(1)
        for valor in valores:
            factor *= Decimal(1) + Decimal(str(valor)) / 100
    return ((factor - 1) * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


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
    """Compara posiciones del grupo con la misma estrategia representativa en ambos cortes."""
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
