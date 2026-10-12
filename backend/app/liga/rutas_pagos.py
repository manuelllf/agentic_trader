"""Pagos con Lemon Squeezy. El webhook no pide sesión: lo firma Lemon, y la firma es lo que se
comprueba. El checkout sí exige cuenta y devuelve la URL de Lemon; el comprador no pasa por aquí
con datos de pago."""

from __future__ import annotations

import json
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.config import settings
from app.i18n import translate
from app.liga import acceso, pagos
from app.liga.auth import Identidad, require_usuario
from app.liga.pagos_lemon import PRODUCTOS, interpretar, verificar_firma

logger = logging.getLogger(__name__)
router = APIRouter(tags=["liga-pagos"])

_LIMITE_CHECKOUT = acceso.LimiteFrecuencia(tope=10, ventana_s=60 * 10)
_TAMANO_MAXIMO = 64 * 1024


class CheckoutIn(BaseModel):
    producto: Literal["mensual", "media_temporada", "temporada", "pack_liga"]


class CheckoutOut(BaseModel):
    url: str


@router.post("/liga/pagos/lemon/webhook")
async def webhook(request: Request) -> dict:
    cuerpo = await request.body()
    if len(cuerpo) > _TAMANO_MAXIMO:
        raise HTTPException(413)
    firma = request.headers.get("x-signature", "")
    if not verificar_firma(cuerpo, firma, settings.lemon_webhook_secret):
        logger.warning("Webhook de Lemon con firma no válida")
        raise HTTPException(401)
    try:
        evento = json.loads(cuerpo)
        nombre = evento["meta"]["event_name"]
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400) from e

    accion = interpretar(evento, _mapa_variantes(), settings.lemon_modo)
    estado = pagos.registrar(cuerpo, accion, nombre)
    return {"estado": estado}


@router.post("/liga/pagos/lemon/checkout", response_model=CheckoutOut)
def checkout(body: CheckoutIn, ident: Identidad = Depends(require_usuario)) -> CheckoutOut:
    if not _LIMITE_CHECKOUT.permitido(ident.uid):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    clave = pagos.clave_si_ya_tiene(ident.uid, body.producto)
    if clave:
        raise HTTPException(409, translate(clave))
    variante = _variante_de(body.producto)
    if not variante or not settings.lemon_api_key or not settings.lemon_store_id:
        raise HTTPException(503, "Los pagos todavía no están activos.")

    payload = {"data": {
        "type": "checkouts",
        "attributes": {
            # Sin esto Lemon crea el checkout en modo real: una variante de prueba da 404.
            "test_mode": settings.lemon_modo == "test",
            "checkout_data": {"custom": {"user_id": ident.uid}},
            "product_options": {"redirect_url": settings.lemon_url_retorno},
        },
        "relationships": {
            "store": {"data": {"type": "stores", "id": settings.lemon_store_id}},
            "variant": {"data": {"type": "variants", "id": variante}},
        },
    }}
    try:
        r = httpx.post(
            "https://api.lemonsqueezy.com/v1/checkouts",
            headers={"Authorization": f"Bearer {settings.lemon_api_key}",
                     "Accept": "application/vnd.api+json",
                     "Content-Type": "application/vnd.api+json"},
            json=payload, timeout=15)
    except httpx.HTTPError as e:
        raise HTTPException(502, "No se pudo abrir el pago. Prueba en un momento.") from e
    if r.status_code >= 300:
        logger.error("Lemon checkout respondió %s para %s", r.status_code, body.producto)
        raise HTTPException(502, "No se pudo abrir el pago. Prueba en un momento.")
    try:
        url = r.json()["data"]["attributes"]["url"]
    except (ValueError, KeyError, TypeError) as e:
        logger.error("Lemon checkout sin URL en la respuesta para %s", body.producto)
        raise HTTPException(502, "No se pudo abrir el pago. Prueba en un momento.") from e
    logger.info("Checkout de Lemon abierto: %s", body.producto)
    return CheckoutOut(url=url)


class CambioIn(BaseModel):
    producto: Literal["mensual", "media_temporada", "temporada"]


class CambioOut(BaseModel):
    estado: str


_LIMITE_CAMBIO = acceso.LimiteFrecuencia(tope=10, ventana_s=60 * 10)


@router.post("/liga/pagos/lemon/cambiar-plan", response_model=CambioOut)
def cambiar_plan(body: CambioIn, ident: Identidad = Depends(require_usuario)) -> CambioOut:
    """Pasa la suscripción de Pro a otra duración en Lemon, con el prorrateo de siempre y el cobro
    de la diferencia ahora. El Pro lo confirma el webhook de la suscripción, no esta respuesta."""
    if not _LIMITE_CAMBIO.permitido(ident.uid):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    vigente = pagos.plan_pago_vigente(ident.uid)
    if vigente is None:
        raise HTTPException(409, translate("api_error_no_tienes_suscripcion_que_cambiar"))
    suscripcion, actual = vigente
    if actual == body.producto:
        raise HTTPException(409, translate("api_error_ya_tienes_este_plan"))
    variante = _variante_de(body.producto)
    if not variante or not settings.lemon_api_key:
        raise HTTPException(503, "Los pagos todavía no están activos.")

    try:
        r = httpx.patch(
            f"https://api.lemonsqueezy.com/v1/subscriptions/{suscripcion}",
            headers={"Authorization": f"Bearer {settings.lemon_api_key}",
                     "Accept": "application/vnd.api+json",
                     "Content-Type": "application/vnd.api+json"},
            json={"data": {"type": "subscriptions", "id": suscripcion, "attributes": {
                "variant_id": int(variante), "invoice_immediately": True}}},
            timeout=15)
    except httpx.HTTPError as e:
        raise HTTPException(502, "No se pudo cambiar el plan. Prueba en un momento.") from e
    if r.status_code >= 300:
        logger.error("Lemon cambio de plan respondió %s para %s", r.status_code, body.producto)
        raise HTTPException(502, "No se pudo cambiar el plan. Prueba en un momento.")
    logger.info("Cambio de plan pedido a Lemon: %s", body.producto)
    return CambioOut(estado="pedido")


def _mapa_variantes() -> dict[str, str]:
    """Id de variante de Lemon → producto de la liga, desde la configuración."""
    return {str(k): v for k, v in settings.lemon_variantes.items() if v in PRODUCTOS}


def _variante_de(producto: str) -> str | None:
    for variante, prod in _mapa_variantes().items():
        if prod == producto:
            return variante
    return None
