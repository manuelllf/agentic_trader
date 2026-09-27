"""API de la liga (`/liga`). Cada ruta declara su puerta: `db_anon`, `db_usuario` o `require_admin`.
Las respuestas son esquemas propios por público, nunca objetos ORM."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import acceso
from app.liga.db import db_usuario

router = APIRouter(prefix="/liga", tags=["liga"])


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
