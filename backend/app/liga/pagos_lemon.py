"""Lo que Lemon Squeezy dice en un webhook, traducido a acciones de la liga. Puro: sin base de datos
ni red, así que se prueba entero. Quien lo llama (la ruta del webhook) guarda la clave de
idempotencia, aplica la acción y responde 200 solo después."""

from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

PRODUCTOS = ("mensual", "media_temporada", "temporada", "pack_liga")

# Eventos que dan o mantienen el derecho según el estado de la suscripción. Los eventos de cobro
# (`subscription_payment_*`) llevan una factura, no la suscripción: no dan derecho por sí solos.
_ALTA = ("subscription_created", "subscription_resumed", "subscription_unpaused",
         "subscription_updated", "subscription_plan_changed")
# Eventos que quitan el derecho. Una cancelación conserva el acceso hasta `ends_at`.
_BAJA = ("subscription_cancelled", "subscription_expired", "subscription_paused",
         "subscription_payment_refunded", "order_refunded")
_ALTA_PAGO_UNICO = ("order_created",)


@dataclass(frozen=True)
class Accion:
    tipo: str                      # "pro", "pase", "baja" o "ignorar"
    usuario_id: str | None = None
    producto: str | None = None
    hasta: datetime | None = None  # alta: hasta cuándo; baja: fin del acceso (None = ya)
    lemon_id: str | None = None    # la compra: suscripción o pedido
    actualizado_en: datetime | None = None
    motivo: str = ""               # por qué se ignora, para el log


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
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        return None


def _ignorar(motivo: str, **datos) -> Accion:  # noqa: ANN003
    return Accion("ignorar", motivo=motivo, **datos)


def interpretar(evento: dict, mapa_variantes: dict[str, str], modo: str) -> Accion:
    """`mapa_variantes` lleva id de variante de Lemon → producto de la liga. `modo` es "test" o
    "live": un evento de otro modo se ignora, para que una prueba nunca dé Pro de verdad."""
    meta = evento.get("meta") or {}
    datos = evento.get("data") or {}
    attrs = datos.get("attributes") or {}
    nombre = meta.get("event_name", "")
    usuario_id = (meta.get("custom_data") or {}).get("user_id")
    en_test = bool(meta.get("test_mode"))

    if modo not in ("test", "live"):
        return _ignorar("modo_desconocido")
    if (modo == "test") != en_test:
        return _ignorar("modo_distinto")
    try:
        usuario_id = str(uuid.UUID(str(usuario_id)))
    except (ValueError, TypeError, AttributeError):
        return _ignorar("sin_usuario_valido")

    if nombre.startswith("subscription_payment_"):
        # El evento trae la factura: la compra es su suscripción.
        compra = str(attrs.get("subscription_id") or "") or None
    else:
        compra = str(datos.get("id") or "") or None
    if compra is None:
        return _ignorar("sin_compra", usuario_id=usuario_id)

    primer_item = attrs.get("first_order_item") or {}
    variante = str(attrs.get("variant_id") or primer_item.get("variant_id") or "")
    producto = mapa_variantes.get(variante)
    actualizado = _fecha(attrs.get("updated_at"))
    base = dict(usuario_id=usuario_id, producto=producto, lemon_id=compra,
                actualizado_en=actualizado)

    if nombre in _ALTA:
        if attrs.get("status") not in ("active", "on_trial"):
            return _ignorar("estado_no_activo", **base)
        if producto is None:
            return _ignorar("variante_desconocida", **base)
        hasta = _fecha(attrs.get("renews_at")) or _fecha(attrs.get("ends_at"))
        if hasta is None:
            return _ignorar("sin_fecha_de_fin", **base)
        tipo = "pase" if producto == "pack_liga" else "pro"
        return Accion(tipo, hasta=hasta, **base)

    if nombre in _ALTA_PAGO_UNICO and producto == "pack_liga":
        comprado = _fecha(attrs.get("created_at"))
        if comprado is None:
            return _ignorar("sin_fecha_de_compra", **base)
        return Accion("pase", hasta=comprado + timedelta(days=365), **base)

    if nombre in _BAJA:
        if nombre == "subscription_cancelled":
            # Pagó hasta el final del periodo: el acceso dura hasta `ends_at`.
            fin = _fecha(attrs.get("ends_at"))
            return Accion("baja", hasta=fin, **base)
        return Accion("baja", **base)

    return _ignorar("evento_sin_efecto", **base)
