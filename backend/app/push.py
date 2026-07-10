"""Web Push (VAPID + pywebpush) — alertas gratis, sin Firebase ni terceros.

Flujo: el navegador se suscribe (service worker) → guardamos la suscripción → cuando el
escaneo genera operaciones pendientes de aprobar, se empuja una notificación a todos los
dispositivos. Tocar la notificación abre la Sala Real (/real).

Best-effort deliberado: si el push falla, la app sigue — las aprobaciones viven en la web
y el push es solo el timbre.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PushSubscription

logger = logging.getLogger(__name__)


def vapid_public_key() -> str:
    return settings.vapid_public_key


def subscribe(db: Session, sub: dict) -> None:
    """Alta (idempotente) de una suscripción del navegador."""
    endpoint = sub.get("endpoint", "")
    keys = sub.get("keys", {})
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("Suscripción push incompleta (endpoint/p256dh/auth).")
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if row is None:
        db.add(PushSubscription(endpoint=endpoint, p256dh=keys["p256dh"], auth=keys["auth"]))
    else:
        row.p256dh, row.auth = keys["p256dh"], keys["auth"]
    db.commit()


def unsubscribe(db: Session, endpoint: str) -> None:
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if row is not None:
        db.delete(row)
        db.commit()


def send_to_all(db: Session, title: str, body: str, url: str = "/real") -> int:
    """Empuja a todos los dispositivos suscritos. Poda suscripciones muertas (404/410)."""
    if not settings.vapid_private_key:
        logger.info("Push omitido: faltan claves VAPID.")
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush no instalado — push omitido.")
        return 0

    subs = db.scalars(select(PushSubscription)).all()
    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    for s in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": s.endpoint,
                    "keys": {"p256dh": s.p256dh, "auth": s.auth},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
            )
            sent += 1
        except WebPushException as exc:
            code = getattr(exc.response, "status_code", None)
            if code in (404, 410):  # el navegador dio de baja la suscripción
                db.delete(s)
            else:
                logger.warning("Push fallido (%s): %s", code, exc)
        except Exception:
            logger.exception("Push fallido")
    db.commit()
    return sent
