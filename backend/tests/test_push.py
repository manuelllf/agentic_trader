"""Tests del canal push: validación anti-SSRF del endpoint de suscripción.

El endpoint lo genera el navegador y apunta SIEMPRE al servicio push de su fabricante; el
servidor luego le hace POST. Sin allowlist, un autenticado podría apuntar ese POST a metadata
interna o servicios de la red de Railway.
"""

from __future__ import annotations

import sys
import types

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import (
    models,  # noqa: F401  (registra las tablas)
    push,
)
from app.db import Base
from app.models import PushSubscription


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


KEYS = {"p256dh": "clave-p", "auth": "clave-a"}

NAVEGADORES_REALES = [
    "https://fcm.googleapis.com/fcm/send/abc123",              # Chrome/Edge/Android
    "https://web.push.apple.com/QOYWcabc",                     # Safari/iOS
    "https://db5p.notify.windows.com/w/?token=abc",            # Edge/Windows
    "https://updates.push.services.mozilla.com/wpush/v2/abc",  # Firefox
]

NO_RECONOCIDOS = [
    "http://fcm.googleapis.com/fcm/send/abc",       # sin TLS
    "https://169.254.169.254/latest/meta-data",     # metadata interna (el clásico del SSRF)
    "https://localhost:8000/admin/seed",            # nuestra propia API
    "https://evil.com/fcm.googleapis.com",          # host malo, path disfrazado
    "https://fcm.googleapis.com.evil.com/x",        # sufijo falso
    "https://evilfcm.googleapis.com/x",             # prefijo pegado al host exacto
    "no-es-una-url",
]


@pytest.mark.parametrize("endpoint", NAVEGADORES_REALES)
def test_endpoints_de_navegador_entran(db, endpoint) -> None:
    push.subscribe(db, {"endpoint": endpoint, "keys": KEYS})
    assert db.scalar(select(PushSubscription)) is not None


@pytest.mark.parametrize("endpoint", NO_RECONOCIDOS)
def test_endpoints_no_reconocidos_se_rechazan(db, endpoint) -> None:
    with pytest.raises(ValueError):
        push.subscribe(db, {"endpoint": endpoint, "keys": KEYS})
    assert db.scalar(select(PushSubscription)) is None      # nada guardado


def test_send_to_all_jamas_postea_fuera_de_la_allowlist(db, monkeypatch) -> None:
    """Defensa en profundidad: si una fila rara ya está EN la BD (p.ej. de un seed antiguo),
    el envío la salta — el POST del servidor nunca sale hacia un host no reconocido."""
    db.add(PushSubscription(endpoint="https://169.254.169.254/latest", p256dh="p", auth="a"))
    db.add(PushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/ok",
                            p256dh="p", auth="a"))
    db.commit()
    monkeypatch.setattr(push.settings, "vapid_private_key", "clave-vapid")

    llamados: list[str] = []
    falso = types.ModuleType("pywebpush")
    falso.WebPushException = type("WebPushException", (Exception,), {})
    falso.webpush = lambda subscription_info, **kw: llamados.append(subscription_info["endpoint"])
    monkeypatch.setitem(sys.modules, "pywebpush", falso)

    assert push.send_to_all(db, "titulo", "cuerpo") == 1
    assert llamados == ["https://fcm.googleapis.com/fcm/send/ok"]
