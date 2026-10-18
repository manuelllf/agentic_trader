"""API de la liga (`/liga`). Cada ruta declara su puerta: `db_anon`, `db_usuario` o `require_admin`.
Las respuestas son esquemas propios por público, nunca objetos ORM."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.i18n import translate
from app.liga import (
    acceso,
    borradores,
    cuenta,
    gestion,
    lemon_suscripciones,
    limites,
    pagos,
    preview_seleccion,
    registro,
    rutas_avisos,
    rutas_estrategias,
    rutas_ia,
    rutas_ligas,
    rutas_publicas,
    seguimiento,
    visitas,
)
from app.liga.auth import Identidad, identidad_opcional, require_usuario
from app.liga.db import db_usuario
from app.liga.ia import moderacion
from app.liga.procesos import premio

router = APIRouter(prefix="/liga", tags=["liga"])
router.include_router(rutas_publicas.router)
router.include_router(rutas_estrategias.router)
router.include_router(rutas_avisos.router)
router.include_router(preview_seleccion.router)
router.include_router(rutas_ligas.router)
router.include_router(rutas_ia.router)
router.include_router(borradores.router)
router.include_router(visitas.router)
router.include_router(seguimiento.router)
router.include_router(registro.router)

# Exporta recorre toda su cuenta: como las pruebas de estrategias.py, cara de abusar sin freno.
_LIMITE_EXPORTAR = acceso.LimiteFrecuencia(tope=3, ventana_s=60 * 60)


class Yo(BaseModel):
    alias: str
    plan: Literal["gratis", "pro"]
    puede_crear_liga: bool   # Pro o pase de liga; unirse a una liga no lo pide
    pase_liga: bool = False  # solo el pase, no Pro: la insignia los distingue
    # Duración del Pro que cobra Lemon («mensual», «media_temporada», «temporada»); nulo si no hay
    # Pro de Lemon (sin Pro, o concedido por el admin).
    plan_pago: str | None = None
    plan_pago_hasta: datetime | None = None  # la próxima renovación de ese Pro
    roles: list[str]
    admin: bool   # enseña el «Panel de control»; entrar en las salas pide además el 2FA
    aal2: bool
    idioma: Literal["es", "en"] | None = None
    edad_declarada: bool = False
    avisos_correo: bool = False
    correo_avisos: str | None = None   # vacío: los avisos van al correo de la cuenta
    # Cuenta creada con Google o con un enlace que aún no ha aceptado los términos.
    pendiente: bool = False


class EstrategiaPremio(BaseModel):
    id: str
    nombre: str


class PremioYo(BaseModel):
    """El premio desde la propia cuenta: qué le falta para optar. Solo lo ve su dueño."""

    temporada_id: int | None
    edad: Literal["sin_declarar", "menor", "mayor"]
    estrategia: EstrategiaPremio | None
    jornadas_jugadas: int
    minimo_jornadas: int
    optas: bool


class EntrarIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=40)
    clave: str = Field(min_length=1, max_length=200)


class Sesion(BaseModel):
    access_token: str
    refresh_token: str


class AvisoErrorIn(BaseModel):
    codigo: str | None = Field(default=None, max_length=20)
    pantalla: str = Field(min_length=1, max_length=200)
    mensaje: str = Field(min_length=1, max_length=500)
    nota: str | None = Field(default=None, max_length=1000)
    contexto: dict[str, str | int | float | bool | None] = Field(default_factory=dict,
                                                                  max_length=12)


# Sin sesión también se puede avisar (un fallo al entrar es justo cuando más falta hace); el
# límite por persona o por IP frena el abuso.
_LIMITE_AVISOS = acceso.LimiteFrecuencia(tope=6, ventana_s=10 * 60)


@router.post("/errores", status_code=201)
def avisar_error(body: AvisoErrorIn, request: Request,
                 ident: Identidad | None = Depends(identidad_opcional)) -> dict:
    """«Reportar este error»: deja una nota para el admin, con el código que vio la persona."""
    if not _LIMITE_AVISOS.permitido(ident.uid if ident else acceso.ip_cliente(request)):
        raise HTTPException(429, "Ya nos has avisado varias veces. Danos un rato para mirarlo.")
    gestion.registrar_aviso_error(ident.uid if ident else None, body.codigo, body.pantalla,
                                  body.mensaje, body.nota, body.contexto)
    return {"ok": True}


@router.post("/entrar", response_model=Sesion)
def entrar(body: EntrarIn, request: Request) -> Sesion:
    """Pública y sin BD de usuario: resuelve el alias en un servicio acotado (`acceso`)."""
    return Sesion(**acceso.entrar_con_alias(body.usuario, body.clave, acceso.ip_cliente(request)))


class CambioYo(BaseModel):
    alias: str = Field(min_length=1, max_length=40)


@router.patch("/yo", response_model=Yo)
def cambiar_yo(body: CambioYo, ident: Identidad = Depends(require_usuario),
              db: Session = Depends(db_usuario)) -> Yo:
    """Cambiar el alias. Formato, reservados y unicidad los decide la BD; la lista de bloqueo va
    después, dentro de la misma transacción, y si bloquea deshace el cambio. El tope de cambios
    se audita aparte porque `liga.auditoria` le está vetada a `authenticated`."""
    limites.exigir_cambio_alias_disponible(ident.uid)
    alias = body.alias.strip().lower()
    try:
        with db.begin_nested():
            db.execute(text("update liga.perfiles set alias = :a where id = (select auth.uid())"),
                       {"a": alias})
        moderacion.evaluar_lista(alias)
    except IntegrityError as e:
        diag = getattr(e.orig, "diag", None)
        if getattr(e.orig, "sqlstate", None) == "23505":
            raise HTTPException(409, "Ese nombre ya lo tiene otra persona.") from e
        if diag is not None and diag.constraint_name == "alias_formato":
            raise HTTPException(422, "De 3 a 20 caracteres: minúsculas, números, _ o punto.") from e
        raise HTTPException(422, "Ese nombre está reservado. Prueba con otro.") from e
    limites.auditar_cambio_alias(ident.uid, alias)
    return yo(db)


@router.get("/yo", response_model=Yo)
def yo(db: Session = Depends(db_usuario)) -> Yo:
    fila = db.execute(text("""
        select p.alias, liga.es_pro() as pro, liga.puede_crear_liga() as puede_crear_liga,
               exists (select 1 from liga.pases_liga pa
                       where pa.usuario_id = p.id and pa.desde <= now()
                         and (pa.hasta is null or pa.hasta > now())) as pase_liga,
               (select cp.producto from liga.planes_usuario pu
                  join liga.compras_pago cp on cp.lemon_id = pu.compra_lemon_id
                 where pu.usuario_id = p.id and pu.plan = 'pro' and pu.origen = 'pago'
                   and pu.desde <= now() and (pu.hasta is null or pu.hasta > now())
                 order by pu.desde desc limit 1) as plan_pago,
               (select pu.hasta from liga.planes_usuario pu
                 where pu.usuario_id = p.id and pu.plan = 'pro' and pu.origen = 'pago'
                   and pu.desde <= now() and (pu.hasta is null or pu.hasta > now())
                 order by pu.desde desc limit 1) as plan_pago_hasta,
               liga.authorize('admin.salas') as admin,
               liga.aal2() as aal2, privado.idioma,
               coalesce(privado.avisos_correo, false) as avisos_correo, privado.correo_avisos,
               privado.edad is not null as edad_declarada,
               liga.cuenta_pendiente() as pendiente,
               array(select r.rol::text from liga.roles_usuario r
                     where r.usuario_id = p.id order by r.rol) as roles
        from liga.perfiles p
        left join liga.perfiles_privados privado on privado.id = p.id
        where p.id = (select auth.uid())
    """)).one_or_none()
    if fila is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    return Yo(alias=fila.alias, plan="pro" if fila.pro else "gratis",
              puede_crear_liga=fila.puede_crear_liga, pase_liga=fila.pase_liga,
              plan_pago=fila.plan_pago, plan_pago_hasta=fila.plan_pago_hasta,
              roles=list(fila.roles), admin=fila.admin, aal2=fila.aal2,
              edad_declarada=fila.edad_declarada,
              idioma=fila.idioma, avisos_correo=fila.avisos_correo,
              correo_avisos=fila.correo_avisos, pendiente=fila.pendiente)


@router.get("/yo/premio", response_model=PremioYo, dependencies=[Depends(require_usuario)])
def premio_yo(db: Session = Depends(db_usuario)) -> PremioYo:
    return PremioYo(**premio.estado_yo(db))


@router.post("/yo/terminos", response_model=Yo)
def aceptar_terminos(ident: Identidad = Depends(require_usuario),
                     db: Session = Depends(db_usuario)) -> Yo:
    """Acepta los términos y la privacidad al completar una cuenta nueva. Lo anota la función SQL,
    que no duplica nada si se repite."""
    db.execute(text("select liga.aceptar_terminos()"))
    return yo(db)


class CambioIdioma(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idioma: Literal["es", "en"]


@router.put("/yo/idioma", response_model=CambioIdioma)
def cambiar_idioma(body: CambioIdioma, db: Session = Depends(db_usuario)) -> CambioIdioma:
    resultado = db.execute(text("""
        update liga.perfiles_privados set idioma = :idioma
        where id = (select auth.uid()) returning id
    """), {"idioma": body.idioma}).one_or_none()
    if resultado is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    return body


_CORREO = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class AvisosCorreo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activo: bool
    correo: str | None = None   # vacío: el de la cuenta


@router.put("/yo/avisos-correo", response_model=AvisosCorreo)
def cambiar_avisos_correo(body: AvisosCorreo, db: Session = Depends(db_usuario)) -> AvisosCorreo:
    """Si la cuenta recibe avisos por correo y a qué dirección. La de la cuenta no se copia aquí:
    sin dirección propia, los avisos van a ella."""
    correo = (body.correo or "").strip() or None
    if correo is not None and (len(correo) > 254 or not _CORREO.fullmatch(correo)):
        raise HTTPException(422, "Revisa la dirección de correo.")
    resultado = db.execute(text("""
        update liga.perfiles_privados set avisos_correo = :activo, correo_avisos = :correo
        where id = (select auth.uid()) returning id
    """), {"activo": body.activo, "correo": correo}).one_or_none()
    if resultado is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    return AvisosCorreo(activo=body.activo, correo=correo)


class EdadDeclarada(BaseModel):
    model_config = ConfigDict(extra="forbid")
    edad: int


@router.put("/yo/edad", response_model=EdadDeclarada)
def declarar_edad(body: EdadDeclarada, db: Session = Depends(db_usuario)) -> EdadDeclarada:
    """Edad en años, una sola vez. Solo los 18 o más cuentan para el premio anual."""
    if body.edad < 14:
        raise HTTPException(422, translate("api_error_edad_minima"))
    if body.edad > 120:
        raise HTTPException(422, translate("api_error_edad_no_valida"))
    declarada = db.execute(text("""
        update liga.perfiles_privados set edad = :edad
        where id = (select auth.uid()) and edad is null returning id
    """), {"edad": body.edad}).one_or_none()
    if declarada is not None:
        return body
    existe = db.execute(text(
        "select edad from liga.perfiles_privados where id = (select auth.uid())"
    )).one_or_none()
    if existe is None:
        raise HTTPException(404, translate("api_error_no_encontramos_tu_perfil"))
    raise HTTPException(409, translate("api_error_edad_ya_declarada"))


# ---- Exportar y baja (plan §15, D17) --------------------------------------------------------


@router.get("/yo/exportar")
def exportar_datos(ident: Identidad = Depends(require_usuario),
                   db: Session = Depends(db_usuario)) -> dict:
    if not _LIMITE_EXPORTAR.permitido(ident.uid):
        raise HTTPException(429, "Demasiadas descargas seguidas. Espera un poco.")
    return cuenta.exportar(db)


class BajaIn(BaseModel):
    confirmacion: str = Field(min_length=1, max_length=40)


# La palabra de confirmación depende del idioma de la interfaz; el backend acepta las dos.
_PALABRAS_BAJA = {"eliminar", "delete"}


@router.delete("/yo", status_code=204, response_class=Response)
def borrar_cuenta(body: BajaIn, ident: Identidad = Depends(require_usuario),
                  db: Session = Depends(db_usuario)) -> Response:
    """Confirmación = escribir ELIMINAR (o DELETE). Con la sesión iniciada basta: sin contraseña ni
    nuevo inicio de sesión. Un admin no puede darse de baja a sí mismo (se quedaría sin nadie que
    gestione la liga): otro admin le quita antes el rol."""
    fila = db.execute(text("""
        select liga.authorize('admin.liga') as admin
        from liga.perfiles p where p.id = (select auth.uid())
    """)).one_or_none()
    if fila is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    if fila.admin:
        raise HTTPException(409, "Como administrador no puedes darte de baja tú mismo.")
    if body.confirmacion.strip().lower() not in _PALABRAS_BAJA:
        raise HTTPException(422, translate("api_error_baja_confirmacion"))
    try:
        lemon_suscripciones.cancelar_suscripciones(pagos.suscripciones_de_usuario(ident.uid))
    except lemon_suscripciones.CancelacionFallida as e:
        raise HTTPException(502, translate(
            "api_error_no_se_pudo_cancelar_tu_suscripcion")) from e
    cuenta.borrar_cuenta(ident.uid)
    return Response(status_code=204)
