"""Candado de las salas: la sesión de Supabase de un admin con 2FA.

- `require_auth` protege todo lo de las salas: exige `Authorization: Bearer <JWT>` verificado
  (`app/liga/auth.py`), rol admin en la BD y `aal2`. A quien no es admin, 404; sin 2FA, 403.
- Sin `SUPABASE_URL` (dev local) la auth se desactiva; en Railway sin ella no se arranca.

La seguridad real está en el backend. El candado del frontend es solo UX.
"""

from __future__ import annotations

from fastapi import Header, HTTPException

from app.config import settings
from app.liga.auth import comprobar_admin, verificar


def auth_enabled() -> bool:
    return bool(settings.supabase_url)


def _admin(authorization: str) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="No autorizado. Inicia sesión.")
    comprobar_admin(verificar(token))


def require_auth(authorization: str = Header(default="")) -> None:
    """Dependencia FastAPI: sesión de admin con 2FA, salvo que la auth esté desactivada."""
    if auth_enabled():
        _admin(authorization)


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
