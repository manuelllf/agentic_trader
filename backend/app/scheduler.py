"""Scheduler de escaneo (cron semanal, anclado a la hora del mercado US).

APScheduler `BackgroundScheduler` (síncrono), coherente con el resto del backend.
Se arranca/para desde el lifespan de FastAPI (ver `main.py`). Solo tickea mientras el proceso
del backend esté VIVO → en producción requiere un servidor always-on (Railway), no serverless.
Se puede desactivar con ENABLE_SCHEDULER=false (tests, o escaneos solo bajo demanda vía API).
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.db import SessionLocal
from app.scan_service import run_scan_and_store

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="UTC")


def real_proposals_due(now: datetime | None = None) -> bool:
    """¿Le toca proponer a la sala REAL en este escaneo programado?

    Cadencia doble: la sombra se recalibra cada semana, la real solo en el PRIMER escaneo
    programado del mes — la primera aparición de un día de semana cae siempre en día 1-7.
    Con `real_proposals_monthly=False`, todos los escaneos proponen (cadencia única).
    """
    if not settings.real_proposals_monthly:
        return True
    now = now or datetime.now(ZoneInfo(settings.scan_timezone))
    return now.day <= 7


def _scan_job() -> None:
    db = SessionLocal()
    try:
        result = run_scan_and_store(db, real_proposals=real_proposals_due())
        logger.info("Escaneo completado: %s", result)
    except Exception:
        logger.exception("Fallo en el job de escaneo")
    finally:
        db.close()


def _reconcile_job() -> None:
    """Reconcilia fills de órdenes límite 'working' SIN depender de que la web esté abierta.

    Clave en producción: si una orden llena a los 15 min y nadie tiene la Sala Real abierta,
    este job cuadra el libro igualmente. Barato: si no hay órdenes working, es solo una query
    a la BD (ni toca IBKR)."""
    from app import approvals as approvals_mod

    db = SessionLocal()
    try:
        n = approvals_mod.reconcile_working(db)
        if n:
            logger.info("Reconcile: %s orden(es) actualizada(s) con su fill real.", n)
    except Exception:
        logger.exception("Fallo en el job de reconciliación")
    finally:
        db.close()


def start_scheduler() -> None:
    if not settings.enable_scheduler:
        logger.info("Scheduler desactivado (ENABLE_SCHEDULER=false)")
        return
    trigger = CronTrigger(
        day_of_week=settings.scan_cron_day,
        hour=settings.scan_cron_hour,
        minute=settings.scan_cron_minute,
        timezone=settings.scan_timezone,
    )
    scheduler.add_job(_scan_job, trigger=trigger, id="weekly_scan", replace_existing=True)
    # Reconciliación de órdenes working cada 2 min (no-op sin órdenes vivas; ver _reconcile_job).
    scheduler.add_job(_reconcile_job, "interval", minutes=2, id="reconcile_working",
                      replace_existing=True)
    scheduler.start()
    logger.info(
        "Scheduler arrancado: %s %02d:%02d %s",
        settings.scan_cron_day, settings.scan_cron_hour,
        settings.scan_cron_minute, settings.scan_timezone,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
