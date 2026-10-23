"""Lee el panel de admin en vivo y con la sesión del admin.
Los umbrales salen de liga.ajustes."""

import csv
import io
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import gestion, panel_usuarios
from app.liga.db import db_usuario
from app.liga.motor.calendario import HORA_CIERRE_JORNADA, TZ_NUEVA_YORK
from app.liga.panel_usuarios import ResumenPanel
from app.liga.procesos import estado, premio
from app.liga.rutas_aprender import horas_del_ciclo

router = APIRouter(prefix="/panel", tags=["liga-admin-panel"])


def _ajuste(db: Session, clave: str) -> Any:
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": clave}).scalar_one_or_none()
    return gestion.valor_efectivo(clave, valor)


class PendienteOut(BaseModel):
    tipo: Literal["proceso_fallido", "revisar", "premio", "tope_ia", "altas_sin_estrategia"]
    seccion: Literal["jornadas", "revisar", "premio", "coste", "consultas"]
    cuantos: int
    datos: dict


class ProximoOut(BaseModel):
    paso: Literal["foto", "formar", "cerrar"]
    jornada: int
    cuando: datetime
    automatico: bool


class VistazoOut(BaseModel):
    cuentas: int
    activas_7d: int
    en_juego: int
    tope_ia_pct: Decimal | None


class ResumenAdminOut(BaseModel):
    pendientes: list[PendienteOut]
    proximo: ProximoOut | None
    vistazo: VistazoOut


class CohorteOut(BaseModel):
    semana: date
    altas: int
    con_estrategia: int
    apuntadas: int
    jugaron: int


class VueltaOut(BaseModel):
    semana: date
    jugaron: int
    base_2: int
    vuelven_2: int
    base_3: int
    vuelven_3: int


class EmbudoOut(BaseModel):
    altas: int
    con_estrategia: int
    apuntadas: int
    jugaron: int


class DiaVisitasOut(BaseModel):
    dia: date
    visitas: int
    cuentas: int


class AnaliticaOut(BaseModel):
    cifras: ResumenPanel
    visitas_7d_anterior: int
    en_juego_usuarios: int
    en_juego_casa: int
    embudo: EmbudoOut
    cohortes: list[CohorteOut]
    vuelta: list[VueltaOut]
    visitas_dia: list[DiaVisitasOut]


class ConsultaOut(BaseModel):
    clave: str
    columnas: list[str]
    filas: list[list[Any]]
    umbral_dias: int | None


@router.get("/resumen", response_model=ResumenAdminOut)
def resumen(db: Session = Depends(db_usuario)) -> ResumenAdminOut:
    pendientes = []
    estado_general = estado.general()
    for proceso, intento in estado_general["ultimo_intento"].items():
        if intento and intento["ok"] is False:
            pendientes.append(PendienteOut(
                tipo="proceso_fallido", seccion="jornadas", cuantos=1,
                datos={"proceso": proceso, "cuando": intento["cuando"]}))
    errores = db.execute(text("""
        select count(*) as n, min(creado) as desde
        from liga.avisos_error where estado = 'abierto'
    """)).one()
    reportes = db.execute(text("""
        select count(*) as n, min(creado) as desde
        from liga.reportes where estado = 'abierto'
    """)).one()
    if errores.n + reportes.n > 0:
        desde = min((f.desde for f in (errores, reportes) if f.desde is not None),
                    default=None)
        pendientes.append(PendienteOut(
            tipo="revisar", seccion="revisar", cuantos=errores.n + reportes.n,
            datos={"errores": errores.n, "reportes": reportes.n,
                   "desde": desde.isoformat() if desde else None}))
    for temporada in premio.estado_admin()["temporadas"]:
        if temporada["estado"] == "cerrada" and not temporada["calculado"]:
            pendientes.append(PendienteOut(
                tipo="premio", seccion="premio", cuantos=1,
                datos={"temporada": temporada["nombre"]}))
    coste = gestion.coste_ia(datetime.now(UTC).date().replace(day=1))
    tope = coste["tope_mensual_usd"]
    usado = None
    if tope and tope > 0:
        usado = coste["total_pagado_usd"] / tope * 100
        aviso = _ajuste(db, "panel.aviso_tope_ia_pct")
        if usado >= aviso:
            pendientes.append(PendienteOut(
                tipo="tope_ia", seccion="coste", cuantos=1,
                datos={"usado_pct": int(usado), "aviso_pct": int(aviso)}))
    n = int(_ajuste(db, "panel.dias_sin_estrategia"))
    altas = db.execute(text("""
        select count(*) from liga.v_admin_sin_estrategia
        where creado <= now() - make_interval(days => :n)
          and creado > now() - make_interval(days => 2 * :n)
    """), {"n": n}).scalar_one()
    if altas > 0:
        pendientes.append(PendienteOut(
            tipo="altas_sin_estrategia", seccion="consultas", cuantos=altas, datos={"dias": n}))
    proximos = []
    for temporada in estado_general["temporadas"]:
        for jornada in temporada["jornadas"]:
            paso = jornada["siguiente"]
            if not paso:
                continue
            if paso == "foto":
                cuando = horas_del_ciclo(date.fromisoformat(jornada["dia_base"]),
                                         date.fromisoformat(jornada["dia_inicio"]))["escaneo"]
            elif paso == "formar":
                cuando = datetime.fromisoformat(jornada["cierre_inscripcion"])
            else:
                cuando = datetime.combine(date.fromisoformat(jornada["dia_fin"]),
                                          HORA_CIERRE_JORNADA, tzinfo=TZ_NUEVA_YORK)
            proximos.append(ProximoOut(
                paso=paso, jornada=jornada["numero"], cuando=cuando,
                automatico=bool(_ajuste(db, f"procesos.{paso}.auto"))))
    vistazo = db.execute(text("""
        select count(*) as cuentas,
               count(*) filter (where p.ultima_actividad >= now() - interval '7 days')
                 as activas_7d
        from liga.v_panel_usuarios p
    """)).mappings().one()
    en_juego = db.execute(text("""
        select count(*) from liga.inscripciones i
        join liga.jornadas j on j.id = i.jornada_id where j.estado = 'formada'
    """)).scalar_one()
    return ResumenAdminOut(
        pendientes=pendientes, proximo=min(proximos, key=lambda p: p.cuando, default=None),
        vistazo=VistazoOut(**vistazo, en_juego=en_juego,
                          tope_ia_pct=usado.quantize(Decimal("0.1")) if usado is not None
                          else None))


