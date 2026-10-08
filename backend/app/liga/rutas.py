"""API de la liga (`/liga`). Cada ruta declara su puerta: `db_anon`, `db_usuario` o `require_admin`.
Las respuestas son esquemas propios por público, nunca objetos ORM."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.liga import (
    acceso,
    borradores,
    cuenta,
    gestion,
    limites,
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
_LIMITE_BAJA = acceso.LimiteFrecuencia(tope=5, ventana_s=15 * 60)


class Yo(BaseModel):
    alias: str
    plan: Literal["gratis", "pro"]
    puede_crear_liga: bool   # Pro o pase de liga; unirse a una liga no lo pide
    roles: list[str]
    admin: bool   # enseña el «Panel de control»; entrar en las salas pide además el 2FA
    aal2: bool
    idioma: Literal["es", "en"] | None = None
    # Cuenta creada con Google o con un enlace que aún no ha aceptado los términos.
    pendiente: bool = False


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
               liga.authorize('admin.salas') as admin,
               liga.aal2() as aal2, privado.idioma,
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
              puede_crear_liga=fila.puede_crear_liga, roles=list(fila.roles),
              admin=fila.admin, aal2=fila.aal2, idioma=fila.idioma, pendiente=fila.pendiente)


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


# ---- Exportar y baja (plan §15, D17) --------------------------------------------------------


@router.get("/yo/exportar")
def exportar_datos(ident: Identidad = Depends(require_usuario),
                   db: Session = Depends(db_usuario)) -> dict:
    if not _LIMITE_EXPORTAR.permitido(ident.uid):
        raise HTTPException(429, "Demasiadas descargas seguidas. Espera un poco.")
    return cuenta.exportar(db)


class BajaIn(BaseModel):
    confirmacion: str = Field(min_length=1, max_length=40)
    clave: str = Field(min_length=1, max_length=200)


@router.delete("/yo", status_code=204, response_class=Response)
def borrar_cuenta(body: BajaIn, ident: Identidad = Depends(require_usuario),
                  db: Session = Depends(db_usuario)) -> Response:
    """Confirmación = escribir el propio alias y la contraseña. Un admin no puede darse de baja
    a sí mismo (se quedaría sin nadie que gestione la liga): otro admin le quita antes el rol."""
    fila = db.execute(text("""
        select p.alias, liga.authorize('admin.liga') as admin
        from liga.perfiles p where p.id = (select auth.uid())
    """)).one_or_none()
    if fila is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    if fila.admin:
        raise HTTPException(409, "Como administrador no puedes darte de baja tú mismo.")
    if body.confirmacion.strip().lower() != fila.alias:
        raise HTTPException(422, "Escribe tu nombre de usuario tal cual para confirmar la baja.")
    if not _LIMITE_BAJA.permitido(ident.uid):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    if not acceso.clave_correcta(ident.uid, body.clave):
        raise HTTPException(403, "La contraseña no es correcta.")
    cuenta.borrar_cuenta(ident.uid)
    return Response(status_code=204)
