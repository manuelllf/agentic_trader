"""Correo de salida con Resend. Best-effort: nunca lanza y devuelve si Resend lo aceptó.

Sin `RESEND_API_KEY` no hace nada y el resto de avisos sigue igual."""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def _post(payload: dict, clave: str) -> httpx.Response:
    return httpx.post(RESEND_URL, json=payload, headers={"Authorization": f"Bearer {clave}"},
                      timeout=10)


def enviar(destino: str, asunto: str, texto: str, html: str | None = None) -> bool:
    """Manda un correo a `destino`: el texto siempre y el HTML si lo hay."""
    clave = settings.resend_api_key
    if not clave:
        logger.info("Correo omitido: falta RESEND_API_KEY.")
        return False
    payload = {"from": settings.correo_remitente, "to": [destino], "subject": asunto, "text": texto}
    if html:
        payload["html"] = html
    try:
        respuesta = _post(payload, clave)
    except Exception:
        logger.exception("Correo fallido: sin respuesta de Resend.")
        return False
    if respuesta.status_code >= 300:
        logger.warning("Correo fallido (%s): %s", respuesta.status_code, respuesta.text[:200])
        return False
    return True
