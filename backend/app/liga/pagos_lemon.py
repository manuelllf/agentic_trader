"""Lo que Lemon Squeezy dice en un webhook, traducido a acciones de la liga. Puro: sin base de datos
ni red, así que se prueba entero. Quien lo llama (la ruta del webhook) guarda la clave de
idempotencia, aplica la acción y responde 200 solo después."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timedelta

PRODUCTOS = ("mensual", "media_temporada", "temporada", "pack_liga")


@dataclass(frozen=True)
class Accion:
    tipo: str                      # "pro", "pase", "baja" o "ignorar"
    usuario_id: str | None = None
    producto: str | None = None
    hasta: datetime | None = None
    lemon_id: str | None = None
    actualizado_en: datetime | None = None


def verificar_firma(cuerpo: bytes, firma: str, secreto: str) -> bool:
    """HMAC-SHA256 hex del cuerpo tal cual llega, comparado en tiempo constante."""
    if not firma or not secreto:
        return False
    esperada = hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperada, firma.strip().lower())


def clave_idempotencia(cuerpo: bytes) -> str:
    """Huella del cuerpo: el mismo evento reenviado produce la misma clave."""
    return hashlib.sha256(cuerpo).hexdigest()


def _fecha(valor: str | None) -> datetime | None:
    if not valor:
        return None
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def interpretar(evento: dict, mapa_variantes: dict[str, str], modo: str) -> Accion:
    """`mapa_variantes` lleva id de variante de Lemon → producto de la liga. `modo` es "test" o
    "live": un evento de otro modo se ignora, para que una prueba nunca dé Pro de verdad."""
    meta = evento.get("meta", {})
    datos = evento.get("data", {})
    attrs = datos.get("attributes", {})
    nombre = meta.get("event_name", "")
    usuario_id = (meta.get("custom_data") or {}).get("user_id")
    en_test = bool(meta.get("test_mode"))
    if (modo == "test") != en_test or not usuario_id:
        return Accion("ignorar")

    primer_item = attrs.get("first_order_item", {})
    variante = str(attrs.get("variant_id") or primer_item.get("variant_id", ""))
    producto = mapa_variantes.get(variante)
    lemon_id = str(datos.get("id", "")) or None
    actualizado = _fecha(attrs.get("updated_at"))
    base = dict(usuario_id=usuario_id, producto=producto, lemon_id=lemon_id,
                actualizado_en=actualizado)

    if nombre in ("subscription_created", "subscription_resumed", "subscription_payment_success",
                  "subscription_updated") and attrs.get("status") in ("active", "on_trial"):
        if producto is None:
            return Accion("ignorar")
        hasta = _fecha(attrs.get("renews_at")) or _fecha(attrs.get("ends_at"))
        if producto == "pack_liga":
            return Accion("pase", hasta=hasta, **base)
        return Accion("pro", hasta=hasta, **base)

    if nombre == "order_created" and producto == "pack_liga":
        comprado = _fecha(attrs.get("created_at"))
        hasta = comprado + timedelta(days=365) if comprado else None
        return Accion("pase", hasta=hasta, **base)

    if nombre in ("subscription_cancelled", "subscription_expired", "subscription_paused",
                  "order_refunded"):
        return Accion("baja", **base)

    return Accion("ignorar", **base)
