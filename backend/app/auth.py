"""Login de acceso — contraseña única + token de sesión firmado (sin librerías externas).

Modelo (app personal de un solo usuario):
- La contraseña vive en `APP_PASSWORD` (env de Railway; secreto). NUNCA en el repo.
- `POST /auth/login` compara la contraseña (tiempo constante) y devuelve un TOKEN firmado
  con HMAC-SHA256 usando la propia contraseña como clave. El token lleva su timestamp y caduca.
- `require_auth` protege TODA la API menos /health y /auth/login: exige `Authorization: Bearer`.
- Si `APP_PASSWORD` está vacía (dev local), la auth se DESACTIVA (nada de candado en local).

La seguridad real está en el backend (sin token válido → 401 y nada se ejecuta). El candado
del frontend es solo UX (mostrar el login en vez de la app).
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import Header, HTTPException

from app.config import settings


def auth_enabled() -> bool:
    return bool(settings.app_password)


def _sign(msg: str) -> str:
    return hmac.new(settings.app_password.encode(), msg.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    """Token = '<timestamp>.<hmac>' firmado con la contraseña. Sin estado en servidor."""
    ts = str(int(time.time()))
    return f"{ts}.{_sign(ts)}"


def verify_token(token: str) -> bool:
    if not token or "." not in token:
        return False
    ts, sig = token.split(".", 1)
    if not hmac.compare_digest(sig, _sign(ts)):
        return False
    if settings.auth_token_days <= 0:
        return True  # sesión permanente: firma válida basta (se revoca cambiando la contraseña)
    try:
        age = time.time() - int(ts)
    except ValueError:
        return False
    return 0 <= age <= settings.auth_token_days * 86400


def login(password: str) -> str | None:
    """Devuelve un token si la contraseña es correcta; None si no. Comparación en tiempo constante."""
    if not auth_enabled():
        return make_token()  # sin contraseña configurada: acceso libre (dev)
    if hmac.compare_digest(password or "", settings.app_password):
        return make_token()
    return None


def require_auth(authorization: str = Header(default="")) -> None:
    """Dependencia FastAPI: exige un token válido salvo que la auth esté desactivada."""
    if not auth_enabled():
        return
    token = authorization.removeprefix("Bearer ").strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="No autorizado. Inicia sesión.")
