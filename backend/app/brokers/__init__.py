"""Capa de ejecución (broker) — factory.

Regla de seguridad en cascada: solo hay broker REAL si (1) DRY_RUN=false, (2) están las 7
credenciales OAuth y (3) ibind importa. Si cualquiera falla → DryRunBroker (simulación).
Y aun con broker real, NADA se ejecuta sin la aprobación explícita del usuario.
"""

from __future__ import annotations

import logging

from app.brokers.base import Broker, BrokerResult  # noqa: F401 (re-export)
from app.brokers.dry_run import DryRunBroker
from app.config import settings

logger = logging.getLogger(__name__)


def get_broker() -> Broker:
    if settings.dry_run:
        return DryRunBroker()
    from app.brokers import ibkr_web

    if not ibkr_web.credentials_present():
        logger.warning("DRY_RUN=false pero faltan credenciales IBKR → broker simulado.")
        return DryRunBroker()
    try:
        return ibkr_web.IbkrWebBroker()
    except Exception:
        logger.exception("No se pudo inicializar IbkrWebBroker → broker simulado.")
        return DryRunBroker()
