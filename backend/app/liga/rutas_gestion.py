"""Administración (usuarios, créditos, ajustes, auditoría) y moderación (reportes, ocultar).

Las lecturas y lo que RLS ya autoriza por columna corren como el usuario (`db_usuario`): la
política `admin` (de `es_admin()`) o `moderacion_revisar` deciden. Lo que el esquema reserva al
sistema (roles, planes) pasa por `app.liga.gestion`, que abre su propia sesión — nunca `db_sistema`
aquí (lo vigila `test_liga_puertas`)."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga import estrategias, gestion
from app.liga.auth import Identidad, require_admin, require_moderador
from app.liga.db import db_usuario

router_admin = APIRouter(tags=["liga-admin-gestion"])
router_moderacion = APIRouter(prefix="/liga/moderacion", tags=["liga-moderacion"])


# ---- Esquemas --------------------------------------------------------------------------------


class UsuarioOut(BaseModel):
    id: str
    alias: str
    roles: list[str]
    plan: Literal["gratis", "pro"]
    plan_hasta: datetime | None
    suspendido: bool
    creado: datetime


class UsuarioDetalleOut(UsuarioOut):
    oculto: bool
    saldo: Decimal


class ListaUsuarios(BaseModel):
    total: int
    filas: list[UsuarioOut]


class RolIn(BaseModel):
    rol: Literal["usuario", "moderador", "admin"]
    conceder: bool


class AltaIn(BaseModel):
    email: Annotated[str, StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    alias: str | None = Field(default=None, max_length=20)


class AltaOut(BaseModel):
    id: str
    email: str
    alias: str
    alias_aplicado: bool
    clave_temporal: str


class PlanIn(BaseModel):
    hasta: datetime | None = None


class SuspenderIn(BaseModel):
    suspendido: bool


class CreditoIn(BaseModel):
    usuario_id: uuid.UUID
    # La columna es numeric(12,4): más de 4 decimales se redondearían y más de 8 cifras enteras
    # la desbordarían. Un regalo de más de un millón de créditos es un error de dedo.
    importe: Decimal = Field(gt=0, le=1_000_000, decimal_places=4)
    motivo: Literal["regalo", "ajuste"] = "regalo"
    idempotencia: str = Field(min_length=8, max_length=80)


class MovimientoOut(BaseModel):
    id: int
    usuario_id: str
    importe: Decimal
    motivo: str
    creado: datetime
    creado_por: str | None


class ListaMovimientos(BaseModel):
    total: int
    filas: list[MovimientoOut]


class AjusteIn(BaseModel):
    valor: Any


class AjusteOut(BaseModel):
    clave: str
    grupo: Literal["Emergencia", "IA", "Créditos", "Procesos"]
    titulo: str
    ayuda: str
    tipo: Literal["interruptor", "entero", "dolares", "multiplicador"]
    unidad: str | None
    minimo: Decimal | None
    maximo: Decimal | None
    defecto: Any
    valor: Any
    efectivo: Any
    actualizado: datetime | None
    actualizado_por: str | None


class AuditoriaOut(BaseModel):
    id: int
    actor_id: str | None
    accion: str
    objeto: str | None
    detalle: dict
    creada: datetime


class ListaAuditoria(BaseModel):
    total: int
    filas: list[AuditoriaOut]


class ReporteOut(BaseModel):
    id: int
    autor_id: str | None
    tipo: Literal["alias", "estrategia", "liga", "pregunta"]
    objeto_id: str
    motivo: str
    estado: str
    creado: datetime
    contenido: str | None = None    # lo reportado: alias, nombre de la estrategia o liga, pregunta


class ListaReportes(BaseModel):
    total: int
    filas: list[ReporteOut]


class AvisoErrorOut(BaseModel):
    id: int
    codigo: str | None
    alias: str | None        # quién avisó; None si no tenía sesión
    pantalla: str
    mensaje: str
    nota: str | None
    contexto: dict
    estado: Literal["abierto", "resuelto"]
    creado: datetime


class ListaAvisosError(BaseModel):
    total: int
    filas: list[AvisoErrorOut]


class OcultarIn(BaseModel):
    reporte_id: int = Field(gt=0)


# ---- Usuarios --------------------------------------------------------------------------------

_USUARIO_CAMPOS = """
    p.id::text as id, p.alias, p.creado,
    array(select r.rol::text from liga.roles_usuario r where r.usuario_id = p.id order by r.rol)
      as roles,
    not exists (select 1 from liga.roles_usuario r
                where r.usuario_id = p.id and r.rol = 'usuario') as suspendido,
    exists (select 1 from liga.planes_usuario pl where pl.usuario_id = p.id and pl.plan = 'pro'
            and pl.desde <= clock_timestamp()
            and (pl.hasta is null or pl.hasta > clock_timestamp())) as pro,
    (select pl.hasta from liga.planes_usuario pl where pl.usuario_id = p.id and pl.plan = 'pro'
       and pl.desde <= clock_timestamp() and (pl.hasta is null or pl.hasta > clock_timestamp())
       order by pl.desde desc limit 1) as plan_hasta
