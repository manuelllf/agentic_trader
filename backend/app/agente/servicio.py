"""Servicio del agente: planificador de las tareas, recuperación al arrancar y /salud.
Arranque previsto: `uvicorn app.agente.servicio:app`."""

from __future__ import annotations

import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.agente import api, base, interruptor, reloj
from app.agente.config import AgenteSettings, ajustes
from app.agente.models import Ejecucion, Estado
from app.agente.reloj import Tarea
from app.agente.tareas import correr, liberar_huerfanas
from app.mercado.calendario import TZ_NUEVA_YORK, es_dia_de_bolsa

logger = logging.getLogger(__name__)

DIAS_RECUPERACION = 12
ULTIMAS_EN_SALUD = 8


def _trabajo(tarea: Tarea) -> None:
    ahora = datetime.now(TZ_NUEVA_YORK)
    hoy = ahora.date()
    if not es_dia_de_bolsa(hoy):
        return
    try:
        correr(tarea, hoy, ahora)
    except Exception:
        logger.exception("Fallo inesperado en la tarea %s", tarea.value)


def crear_planificador(ajustes: AgenteSettings = ajustes) -> BackgroundScheduler:
    """Un trabajo por tarea, de lunes a viernes en hora de Nueva York."""
    planificador = BackgroundScheduler(timezone=TZ_NUEVA_YORK)
    for tarea in Tarea:
        hora = reloj.hora_de(tarea, ajustes)
        planificador.add_job(
            _trabajo,
            CronTrigger(day_of_week="mon-fri", hour=hora.hour, minute=hora.minute,
                        timezone=TZ_NUEVA_YORK),
            args=[tarea], id=f"agente_{tarea.value}", max_instances=1, coalesce=True,
            misfire_grace_time=600)
    return planificador


def recuperar_perdidas(ahora: datetime) -> None:
    """Corre en orden las tareas que debieron hacerse mientras el servicio estaba parado."""
    desde = ahora.astimezone(TZ_NUEVA_YORK).date() - timedelta(days=DIAS_RECUPERACION)
    with base.con_actor("agente"), base.sesion() as s:
        liberadas = liberar_huerfanas(s)
        if liberadas:
            logger.warning("%s tareas quedaron en curso tras una caída; se reintentan", liberadas)
        filas = s.execute(select(Ejecucion.tarea, Ejecucion.fecha_ny).where(
            Ejecucion.estado == "hecha", Ejecucion.fecha_ny >= desde)).all()
    hechas = {reloj.clave(Tarea(t), f) for t, f in filas}
    for tarea, fecha in reloj.pendientes_al_arrancar(ahora, hechas):
        correr(tarea, fecha, ahora)


def _recuperar_en_hilo() -> None:
    try:
        recuperar_perdidas(datetime.now(UTC))
    except Exception:
        logger.exception("No se pudieron recuperar las tareas perdidas")


@asynccontextmanager
async def _vida(_: FastAPI) -> AsyncIterator[None]:
    planificador = crear_planificador()
    planificador.start()
    # En un hilo aparte para que el arranque del servicio no espere a las descargas.
    threading.Thread(target=_recuperar_en_hilo, name="agente-recuperar", daemon=True).start()
    try:
        yield
    finally:
        planificador.shutdown(wait=False)


app = FastAPI(lifespan=_vida)
app.add_middleware(
    CORSMiddleware, allow_origins=[o.strip() for o in ajustes.origenes.split(",") if o.strip()],
    allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])
app.include_router(api.router)


@app.get("/salud")
def salud() -> JSONResponse:
    try:
        with base.sesion() as s:
            parada = bool(s.execute(select(Estado.parada).where(Estado.id == 1)).scalar())
            filas = s.execute(
                select(Ejecucion.tarea, Ejecucion.fecha_ny, Ejecucion.estado)
                .order_by(Ejecucion.id.desc()).limit(ULTIMAS_EN_SALUD)).all()
    except Exception:
        logger.exception("La base del agente no responde")
        return JSONResponse({"ok": False}, status_code=503)
    ultimas = [{"tarea": t, "fecha_ny": f.isoformat(), "estado": e} for t, f, e in filas]
    return JSONResponse({"ok": True, "parada": parada, "ia": interruptor.deepseek.estado.value,
                         "ultimas": ultimas})
