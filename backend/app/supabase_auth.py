"""Sesión de Vennett: el JWT de Supabase Auth, verificado con el JWKS público del proyecto (ES256).

Solo cuentan tokens con firma válida, `aud=authenticated`, emitidos por este proyecto y sin caducar.
Los claims de rol del token no protegen nada: quien use esta identidad consulta el rol en su base.
Lo comparten la liga, las salas y el servicio del agente.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException

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
