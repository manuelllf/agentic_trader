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
import logging
import threading
import time

from fastapi import Header, HTTPException

from app.config import settings

logger = logging.getLogger(__name__)


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


def auth_optional(authorization: str = Header(default="")) -> bool:
    """Dependencia FastAPI para endpoints de doble nivel (públicos con extra si hay sesión):
    NUNCA bloquea la petición. Devuelve True si la auth está desactivada o el token es válido;
    False si no hay token o es inválido — el propio endpoint decide qué ocultar con ese booleano."""
    if not auth_enabled():
        return True
    token = authorization.removeprefix("Bearer ").strip()
    return verify_token(token)


# ---- Rate-limit del login (in-process, sin dependencias) ---------------------
# Frena la fuerza bruta contra la contraseña única: solo cuentan los FALLOS — 5 por IP en
# 15 min, o 30 globales como respaldo (el X-Forwarded-For lo puede falsificar el cliente,
# así que el tope por IP solo no bastaría). Un login correcto limpia el contador de su IP.
# Estado en memoria del proceso: un único worker en Railway, y reiniciar = perdonar — bien.

_WINDOW_SECONDS = 15 * 60
_MAX_FAILS_PER_IP = 5
_MAX_FAILS_GLOBAL = 30

_fails: dict[str, list[float]] = {}     # ip → timestamps de fallos dentro de la ventana
_fails_lock = threading.Lock()


def _prune_fails(now: float) -> None:
    cutoff = now - _WINDOW_SECONDS
    for ip in list(_fails):
        vivos = [t for t in _fails[ip] if t > cutoff]
        if vivos:
            _fails[ip] = vivos
        else:
            del _fails[ip]


def login_blocked(ip: str) -> int:
    """Segundos de bloqueo que le quedan a esta IP (0 = puede intentarlo)."""
    now = time.time()
    with _fails_lock:
        _prune_fails(now)
        propios = _fails.get(ip, [])
        if len(propios) >= _MAX_FAILS_PER_IP:
            return max(1, int(propios[0] + _WINDOW_SECONDS - now) + 1)
        total = sum(len(v) for v in _fails.values())
        if total >= _MAX_FAILS_GLOBAL:
            mas_viejo = min(t for v in _fails.values() for t in v)
            return max(1, int(mas_viejo + _WINDOW_SECONDS - now) + 1)
    return 0


def register_login_failure(ip: str) -> None:
    now = time.time()
    with _fails_lock:
        _prune_fails(now)
        _fails.setdefault(ip, []).append(now)
        if len(_fails[ip]) == _MAX_FAILS_PER_IP:
            logger.warning("Rate-limit de login alcanzado para %s (%s fallos en %s min).",
                           ip, _MAX_FAILS_PER_IP, _WINDOW_SECONDS // 60)


def clear_login_failures(ip: str) -> None:
    with _fails_lock:
        _fails.pop(ip, None)
