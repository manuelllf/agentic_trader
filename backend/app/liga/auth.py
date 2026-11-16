"""Puertas de la liga sobre la sesión de Vennett (`app.supabase_auth`).

El token solo dice quién es; el rol y el plan se consultan en la BD, así que retirarlos tiene
efecto inmediato.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy import text

from app.supabase_auth import Identidad, verificar

__all__ = ["Identidad", "comprobar_admin", "identidad_opcional", "require_admin",
           "require_jugador", "require_moderador", "require_permiso", "require_usuario",
           "verificar"]


def _bearer(authorization: str) -> str:
    return authorization.removeprefix("Bearer ").strip()


def identidad_opcional(authorization: str = Header(default="")) -> Identidad | None:
    """Sin cabecera, anónimo; con un token malo, 401 (nunca se degrada a anónimo en silencio)."""
    token = _bearer(authorization)
    return verificar(token) if token else None


def require_usuario(ident: Identidad | None = Depends(identidad_opcional)) -> Identidad:
    if ident is None:
        raise HTTPException(401, "Entra en tu cuenta para seguir.")
    return ident


def comprobar_admin(ident: Identidad) -> Identidad:
    """Rol admin en la BD y 2FA superado en esta sesión. A quien no es admin, 404: no se revela
    que existe; al admin sin 2FA, 403 para que la app le pida el código."""
    from app.liga.db import sesion_como

    with sesion_como(ident) as db:
        admin, aal2 = db.execute(
            text("select liga.authorize('admin.salas'), liga.aal2()")).one()
    if not admin:
        raise HTTPException(404, "Not Found")
    if not aal2:
        raise HTTPException(403, "Falta el código de verificación en dos pasos.")
    return ident


def require_admin(ident: Identidad = Depends(require_usuario)) -> Identidad:
    return comprobar_admin(ident)


def require_permiso(permiso: str):  # noqa: ANN201 — fábrica de puertas, como `comprobar_admin`
    """Fábrica de una puerta por permiso de `liga.authorize` (moderación, etc.), sin exigir 2FA:
    a quien no lo tiene, 404 (no se revela que la ruta existe)."""

    def _comprobar(ident: Identidad = Depends(require_usuario)) -> Identidad:
        from app.liga.db import sesion_como

        with sesion_como(ident) as db:
            tiene = db.execute(text("select liga.authorize(cast(:p as liga.permiso))"),
                              {"p": permiso}).scalar()
        if not tiene:
            raise HTTPException(404, "Not Found")
        return ident

    return _comprobar


require_moderador = require_permiso("moderacion.revisar")


def require_jugador(ident: Identidad = Depends(require_usuario)) -> Identidad:
    """Quien tiene su cuenta suspendida (sin el rol `usuario`) conserva la sesión pero no puede
    gastar: lo caro (IA, créditos) pasa por aquí. A diferencia de moderación, se le dice por qué."""
    from app.liga.db import sesion_como

    with sesion_como(ident) as db:
        activa = db.execute(text("select liga.authorize(cast('liga.jugar' as liga.permiso))")
                            ).scalar()
    if not activa:
        raise HTTPException(403, "Tu cuenta está suspendida. Si crees que es un error, "
                                 "escríbenos.")
    return ident
