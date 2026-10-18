"""API del panel de usuarios del admin, leída con RLS del admin."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.db import db_usuario
from app.liga.gestion import _tope_para_panel

router = APIRouter(prefix="/panel-usuarios", tags=["liga-admin-panel"])


class FilaPanel(BaseModel):
    id: str
    alias: str
    oculto: bool
    creado: datetime
    roles: list[str]
    suspendido: bool
    pro: bool
    visitas_total: int
    visitas_7d: int
    ultima_actividad: datetime | None
    ia_mes_usd: Decimal


class ListaPanel(BaseModel):
    total: int
    filas: list[FilaPanel]


class ResumenPanel(BaseModel):
    cuentas: int
    nuevas_7d: int
    activas_7d: int
    visitas_7d: int
    pro_vigentes: int
    pases_vigentes: int
    ia_mes_usd: Decimal
    cobrado_mes_usd: Decimal
    tope_mensual_usd: Decimal | None


class TerminosPanel(BaseModel):
    version: str
    aceptado: bool
    aceptado_en: datetime | None


class ActividadPanel(BaseModel):
    visitas_total: int
    visitas_7d: int
    ultima_visita: datetime | None
    ultima_actividad: datetime | None
    tiempo_30d_seg: int


class IAMesPanel(BaseModel):
    total_usd: Decimal
    llamadas: int
    cache: int
    conversor_usd: Decimal
    conversor_llamadas: int
    pregunta_usd: Decimal
    pregunta_llamadas: int
    cobrado_pregunta_usd: Decimal
    lectura_usd: Decimal
    lectura_llamadas: int
    cobrado_lectura_usd: Decimal
    cobrado_usd: Decimal


class IAPanel(BaseModel):
    mes: IAMesPanel
    historico_usd: Decimal


class LigaPanel(BaseModel):
    estrategias: int
    estrategias_jugando: int
    inscripciones: int
    ligas_propias: int
    ligas_miembro: int
    reportes_hechos: int
    reportes_recibidos: int


class FichaPanel(BaseModel):
    id: str
    alias: str
    email: str | None
    oculto: bool
    creado: datetime
    roles: list[str]
    suspendido: bool
    plan: Literal["gratis", "pro"]
    plan_hasta: datetime | None
    pase_liga: bool
    pase_hasta: datetime | None
    saldo: Decimal
    edad: int | None
    edad_declarada_en: datetime | None
    baja_solicitada: datetime | None
    terminos: TerminosPanel
    actividad: ActividadPanel
    ia: IAPanel
    liga: LigaPanel


class DiaPanel(BaseModel):
    dia: date
    visitas: int


class DiasPanel(BaseModel):
    dias: list[DiaPanel]


_FILTROS = {
    "todas": "true",
    "activas": "p.ultima_actividad >= now() - interval '7 days'",
    "pro": "p.pro",
    "suspendidas": "p.suspendido",
    "mayores18": "p.edad >= 18",
}
_ORDENES = {
    "ultima_actividad": "p.ultima_actividad",
    "creado": "p.creado",
    "visitas_7d": "p.visitas_7d",
    "ia_mes_usd": "p.ia_mes_usd",
}


@router.get("", response_model=ListaPanel)
def listar_panel(
    q: str = "",
    filtro: Literal["todas", "activas", "pro", "suspendidas", "mayores18"] = "todas",
    orden: Literal["ultima_actividad", "creado", "visitas_7d", "ia_mes_usd"] = "ultima_actividad",
    desc: bool = True,
    desde: int = Query(0, ge=0),
    cuantos: int = Query(50, ge=1, le=100),
    db: Session = Depends(db_usuario),
) -> ListaPanel:
    q = q.strip()
    patron = f"%{q}%"
    params = {"q": q, "patron": patron, "desde": desde, "cuantos": cuantos}
    filtro_sql = _FILTROS[filtro]
    orden_sql = _ORDENES[orden]
    sentido = "desc" if desc else "asc"
    filas = db.execute(text(f"""
        select p.id::text as id, p.alias, p.oculto, p.creado, p.roles, p.suspendido, p.pro,
               p.visitas_total, p.visitas_7d, p.ultima_actividad, p.ia_mes_usd
        from liga.v_panel_usuarios p
        where (:q = '' or p.alias ilike :patron) and {filtro_sql}
        order by {orden_sql} {sentido} nulls last, p.id
        offset :desde limit :cuantos
    """), params).mappings().all()
    total = db.execute(text(f"""
        select count(*) from liga.v_panel_usuarios p
        where (:q = '' or p.alias ilike :patron) and {filtro_sql}
    """), params).scalar_one()
    return ListaPanel(total=total, filas=[FilaPanel(**fila) for fila in filas])


@router.get("/resumen", response_model=ResumenPanel)
def resumen_panel(db: Session = Depends(db_usuario)) -> ResumenPanel:
    fila = db.execute(text("""
        select count(*) as cuentas,
               count(*) filter (where p.creado >= now() - interval '7 days') as nuevas_7d,
               count(*) filter (where p.ultima_actividad >= now() - interval '7 days')
                 as activas_7d,
               coalesce(sum(p.visitas_7d), 0) as visitas_7d,
               count(*) filter (where p.pro) as pro_vigentes,
               count(*) filter (where p.pase_liga) as pases_vigentes,
               coalesce(sum(p.ia_mes_usd), 0) as ia_mes_usd,
               coalesce(sum(p.cobrado_mes_usd), 0) as cobrado_mes_usd
        from liga.v_panel_usuarios p
    """)).mappings().one()
    valor = db.execute(text(
        "select valor from liga.ajustes where clave = 'ia.tope_mensual_usd'"
    )).scalar_one_or_none()
    return ResumenPanel(**fila, tope_mensual_usd=_tope_para_panel(valor))


@router.get("/{id}", response_model=FichaPanel)
def ficha_panel(id: uuid.UUID, response: Response,
                db: Session = Depends(db_usuario)) -> FichaPanel:
    response.headers["Cache-Control"] = "no-store"
    fila = db.execute(text("select * from liga.v_panel_usuarios where id = :id"),
                      {"id": id}).mappings().one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe ese usuario.")
    email = db.execute(text("select liga.email_de_usuario(:id)"), {"id": id}).scalar_one()
    version = db.execute(text("select liga.version_terminos()")).scalar_one()
    return FichaPanel(
        id=str(fila["id"]),
        alias=fila["alias"],
        email=email,
        oculto=fila["oculto"],
        creado=fila["creado"],
        roles=fila["roles"],
        suspendido=fila["suspendido"],
        plan="pro" if fila["pro"] else "gratis",
        plan_hasta=fila["plan_hasta"],
        pase_liga=fila["pase_liga"],
        pase_hasta=fila["pase_hasta"],
        saldo=fila["saldo"],
        edad=fila["edad"],
        edad_declarada_en=fila["edad_declarada_en"],
        baja_solicitada=fila["baja_solicitada"],
        terminos=TerminosPanel(version=version, aceptado=fila["terminos_aceptado_vigente"],
                               aceptado_en=fila["terminos_aceptado_en"]),
        actividad=ActividadPanel(
            visitas_total=fila["visitas_total"],
            visitas_7d=fila["visitas_7d"],
            ultima_visita=fila["ultima_visita"],
            ultima_actividad=fila["ultima_actividad"],
            tiempo_30d_seg=fila["tiempo_30d_seg"],
        ),
        ia=IAPanel(mes=IAMesPanel(
            total_usd=fila["ia_mes_usd"],
            llamadas=fila["ia_mes_llamadas"],
            cache=fila["ia_mes_cache"],
            conversor_usd=fila["ia_mes_conversor_usd"],
            conversor_llamadas=fila["ia_mes_conversor_llamadas"],
            pregunta_usd=fila["ia_mes_pregunta_usd"],
            pregunta_llamadas=fila["ia_mes_pregunta_llamadas"],
            cobrado_pregunta_usd=fila["cobrado_mes_pregunta_usd"],
            lectura_usd=fila["ia_mes_lectura_usd"],
            lectura_llamadas=fila["ia_mes_lectura_llamadas"],
            cobrado_lectura_usd=fila["cobrado_mes_lectura_usd"],
            cobrado_usd=fila["cobrado_mes_usd"],
        ), historico_usd=fila["ia_historico_usd"]),
        liga=LigaPanel(
            estrategias=fila["estrategias"],
            estrategias_jugando=fila["estrategias_jugando"],
            inscripciones=fila["inscripciones"],
            ligas_propias=fila["ligas_propias"],
            ligas_miembro=fila["ligas_miembro"],
            reportes_hechos=fila["reportes_hechos"],
            reportes_recibidos=fila["reportes_recibidos"],
        ),
    )


@router.get("/{id}/dias", response_model=DiasPanel)
def dias_panel(id: uuid.UUID, n: int = Query(14, ge=1, le=60),
               db: Session = Depends(db_usuario)) -> DiasPanel:
    filas = db.execute(text("""
        with dias as (
            select d::date as dia
            from generate_series((now() at time zone 'Europe/Madrid')::date - (:n - 1),
                                 (now() at time zone 'Europe/Madrid')::date, interval '1 day') as d
        )
        select dias.dia, count(v.id) as visitas
        from dias
        left join liga.visitas v
          on v.usuario_id = :uid and (v.inicio at time zone 'Europe/Madrid')::date = dias.dia
        group by dias.dia
        order by dias.dia
    """), {"n": n, "uid": id}).mappings().all()
    return DiasPanel(dias=[DiaPanel(**fila) for fila in filas])
