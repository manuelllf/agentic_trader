"""Identidad: el JWT de Supabase Auth, verificado con el JWKS público del proyecto (ES256).

Solo cuentan tokens con firma válida, `aud=authenticated`, emitidos por este proyecto y sin caducar.
Los claims de rol del token no protegen nada: el rol y el plan se consultan en la BD, así que
retirarlos tiene efecto inmediato.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import text

from app.config import settings

_ALGORITMOS = ["ES256"]
_MARGEN_S = 30  # desfase de reloj tolerado entre Supabase y Railway


@dataclass(frozen=True)
class Identidad:
    uid: str
    aal: str
    claims: dict[str, Any]


_jwks: jwt.PyJWKClient | None = None
_jwks_lock = threading.Lock()


def _emisor() -> str:
    if not settings.supabase_url:
        raise HTTPException(503, "Las cuentas de usuario todavía no están activas.")
    return settings.supabase_url.rstrip("/") + "/auth/v1"


def _cliente_jwks() -> jwt.PyJWKClient:
    global _jwks
    with _jwks_lock:
        if _jwks is None:
            _jwks = jwt.PyJWKClient(_emisor() + "/.well-known/jwks.json",
                                    cache_keys=True, lifespan=3600, timeout=5,
                                    # Un `kid` desconocido fuerza recarga: sin ventana, tokens
                                    # inventados harían una descarga a Supabase por petición.
                                    cooldown_duration=60)
        return _jwks


def verificar(token: str) -> Identidad:
    emisor = _emisor()
    try:
        clave = _cliente_jwks().get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError as e:
        raise HTTPException(503, "No se pudo comprobar la sesión. Prueba en un momento.") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Sesión no válida. Vuelve a entrar.") from e
    try:
        claims = jwt.decode(token, clave, algorithms=_ALGORITMOS, audience="authenticated",
                            issuer=emisor, leeway=_MARGEN_S,
                            options={"require": ["exp", "sub", "aud", "iss"]})
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(401, "La sesión ha caducado. Vuelve a entrar.") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Sesión no válida. Vuelve a entrar.") from e
    if claims.get("role") != "authenticated":
        raise HTTPException(401, "Sesión no válida. Vuelve a entrar.")
    return Identidad(uid=claims["sub"], aal=claims.get("aal", "aal1"), claims=claims)


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
