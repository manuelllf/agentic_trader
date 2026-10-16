"""Verificación de Cloudflare Turnstile para solicitudes públicas."""

import httpx
from fastapi import HTTPException

from app.config import settings
from app.i18n import translate


def verificar(token: str | None, ip: str | None) -> None:
    if not settings.turnstile_secret_key:
        return
    if not token:
        raise HTTPException(403, translate("api_error_captcha_invalido"))
    try:
        respuesta = httpx.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": settings.turnstile_secret_key, "response": token,
                  "remoteip": ip or ""},
            timeout=5,
        )
    except httpx.RequestError:
        raise HTTPException(503, translate("api_error_captcha_no_disponible")) from None
    if respuesta.status_code == 200:
        try:
            datos = respuesta.json()
        except ValueError:
            datos = None
        if isinstance(datos, dict) and datos.get("success") is True:
            return
    raise HTTPException(403, translate("api_error_captcha_invalido"))
