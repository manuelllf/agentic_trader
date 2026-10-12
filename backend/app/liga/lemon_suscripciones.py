"""Cancelación de suscripciones antes de borrar una cuenta."""

import httpx

from app.config import settings

LEMON_URL = "https://api.lemonsqueezy.com/v1"


def cabeceras_lemon() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.lemon_api_key}",
            "Accept": "application/vnd.api+json", "Content-Type": "application/vnd.api+json"}


class CancelacionFallida(Exception):
    """No se puede garantizar que todas las suscripciones estén canceladas."""


def cancelar_suscripciones(ids: list[str]) -> None:
    if not ids:
        return
    if not settings.lemon_api_key:
        raise CancelacionFallida
    fallo = False
    for suscripcion in ids:
        try:
            url = f"{LEMON_URL}/subscriptions/{suscripcion}"
            respuesta = httpx.get(url, headers=cabeceras_lemon(), timeout=15)
            if respuesta.status_code == 404:
                continue
            if not 200 <= respuesta.status_code < 300:
                raise CancelacionFallida
            estado = respuesta.json()["data"]["attributes"]["status"]
            if not isinstance(estado, str) or not estado:
                raise CancelacionFallida
            if estado in ("cancelled", "expired"):
                continue
            respuesta = httpx.delete(url, headers=cabeceras_lemon(), timeout=15)
            if not 200 <= respuesta.status_code < 300:
                raise CancelacionFallida
        except (CancelacionFallida, httpx.HTTPError, ValueError, KeyError, TypeError):
            fallo = True
    if fallo:
        raise CancelacionFallida