"""
# `clock_timestamp()`, no `now()`: esta consulta puede correr en la misma petición que acaba de
# conceder el plan desde `gestion` (otra transacción); `now()` se queda fijo al empezar la nuestra
# y no vería la concesión recién hecha como vigente.


def _usuario_out(f) -> UsuarioOut:  # noqa: ANN001
    return UsuarioOut(id=f.id, alias=f.alias, roles=list(f.roles), suspendido=f.suspendido,
                      plan="pro" if f.pro else "gratis", plan_hasta=f.plan_hasta, creado=f.creado)


@router_admin.get("/usuarios", response_model=ListaUsuarios)
def listar_usuarios(alias: str = "", desde: int = Query(0, ge=0),
                    cuantos: int = Query(50, ge=1, le=100),
                    db: Session = Depends(db_usuario)) -> ListaUsuarios:
    patron = f"%{alias.strip()}%"
    total = db.execute(text(
        "select count(*) from liga.perfiles p where :a = '' or p.alias ilike :patron"),
        {"a": alias.strip(), "patron": patron}).scalar_one()
    filas = db.execute(text(f"""
        select {_USUARIO_CAMPOS} from liga.perfiles p
        where :a = '' or p.alias ilike :patron
        order by p.creado desc
        offset :desde limit :cuantos
    """), {"a": alias.strip(), "patron": patron, "desde": desde, "cuantos": cuantos}).all()
    return ListaUsuarios(total=total, filas=[_usuario_out(f) for f in filas])


@router_admin.post("/usuarios", response_model=AltaOut, status_code=201)
def alta_usuario(body: AltaIn, response: Response,
                 ident: Identidad = Depends(require_admin)) -> AltaOut:
    response.headers["Cache-Control"] = "no-store"
    alias = body.alias.strip().lower() if body.alias and body.alias.strip() else None
    return AltaOut(**gestion.alta_usuario(body.email, alias, ident.uid))


@router_admin.get("/usuarios/{id}", response_model=UsuarioDetalleOut)
def ver_usuario(id: uuid.UUID, db: Session = Depends(db_usuario)) -> UsuarioDetalleOut:
    f = db.execute(text(f"""
        select {_USUARIO_CAMPOS}, p.oculto,
               coalesce((select sum(m.importe) from liga.creditos_movimientos m
                         where m.usuario_id = p.id), 0) as saldo
        from liga.perfiles p where p.id = :i
    """), {"i": id}).one_or_none()
    if f is None:
        raise HTTPException(404, "No existe ese usuario.")
    return UsuarioDetalleOut(**_usuario_out(f).model_dump(), oculto=f.oculto, saldo=f.saldo)


@router_admin.post("/usuarios/{id}/rol", response_model=UsuarioDetalleOut)
def cambiar_rol(id: uuid.UUID, body: RolIn, ident: Identidad = Depends(require_admin),
                db: Session = Depends(db_usuario)) -> UsuarioDetalleOut:
    gestion.conceder_rol(str(id), body.rol, body.conceder, ident.uid)
    return ver_usuario(id, db)


@router_admin.post("/usuarios/{id}/plan", response_model=UsuarioDetalleOut)
def dar_plan_pro(id: uuid.UUID, body: PlanIn, ident: Identidad = Depends(require_admin),
                 db: Session = Depends(db_usuario)) -> UsuarioDetalleOut:
    try:
        gestion.fijar_plan_pro(str(id), body.hasta, ident.uid)
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return ver_usuario(id, db)


@router_admin.post("/usuarios/{id}/plan/quitar", response_model=UsuarioDetalleOut)
def quitar_plan_pro(id: uuid.UUID, ident: Identidad = Depends(require_admin),
                    db: Session = Depends(db_usuario)) -> UsuarioDetalleOut:
    gestion.quitar_plan_pro(str(id), ident.uid)
    return ver_usuario(id, db)


@router_admin.post("/usuarios/{id}/suspender", response_model=UsuarioDetalleOut)
def suspender_usuario(id: uuid.UUID, body: SuspenderIn, ident: Identidad = Depends(require_admin),
                      db: Session = Depends(db_usuario)) -> UsuarioDetalleOut:
    gestion.suspender(str(id), body.suspendido, ident.uid)
    return ver_usuario(id, db)


# ---- Créditos --------------------------------------------------------------------------------


@router_admin.get("/creditos", response_model=ListaMovimientos)
def listar_creditos(usuario_id: uuid.UUID | None = None, desde: int = Query(0, ge=0),
                    cuantos: int = Query(50, ge=1, le=100),
                    db: Session = Depends(db_usuario)) -> ListaMovimientos:
    filtro = "where usuario_id = :u" if usuario_id else ""
    p = {"u": usuario_id, "desde": desde, "cuantos": cuantos}
    total = db.execute(text(f"select count(*) from liga.creditos_movimientos {filtro}"), p
                       ).scalar_one()
    filas = db.execute(text(f"""
        select id, usuario_id::text as usuario_id, importe, motivo, creado,
               creado_por::text as creado_por
        from liga.creditos_movimientos {filtro}
        order by creado desc offset :desde limit :cuantos
    """), p).all()
    return ListaMovimientos(total=total, filas=[MovimientoOut(**f._mapping) for f in filas])


@router_admin.post("/creditos", response_model=MovimientoOut, status_code=201)
def otorgar_creditos(body: CreditoIn, ident: Identidad = Depends(require_admin),
                     db: Session = Depends(db_usuario)) -> MovimientoOut:
    gestion.otorgar_creditos(str(body.usuario_id), str(body.importe), body.motivo,
                             body.idempotencia, ident.uid)
    fila = db.execute(text("""
        select id, usuario_id::text as usuario_id, importe, motivo, creado,
               creado_por::text as creado_por
        from liga.creditos_movimientos where usuario_id = :u and idempotencia = :k
    """), {"u": body.usuario_id, "k": body.idempotencia}).one()
    return MovimientoOut(**fila._mapping)


# ---- Avisos de error -------------------------------------------------------------------------

_AVISO_CAMPOS = """
    a.id, a.codigo, p.alias, a.pantalla, a.mensaje, a.nota, a.contexto, a.estado, a.creado
