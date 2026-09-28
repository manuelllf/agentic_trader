"""API de la liga (`/liga`). Cada ruta declara su puerta: `db_anon`, `db_usuario` o `require_admin`.
Las respuestas son esquemas propios por público, nunca objetos ORM."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.liga import (
    acceso,
    cuenta,
    limites,
    rutas_estrategias,
    rutas_ia,
    rutas_ligas,
    rutas_publicas,
)
from app.liga.auth import Identidad, require_usuario
from app.liga.db import db_usuario
from app.liga.ia import moderacion

router = APIRouter(prefix="/liga", tags=["liga"])
router.include_router(rutas_publicas.router)
router.include_router(rutas_estrategias.router)
router.include_router(rutas_ligas.router)
router.include_router(rutas_ia.router)

# Exporta recorre toda su cuenta: como las pruebas de estrategias.py, cara de abusar sin freno.
_LIMITE_EXPORTAR = acceso.LimiteFrecuencia(tope=3, ventana_s=60 * 60)


class Yo(BaseModel):
    alias: str
    plan: Literal["gratis", "pro"]
    roles: list[str]
    admin: bool   # enseña el «Panel de control»; entrar en las salas pide además el 2FA
    aal2: bool


class EntrarIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=40)
    clave: str = Field(min_length=1, max_length=200)


class Sesion(BaseModel):
    access_token: str
    refresh_token: str


@router.post("/entrar", response_model=Sesion)
def entrar(body: EntrarIn, request: Request) -> Sesion:
    """Pública y sin BD de usuario: resuelve el alias en un servicio acotado (`acceso`)."""
    return Sesion(**acceso.entrar_con_alias(body.usuario, body.clave, acceso.ip_cliente(request)))


class CambioYo(BaseModel):
    alias: str = Field(min_length=1, max_length=40)


@router.patch("/yo", response_model=Yo)
def cambiar_yo(body: CambioYo, background_tasks: BackgroundTasks,
              ident: Identidad = Depends(require_usuario),
              db: Session = Depends(db_usuario)) -> Yo:
    """Cambiar el alias. Formato, nombres reservados y unicidad los decide la BD; la lista de
    bloqueo va después, todavía dentro de la petición: si bloquea, deshace el cambio (misma
    transacción). El modelo (hasta 20 s de proveedor) corre en segundo plano, sobre el alias ya
    guardado -- nunca añade su latencia a la respuesta. El tope persistente (plan §14: 3 cada 30
    días) se audita aparte porque `liga.auditoria` le está vetada a `authenticated`."""
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
    background_tasks.add_task(moderacion.evaluar_en_fondo, "alias", ident.uid, alias)
    return yo(db)


@router.get("/yo", response_model=Yo)
def yo(db: Session = Depends(db_usuario)) -> Yo:
    fila = db.execute(text("""
        select p.alias, liga.es_pro() as pro, liga.authorize('admin.salas') as admin,
               liga.aal2() as aal2,
               array(select r.rol::text from liga.roles_usuario r
                     where r.usuario_id = p.id order by r.rol) as roles
        from liga.perfiles p where p.id = (select auth.uid())
    """)).one_or_none()
    if fila is None:
        raise HTTPException(404, "No encontramos tu perfil.")
    return Yo(alias=fila.alias, plan="pro" if fila.pro else "gratis", roles=list(fila.roles),
              admin=fila.admin, aal2=fila.aal2)


# ---- Exportar y baja (plan §15, D17) --------------------------------------------------------


@router.get("/yo/exportar")
def exportar_datos(ident: Identidad = Depends(require_usuario),
                   db: Session = Depends(db_usuario)) -> dict:
    if not _LIMITE_EXPORTAR.permitido(ident.uid):
        raise HTTPException(429, "Demasiadas descargas seguidas. Espera un poco.")
    return cuenta.exportar(db)


class BajaIn(BaseModel):
    confirmacion: str = Field(min_length=1, max_length=40)


@router.delete("/yo", status_code=204, response_class=Response)
def borrar_cuenta(body: BajaIn, ident: Identidad = Depends(require_usuario),
                  db: Session = Depends(db_usuario)) -> Response:
    """Confirmación = escribir el propio alias. Un admin no puede darse de baja a sí mismo (se
    quedaría el sistema sin nadie que gestione la liga): que otro admin le quite antes el rol."""
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
    cuenta.borrar_cuenta(ident.uid)
    return Response(status_code=204)