@router.get("/analitica", response_model=AnaliticaOut)
def analitica(dias: int = Query(30, ge=1, le=365),
              db: Session = Depends(db_usuario)) -> AnaliticaOut:
    cifras = panel_usuarios.resumen_panel(db)
    anterior = db.execute(text("""
        select count(*) from liga.visitas
        where inicio >= now() - interval '14 days' and inicio < now() - interval '7 days'
    """)).scalar_one()
    en_juego = db.execute(text("""
        select coalesce(sum(case when e.tipo = 'casa' then 1 else 0 end), 0) as casa,
               coalesce(sum(case when e.tipo = 'usuario' then 1 else 0 end), 0) as usuarios
        from liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id
        join liga.estrategias e on e.id = i.estrategia_id where j.estado = 'formada'
    """)).one()
    filas = db.execute(text("""
        select c.*, v.base_2, v.vuelven_2, v.base_3, v.vuelven_3
        from liga.v_admin_cohortes c join liga.v_admin_vuelta v using (semana)
        order by c.semana desc
    """)).mappings().all()
    cohortes = [CohorteOut(**f) for f in filas]
    vuelta = [VueltaOut(**f) for f in filas]
    embudo = EmbudoOut(**{c: sum(getattr(f, c) for f in cohortes)
                         for c in EmbudoOut.model_fields})
    visitas = db.execute(text("""
        with dias as (
            select d::date as dia from generate_series(
                (now() at time zone 'Europe/Madrid')::date - (:n - 1),
                (now() at time zone 'Europe/Madrid')::date, interval '1 day') as d
        )
        select dias.dia, coalesce(v.visitas, 0) as visitas, coalesce(v.cuentas, 0) as cuentas
        from dias left join liga.v_admin_visitas_dia v on v.dia = dias.dia order by dias.dia
    """), {"n": dias}).mappings().all()
    return AnaliticaOut(
        cifras=cifras, visitas_7d_anterior=anterior, en_juego_usuarios=en_juego.usuarios,
        en_juego_casa=en_juego.casa, embudo=embudo, cohortes=cohortes, vuelta=vuelta,
        visitas_dia=[DiaVisitasOut(**f) for f in visitas])


_CONSULTAS = {
    "sin_estrategia": ("""
        select alias, creado, visitas, ultima_visita, borrador from liga.v_admin_sin_estrategia
        where creado <= now() - make_interval(days => :n) order by creado
    """, "panel.dias_sin_estrategia"),
    "inactivas": ("""
        select alias, creado, ultima_visita, visitas from liga.v_admin_inactivas
        where ultima_visita < now() - make_interval(days => :n) order by ultima_visita
    """, "panel.dias_inactiva"),
    "nunca_apuntadas": ("""
        select nombre, alias, estado, creada from liga.v_admin_nunca_apuntadas
        order by creada desc
    """, None),
    "reglas_usadas": ("""
        select clave, estrategias from liga.v_admin_reglas_usadas
        order by estrategias desc, clave
    """, None),
}


@router.get("/consultas/{clave}", response_model=ConsultaOut)
def consulta(
    clave: Literal["sin_estrategia", "inactivas", "nunca_apuntadas", "reglas_usadas"],
    response: Response,
    formato: Literal["json", "csv"] = "json",
    db: Session = Depends(db_usuario),
) -> ConsultaOut | Response:
    sql, ajuste = _CONSULTAS[clave]
    n = int(_ajuste(db, ajuste)) if ajuste else None
    resultado = db.execute(text(sql), {"n": n} if ajuste else {})
    columnas = list(resultado.keys())
    filas = [list(f) for f in resultado.all()]
    response.headers["Cache-Control"] = "no-store"
    if formato == "json":
        return ConsultaOut(clave=clave, columnas=columnas, filas=filas, umbral_dias=n)
    salida = io.StringIO()
    escritor = csv.writer(salida)
    escritor.writerow(columnas)
    for fila in filas:
        escritor.writerow([v.isoformat() if isinstance(v, (date, datetime)) else v for v in fila])
    return Response(salida.getvalue(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{clave}.csv"',
        "Cache-Control": "no-store",
    })
