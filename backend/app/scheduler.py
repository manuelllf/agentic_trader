"""Scheduler de escaneo (cron mensual, anclado a la hora del mercado US).

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
from app.scan_service import run_scan_and_store, write_scan_failure

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="UTC")


def _scan_job() -> None:
    """Único escaneo programado: mensual, universo entero, decide. El semanal (muestra
    rotatoria, sin capa media, sin decisión) se retiró — no aportaba conocimiento nuevo: el
    mercado no cambia lo bastante en una semana para justificar 750 llamadas de pago sin capa
    media y sin tocar cartera (ver docs/plan-datos-observability.md)."""
    db = SessionLocal()
    try:
        result = run_scan_and_store(db, sample_size=None, decide=True)
        logger.info("Escaneo completado: %s", result)
    except Exception as exc:
        logger.exception("Fallo en el job de escaneo")
        try:
            write_scan_failure(db, exc)   # sin esto, un cron caído es invisible en la web
        except Exception:
            logger.exception("Tampoco se pudo persistir el informe del fallo.")
    finally:
        db.close()


def _snapshot_job() -> None:
    """Cierre diario: la curva histórica (equity por libro + SPY) y la FOTO DEL UNIVERSO.

    Corre tras el cierre US (16:00 ET) con margen para el retraso de ~15 min de yfinance.
    Si un día no corrió (deploy, caída), el siguiente rellena los huecos solo.

    La foto del universo va aquí y no en el escaneo porque el volumen que publica NASDAQ es el
    de la sesión EN CURSO: pedido a las 10:15 ET deja fuera casi todo el mercado. Con la bolsa
    cerrada, el dato del día está completo y cualquier escaneo posterior parte del mercado entero.
    """
    from app import history

    db = SessionLocal()
    try:
        n = history.record_snapshots(db)
        if n:
            logger.info("Curva histórica: %s cierre(s) apuntado(s).", n)
    except Exception:
        logger.exception("Fallo en el job de snapshot de la curva")
    finally:
        db.close()


def _universe_job() -> None:
    """Fotografía el universo tras el cierre US, y REINTENTA cada 2h esa misma noche.

    Va aparte de la curva porque depende de una fuente ajena y frágil: NASDAQ responde 200 con
    el cuerpo vacío cuando le da la gana. Si a las 16:30 ET no hay suerte, a las 18:30, 20:30 y
    22:30 se vuelve a intentar; en cuanto una funciona, las siguientes no hacen nada. Sin foto
    del día, el escaneo de la mañana siguiente vería el mercado a medio negociar."""
    from app.screener import universe as universe_mod

    db = SessionLocal()
    try:
        hoy = datetime.now(ZoneInfo(settings.scan_timezone)).date()
        if universe_mod.snapshot_date(db) == hoy:
            return                                  # ya hay foto de esta sesión: nada que hacer
        total = universe_mod.refresh_snapshot(db)
        logger.info("Foto del universo actualizada: %s nombres elegibles.", total)
    except Exception:
        logger.exception("No se pudo fotografiar el universo (se reintenta en 2h)")
    finally:
        db.close()


def _universo_global_job() -> None:
    """Sincroniza el universo global de HuggingFace, mensual. El catálogo de tickers no se
    mueve rápido; esto solo ensancha lo que se puede FOTOGRAFIAR, el escaneo sigue en NASDAQ."""
    from app.screener import universe_global

    db = SessionLocal()
    try:
        info = universe_global.sincronizar(db)
        logger.info("Universo global sincronizado: %s tickers.", info["tickers"])
    except Exception:
        logger.exception("No se pudo sincronizar el universo global")
    finally:
        db.close()


def _analytics_sync_job() -> None:
    """Reconstruye el fichero DuckDB persistente de `/analytics/*` desde Postgres. Fuera de
    horas de mercado, a propósito no atado a ningún escaneo — la analítica acepta estar hasta
    24h desatualizada (ver `app/analytics_sync.py`), así que basta con una pasada diaria."""
    from app import analytics_sync

    try:
        counts = analytics_sync.sync()
        logger.info("Analítica DuckDB sincronizada: %s", counts)
    except Exception:
        logger.exception("No se pudo sincronizar la analítica DuckDB")


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
    # Día 1 del mes: puede caer en fin de semana, y no pasa nada — `universe_for_scan` usa la
    # foto del último cierre (el job diario la mantiene fresca), no depende de que el mercado
    # esté abierto ese día exacto.
    trigger = CronTrigger(
        day=1,
        hour=settings.scan_cron_hour,
        minute=settings.scan_cron_minute,
        timezone=settings.scan_timezone,
    )
    # Gracia de misfire: con el default (~1 s), un proceso ocupado/reiniciándose justo a la hora
    # del cron SALTARÍA el escaneo en silencio hasta el mes siguiente (snapshot y reconcile
    # se auto-curan huecos; el escaneo no). Un día de margen lo cubre; coalesce=True evita
    # ejecutarlo dos veces si se acumularan varios misfires.
    scheduler.add_job(_scan_job, trigger=trigger, id="monthly_scan", replace_existing=True,
                      misfire_grace_time=86400, coalesce=True)
    # Cierre diario de la curva histórica: lun-vie 16:30 ET (cierre + retraso de yfinance).
    scheduler.add_job(
        _snapshot_job,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=30, timezone=settings.scan_timezone),
        id="equity_snapshot", replace_existing=True,
    )
    # Foto del universo: 16:30 ET (recién cerrado) y reintentos hasta las 22:30 si NASDAQ falla.
    scheduler.add_job(
        _universe_job,
        CronTrigger(day_of_week="mon-fri", hour="16,18,20,22", minute=30,
                    timezone=settings.scan_timezone),
        id="universe_snapshot", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    # Universo global (HuggingFace): día 1 de cada mes, de madrugada y fuera de horas de mercado.
    scheduler.add_job(
        _universo_global_job,
        CronTrigger(day=1, hour=3, minute=0, timezone=settings.scan_timezone),
        id="universo_global", replace_existing=True, misfire_grace_time=86400, coalesce=True,
    )
    # Reconciliación de órdenes working cada 2 min (no-op sin órdenes vivas; ver _reconcile_job).
    scheduler.add_job(_reconcile_job, "interval", minutes=2, id="reconcile_working",
                      replace_existing=True)
    # Fichero DuckDB de /analytics/*: 6:00 hora española (no la del mercado US, esta la mira
    # Manuel, no el escaneo) — una vez al día basta (ver _analytics_sync_job).
    # POST /admin/sync-analytics existe para no esperar a esta hora.
    scheduler.add_job(
        _analytics_sync_job,
        CronTrigger(hour=6, minute=0, timezone="Europe/Madrid"),
        id="analytics_sync", replace_existing=True, misfire_grace_time=3600, coalesce=True,
    )
    scheduler.start()
    logger.info(
        "Scheduler arrancado: escaneo mensual día 1 %02d:%02d %s",
        settings.scan_cron_hour, settings.scan_cron_minute, settings.scan_timezone,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
