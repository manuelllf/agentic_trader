"""Web Push (VAPID + pywebpush) — alertas gratis, sin Firebase ni terceros.

Flujo: el navegador se suscribe (service worker) → guardamos la suscripción → cuando el
escaneo genera operaciones pendientes de aprobar, se empuja una notificación a todos los
dispositivos. Tocar la notificación abre Alpha (/alpha).

Best-effort deliberado: si el push falla, la app sigue — las aprobaciones viven en la web
y el push es solo el timbre.
"""

from __future__ import annotations

import hashlib
import json
import logging
from urllib.parse import urlparse

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PushSubscription

logger = logging.getLogger(__name__)

# Anti-SSRF: el endpoint lo genera el NAVEGADOR al suscribirse y siempre apunta al servicio
# push de su fabricante. Cualquier otro host haría que nuestro servidor POSTee donde diga el
# cliente (metadata interna, servicios de Railway...). Allowlist de los 4 servicios reales.
_PUSH_HOSTS_EXACT = {"fcm.googleapis.com"}                # Chrome/Edge/Android (FCM)
_PUSH_HOST_SUFFIXES = (
    ".push.apple.com",                                    # Safari/iOS
    ".notify.windows.com",                                # Edge/Windows (WNS)
    ".push.services.mozilla.com",                         # Firefox (autopush)
)


def _valid_push_endpoint(endpoint: str) -> bool:
    try:
        u = urlparse(endpoint)
    except ValueError:
        return False
    if u.scheme != "https" or not u.hostname:
        return False
    host = u.hostname.lower()
    return host in _PUSH_HOSTS_EXACT or host.endswith(_PUSH_HOST_SUFFIXES)


def vapid_public_key() -> str:
    return settings.vapid_public_key


def subscribe(db: Session, sub: dict) -> None:
    """Alta (idempotente) de una suscripción del navegador."""
    endpoint = sub.get("endpoint", "")
    keys = sub.get("keys", {})
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("Suscripción push incompleta (endpoint/p256dh/auth).")
    if not _valid_push_endpoint(endpoint):
        raise ValueError("Endpoint de push no reconocido (solo servicios oficiales de navegador).")
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


def enviar(endpoint: str, p256dh: str, auth: str, payload: str) -> str:
    """Un push a un dispositivo. Devuelve «ok», «baja» (el navegador dio de baja la suscripción:
    404 o 410) o «error» (sin claves, sin librería, destino no reconocido o fallo del envío)."""
    if not settings.vapid_private_key:
        logger.info("Push omitido: faltan claves VAPID.")
        return "error"
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush no instalado — push omitido.")
        return "error"
    if not _valid_push_endpoint(endpoint):     # defensa extra: jamás POSTear fuera
        logger.warning("Push omitido: endpoint no reconocido (%s).", hash_endpoint(endpoint))
        return "error"
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return "ok"
    except WebPushException as exc:
        code = getattr(exc.response, "status_code", None)
        if code in (404, 410):
            return "baja"
        logger.warning("Push fallido: codigo=%s dispositivo=%s", code, hash_endpoint(endpoint))
    except Exception:
        logger.warning("Push fallido: codigo=excepcion dispositivo=%s", hash_endpoint(endpoint))
    return "error"


def hash_endpoint(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()[:12]


def enviar_a_todos(
    db: Session, title: str, body: str, url: str = "/admin/alpha", tag: str = "agentic-alpha",
) -> dict:
    resumen = {"total": 0, "ok": 0, "baja": 0, "error": 0}
    if not settings.vapid_private_key:
        logger.warning("Push omitido: faltan claves VAPID.")
        return resumen
    resumen["endpoints"] = set()
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    for s in db.scalars(select(PushSubscription)).all():
        codigo = hash_endpoint(s.endpoint)
        resumen["endpoints"].add(codigo)
        resultado = enviar(s.endpoint, s.p256dh, s.auth, payload)
        resumen["total"] += 1
        resumen[resultado] += 1
        if resultado == "baja":
            db.delete(s)
        elif resultado == "error":
            logger.warning("Push fallido: codigo=error dispositivo=%s", codigo)
    return resumen


def send_to_all(
    db: Session, title: str, body: str, url: str = "/admin/alpha", tag: str = "agentic-alpha",
) -> int:
    resumen = enviar_a_todos(db, title, body, url, tag)
    db.commit()
    return resumen["ok"]


def enviar_a_admins_liga(
    db: Session, title: str, body: str, url: str, tag: str, ya_enviados: set[str],
) -> dict:
    resumen = {"total": 0, "ok": 0, "baja": 0, "error": 0}
    if not settings.vapid_private_key:
        logger.warning("Push de liga omitido: faltan claves VAPID.")
        return resumen
    subs = db.execute(text("""
        select s.id, s.endpoint, s.p256dh, s.auth from liga.suscripciones_push s
        where exists (select 1 from liga.roles_usuario r
                      where r.usuario_id = s.usuario_id and r.rol = 'admin')
    """)).all()
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    for s in subs:
        codigo = hash_endpoint(s.endpoint)
        if codigo in ya_enviados:
            continue
        ya_enviados.add(codigo)
        resultado = enviar(s.endpoint, s.p256dh, s.auth, payload)
        resumen["total"] += 1
        resumen[resultado] += 1
        if resultado == "baja":
            db.execute(text("delete from liga.suscripciones_push where id = :i"), {"i": s.id})
        elif resultado == "error":
            logger.warning("Push de liga fallido: codigo=error dispositivo=%s", codigo)
    return resumen