"""


@router_admin.get("/errores", response_model=ListaAvisosError)
def listar_errores(estado: Literal["abierto", "resuelto"] = "abierto",
                   desde: int = Query(0, ge=0), cuantos: int = Query(50, ge=1, le=100),
                   db: Session = Depends(db_usuario)) -> ListaAvisosError:
    total = db.execute(text("select count(*) from liga.avisos_error where estado = :e"),
                       {"e": estado}).scalar_one()
    filas = db.execute(text(f"""
        select {_AVISO_CAMPOS} from liga.avisos_error a
        left join liga.perfiles p on p.id = a.usuario_id
        where a.estado = :e order by a.creado desc offset :desde limit :cuantos
    """), {"e": estado, "desde": desde, "cuantos": cuantos}).all()
    return ListaAvisosError(total=total, filas=[AvisoErrorOut(**f._mapping) for f in filas])


@router_admin.post("/errores/{id}/resolver", response_model=AvisoErrorOut)
def resolver_error(id: int, db: Session = Depends(db_usuario)) -> AvisoErrorOut:  # noqa: A002
    if db.execute(text("update liga.avisos_error set estado = 'resuelto' where id = :i "
                       "returning id"), {"i": id}).one_or_none() is None:
        raise HTTPException(404, "No existe ese aviso.")
    f = db.execute(text(f"""
        select {_AVISO_CAMPOS} from liga.avisos_error a
        left join liga.perfiles p on p.id = a.usuario_id where a.id = :i
    """), {"i": id}).one()
    return AvisoErrorOut(**f._mapping)


# ---- Ajustes ---------------------------------------------------------------------------------


def _ajuste_out(clave: str, valor: Any, actualizado: datetime | None,
               actualizado_por: str | None) -> AjusteOut:
    meta = gestion.CATALOGO[clave]
    return AjusteOut(
        clave=clave, grupo=meta.grupo, titulo=meta.titulo, ayuda=meta.ayuda, tipo=meta.tipo,
        unidad=meta.unidad, minimo=meta.minimo, maximo=meta.maximo, defecto=meta.defecto,
        valor=valor, efectivo=gestion.valor_efectivo(clave, valor), actualizado=actualizado,
        actualizado_por=actualizado_por)


@router_admin.get("/ajustes", response_model=list[AjusteOut])
def listar_ajustes(db: Session = Depends(db_usuario)) -> list[AjusteOut]:
    filas = db.execute(text("""
        select clave, valor, actualizado, actualizado_por::text as actualizado_por
        from liga.ajustes where clave = any(:claves)
    """), {"claves": list(gestion.AJUSTES_CONOCIDOS)}).all()
    guardadas = {f.clave: f for f in filas}
    salida = []
    for clave in gestion.CATALOGO:
        f = guardadas.get(clave)
        if f is None:
            salida.append(_ajuste_out(clave, None, None, None))
        else:
            salida.append(_ajuste_out(clave, f.valor, f.actualizado, f.actualizado_por))
    return salida


@router_admin.put("/ajustes/{clave}", response_model=AjusteOut)
def actualizar_ajuste(clave: str, body: AjusteIn, ident: Identidad = Depends(require_admin),
                     db: Session = Depends(db_usuario)) -> AjusteOut:
    if clave not in gestion.AJUSTES_CONOCIDOS:
        raise HTTPException(422, "Esa clave no se gestiona desde aquí.")
    try:
        valor = gestion.validar_ajuste(clave, body.valor)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    try:
        with db.begin_nested():
            fila = db.execute(text("""
                insert into liga.ajustes (clave, valor, actualizado_por)
                values (:c, cast(:v as jsonb), cast(:a as uuid))
                on conflict (clave) do update
                  set valor = excluded.valor, actualizado = now(),
                      actualizado_por = excluded.actualizado_por
                returning clave, valor, actualizado, actualizado_por::text as actualizado_por
            """), {"c": clave, "v": json.dumps(valor), "a": ident.uid}).one()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    gestion.invalidar_cache_ajustes(clave)
    return _ajuste_out(fila.clave, fila.valor, fila.actualizado, fila.actualizado_por)


@router_admin.delete("/ajustes/{clave}", response_model=AjusteOut)
def restablecer_ajuste(clave: str, ident: Identidad = Depends(require_admin)) -> AjusteOut:
    """Vuelve al valor por defecto: borra la fila (no la deja en null; `valor` no admite null)."""
    if clave not in gestion.AJUSTES_CONOCIDOS:
        raise HTTPException(422, "Esa clave no se gestiona desde aquí.")
    gestion.restablecer_ajuste(clave, ident.uid)
    return _ajuste_out(clave, None, None, None)


# ---- Estado real de la IA (plan §10, F6) ------------------------------------------------------


class FinalidadEstadoOut(BaseModel):
    finalidad: Literal["conversor", "pregunta", "lectura"]
    funciona: bool
    razon: str | None


class EstadoIAOut(BaseModel):
    enable_llm: bool
    deepseek_key_presente: bool
    typesafe_key_presente: bool
    gasto_mes_usd: Decimal
    tope_mensual_usd: Decimal | None
    finalidades: list[FinalidadEstadoOut]


@router_admin.get("/ia/estado", response_model=EstadoIAOut,
                  dependencies=[Depends(require_admin)])
def ia_estado() -> EstadoIAOut:
    return EstadoIAOut(**gestion.estado_ia())


# ---- Coste de IA (plan §10 y §16, F6.5) ---------------------------------------------------------


class FilaCosteIA(BaseModel):
    finalidad: Literal["conversor", "pregunta", "lectura"]
    pagado_usd: Decimal
    cobrado_usd: Decimal
    llamadas: int
    cache_hits: int
    ratio: Decimal | None
    bajo_objetivo: bool


class CosteIAOut(BaseModel):
    mes: str
    filas: list[FilaCosteIA]
    total_pagado_usd: Decimal
    total_cobrado_usd: Decimal
    tope_mensual_usd: Decimal | None
    margen_objetivo: Decimal


@router_admin.get("/coste-ia", response_model=CosteIAOut)
def coste_ia(mes: str = Query(pattern=r"^\d{4}-\d{2}$")) -> CosteIAOut:
    anio, numero_mes = (int(p) for p in mes.split("-"))
    return CosteIAOut(**gestion.coste_ia(date(anio, numero_mes, 1)))


# ---- Auditoría -------------------------------------------------------------------------------


@router_admin.get("/auditoria", response_model=ListaAuditoria)
def listar_auditoria(accion_prefix: str = "", desde: int = Query(0, ge=0),
                     cuantos: int = Query(50, ge=1, le=100),
                     db: Session = Depends(db_usuario)) -> ListaAuditoria:
    patron = f"{accion_prefix.strip()}%"
    total = db.execute(text(
        "select count(*) from liga.auditoria where accion like :patron"), {"patron": patron}
                       ).scalar_one()
    filas = db.execute(text("""
        select id, actor_id::text as actor_id, accion, objeto, detalle, creada
        from liga.auditoria where accion like :patron
        order by creada desc offset :desde limit :cuantos
    """), {"patron": patron, "desde": desde, "cuantos": cuantos}).all()
    return ListaAuditoria(total=total, filas=[AuditoriaOut(**f._mapping) for f in filas])


# ---- Moderación ------------------------------------------------------------------------------

_OCULTAR_TABLA = {
    "alias": ("liga.perfiles", "oculto"),
    "estrategia": ("liga.estrategias", "oculta"),
    # Una «pregunta» ofensiva vive en la receta de una estrategia (no tiene columna propia):
    # ocultarla oculta la estrategia entera, que es lo único que RLS deja tocar a moderación.
    "pregunta": ("liga.estrategias", "oculta"),
    "liga": ("liga.ligas_privadas", "oculta"),
}


@router_moderacion.get("/reportes", response_model=ListaReportes,
                       dependencies=[Depends(require_moderador)])
def listar_reportes(desde: int = Query(0, ge=0), cuantos: int = Query(50, ge=1, le=100),
                    db: Session = Depends(db_usuario)) -> ListaReportes:
    total = db.execute(text(
        "select count(*) from liga.reportes where estado = 'abierto'")).scalar_one()
    # `contenido`: qué se reportó, para que quien modera no decida a ciegas. Se compara como texto
    # (`id::text = objeto_id`) por si algún `objeto_id` no fuera un uuid válido.
    filas = db.execute(text("""
        select r.id, r.autor_id::text as autor_id, r.tipo, r.objeto_id, r.motivo, r.estado,
               r.creado,
               case r.tipo
                 when 'alias' then (select p.alias from liga.perfiles p
                                    where p.id::text = r.objeto_id)
                 when 'estrategia' then (select e.nombre from liga.estrategias e
                                         where e.id::text = r.objeto_id)
                 when 'liga' then (select l.nombre from liga.ligas_privadas l
                                   where l.id::text = r.objeto_id)
                 when 'pregunta' then (select rc.pregunta from liga.recetas rc
                                       where rc.estrategia_id::text = r.objeto_id
                                       order by rc.creada desc limit 1)
               end as contenido
        from liga.reportes r where r.estado = 'abierto'
        order by r.creado offset :desde limit :cuantos
    """), {"desde": desde, "cuantos": cuantos}).all()
    return ListaReportes(total=total, filas=[ReporteOut(**f._mapping) for f in filas])


@router_moderacion.post("/ocultar", response_model=ReporteOut)
def ocultar(body: OcultarIn, ident: Identidad = Depends(require_moderador),
           db: Session = Depends(db_usuario)) -> ReporteOut:
    reporte = db.execute(text("""
        select id, autor_id::text as autor_id, tipo, objeto_id, motivo, estado, creado
        from liga.reportes where id = :i
    """), {"i": body.reporte_id}).one_or_none()
    if reporte is None:
        raise HTTPException(404, "No existe ese reporte.")
    tabla, columna = _OCULTAR_TABLA[reporte.tipo]
    try:
        objetivo = uuid.UUID(reporte.objeto_id)
    except ValueError as e:
        raise HTTPException(422, "El reporte no señala un objeto válido.") from e
    try:
        with db.begin_nested():
            afectado = db.execute(text(
                f"update {tabla} set {columna} = true where id = :o"),  # noqa: S608
                {"o": objetivo}).rowcount
            if not afectado:
                raise HTTPException(404, "Lo que denuncia el reporte ya no existe.")
            fila = db.execute(text("""
                update liga.reportes
                set estado = 'resuelto', resuelto_por = cast(:a as uuid), resuelto = now()
                where id = :i
                returning id, autor_id::text as autor_id, tipo, objeto_id, motivo, estado, creado
            """), {"a": ident.uid, "i": body.reporte_id}).one()
    except DBAPIError as e:
        raise estrategias.mapear_error(e) from e
    return ReporteOut(**fila._mapping)
