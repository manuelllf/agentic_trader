"""Candado de las salas: la sesión de Supabase de un admin con 2FA.

- `require_auth` protege todo lo de las salas: exige `Authorization: Bearer <JWT>` verificado
  (`app/liga/auth.py`), rol admin en la BD y `aal2`. A quien no es admin, 404; sin 2FA, 403.
- Sin `SUPABASE_URL` (dev local) la auth se desactiva; en Railway sin ella no se arranca.

La seguridad real está en el backend. El candado del frontend es solo UX.
"""

from __future__ import annotations

from fastapi import Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.db import set_actor
from app.liga.auth import Identidad, comprobar_admin, verificar


def auth_enabled() -> bool:
    return bool(settings.supabase_url)


def _admin(authorization: str) -> Identidad:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="No autorizado. Inicia sesión.")
    ident = verificar(token)
    comprobar_admin(ident)  # valida rol + 2FA; lanza si no cumple (el valor de vuelta no importa)
    return ident


async def require_auth(authorization: str = Header(default="")) -> None:
    """Dependencia FastAPI: sesión de admin con 2FA, salvo que la auth esté desactivada. Deja su
    uid en el contextvar de `app.db` (saneamiento 10, `public.tocar_auditoria()`). Es `async` a
    propósito: una dependencia síncrona corre en un hilo con una copia del contexto y su
    `set_actor` no llegaría a la ruta. La verificación (puede tocar la red) va a un hilo."""
    if auth_enabled():
        ident = await run_in_threadpool(_admin, authorization)
        set_actor(ident.uid)


def auth_optional(authorization: str = Header(default="")) -> bool:
    """Para endpoints de doble nivel: nunca bloquea. True si la auth está desactivada o la sesión
    es de admin con 2FA; el propio endpoint decide qué ocultar con ese booleano."""
    if not auth_enabled():
        return True
    try:
        _admin(authorization)
    except HTTPException:
        return False
    return True
