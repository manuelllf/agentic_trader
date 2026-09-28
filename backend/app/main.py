"""Punto de entrada de FastAPI.

- Inicializa la DB (crea tablas en dev; en prod se usa Alembic).
- Arranca/para el scheduler en el ciclo de vida de la app.
- Registra CORS para el frontend Next.js.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import platformdirs
from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import public_router, router
from app.auth import auth_enabled, require_auth
from app.config import settings
from app.db import init_db
from app.liga.filtro_logs import instalar as instalar_filtro_logs
from app.liga.filtro_logs import instalar_en_uvicorn as instalar_filtro_logs_uvicorn
from app.liga.rutas import router as liga_router
from app.liga.rutas_admin import router as liga_admin_router
from app.liga.rutas_gestion import router_moderacion as liga_moderacion_router
from app.momentum.routes import router as momentum_router
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
# Dos fuentes de ruido de terceros confirmadas en producción, sin valor diagnóstico: httpx traza
# CADA llamada a OpenRouter (decenas/cientos por escaneo) y apscheduler traza CADA ejecución de
# `_reconcile_job` (cada 2 min, ajeno a que haya un escaneo largo en marcha o no). Solo estos
# dos loggers de terceros — los propios (`app.*`) se quedan en INFO.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("apscheduler").setLevel(logging.WARNING)
# Red de seguridad (plan §14, F8.7): redacta JWT, claves de Supabase y emails de lo que salga por
# cualquier handler del logger raíz, aunque un `logger.*` se equivocara. Uvicorn no propaga sus
# propios loggers (`propagate=False` de fábrica): el filtro del raíz no los alcanza, hace falta
# instalarlo también ahí (`uvicorn.access` traza método/ruta/query de cada petición).
instalar_filtro_logs()
instalar_filtro_logs_uvicorn()
# yfinance crea su carpeta de caché sin exist_ok: varios hilos a la vez chocan ("File exists")
# y se quedan sin caché de zonas horarias. Creada aquí, antes del primer hilo, no hay carrera.
os.makedirs(os.path.join(platformdirs.user_cache_dir(), "py-yfinance"), exist_ok=True)


def _require_auth_in_prod() -> None:
    """Fail-closed: en la nube (Railway) sin SUPABASE_URL la auth queda DESACTIVADA y la API
    entera sería pública — incluido /admin/seed, que reemplaza la BD. Mejor no arrancar."""
    if os.getenv("RAILWAY_ENVIRONMENT_NAME") and not auth_enabled():
        logging.getLogger(__name__).critical(
            "SUPABASE_URL vacía en producción: la API quedaría PÚBLICA. "
            "El backend se niega a arrancar (auth fail-closed).")
        raise RuntimeError("SUPABASE_URL obligatoria en producción.")


def _verify_db_writable() -> None:
    """Fail-closed del volumen: /health no toca la BD, así que un fallo de permisos en /data
    (p.ej. con el proceso ya sin privilegios) pasaría el healthcheck y rompería solo al primer
    apunte. Al bootear se hace una escritura REAL e inocua — re-escribir user_version con su
    propio valor (verificado: en solo-lectura revienta; el journal se crea en el directorio,
    así que prueba fichero Y volumen). Si falla, el arranque cae → el deploy no pasa el
    healthcheck y Railway conserva la versión anterior."""
    if not settings.database_url.startswith("sqlite"):
        return
    from sqlalchemy import text

    from app.db import SessionLocal

    db = SessionLocal()
    try:
        v = int(db.execute(text("PRAGMA user_version")).scalar() or 0)
        db.execute(text(f"PRAGMA user_version = {v}"))     # escritura real, valor intacto
        db.commit()
    finally:
        db.close()
    uid = os.getuid() if hasattr(os, "getuid") else "?"    # en Windows no hay getuid
    logging.getLogger(__name__).info("BD y volumen escribibles al arrancar (uid=%s).", uid)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _require_auth_in_prod()    # lo primero: sin candado en la nube, no se arranca
    _materialize_ibkr_pems()   # antes que nada: el reconcile de abajo ya puede tocar el broker
    init_db()
    _verify_db_writable()      # sin escritura en /data no se arranca (ver docstring)
    _reconcile_on_startup()
    _backfill_curve_on_startup()
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


def _materialize_ibkr_pems() -> None:
    """En la nube, las claves PEM de IBKR llegan por env en base64 → volcarlas a fichero."""
    from app.brokers.ibkr_web import materialize_pems

    try:
        materialize_pems()
    except Exception:
        logging.getLogger(__name__).exception("Bootstrap de claves IBKR falló (broker simulado).")


def _backfill_curve_on_startup() -> None:
    """Rellena la curva histórica nada más arrancar, en un hilo aparte: yfinance tarda unos
    segundos y no debe retrasar el healthcheck. Cubre el hueco entre el deploy y el primer
    job de las 16:30 ET (y cualquier día que el backend pasara apagado)."""
    import threading

    def run() -> None:
        from app import history
        from app.db import SessionLocal

        db = SessionLocal()
        try:
            n = history.record_snapshots(db)
            if n:
                logging.getLogger(__name__).info(
                    "Curva histórica al arrancar: %s cierre(s) apuntado(s).", n)
        except Exception:
            logging.getLogger(__name__).exception("Backfill de la curva falló (se reintentará)")
        finally:
            db.close()

    threading.Thread(target=run, daemon=True, name="curve-backfill").start()


def _reconcile_on_startup() -> None:
    """Cuadra el libro real nada más despertar: si una orden límite llenó en IBKR mientras el
    backend estaba apagado, se registra su fill ya (no espera a que alguien abra la web).
    No-op sin órdenes working (solo una query local)."""
    from app import approvals as approvals_mod
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        n = approvals_mod.reconcile_working(db)
        if n:
            logging.getLogger(__name__).info("Reconcile al arrancar: %s orden(es) cuadrada(s).", n)
    except Exception:
        logging.getLogger(__name__).exception("Reconcile al arrancar falló (se reintentará)")
    finally:
        db.close()


# Con auth (= prod), la superficie de exploración (docs/redoc/openapi) se apaga: el esquema entero
# de la API no se regala a quien pase por ahí. En dev local (sin SUPABASE_URL) /docs sigue.
_HIDE_DOCS = auth_enabled()
app = FastAPI(
    title="Agentic Trader API", version="0.1.0", lifespan=lifespan,
    docs_url=None if _HIDE_DOCS else "/docs",
    redoc_url=None if _HIDE_DOCS else "/redoc",
    openapi_url=None if _HIDE_DOCS else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

_LENTA_S = 1.0


@app.middleware("http")
async def _log_peticiones_lentas(request: Request, call_next):  # noqa: ANN001, ANN202
    """Solo las que pasan de 1 s: sin métricas en Railway, es la única forma de ver cuál frena."""
    t0 = time.monotonic()
    respuesta = await call_next(request)
    dur = time.monotonic() - t0
    if dur >= _LENTA_S:
        logging.getLogger(__name__).warning("Petición lenta: %s %s %.1fs (%s)", request.method,
                                            request.url.path, dur, respuesta.status_code)
    return respuesta


def _sin_flotantes_no_finitos(x):  # noqa: ANN001, ANN202 — estructura arbitraria del detalle
    if isinstance(x, float) and not math.isfinite(x):
        return repr(x)
    if isinstance(x, dict):
        return {k: _sin_flotantes_no_finitos(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_sin_flotantes_no_finitos(v) for v in x]
    return x


@app.exception_handler(RequestValidationError)
async def _validation_422(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 estándar pero serializable SIEMPRE: un `amount=1e999` llega como Infinity, pydantic
    lo rechaza bien… y el eco del input en el detalle rompería json.dumps (500). Se sanea."""
    detail = _sin_flotantes_no_finitos(jsonable_encoder({"detail": exc.errors()}))
    return JSONResponse(status_code=422, content=detail)

# Las salas ya no tienen cara pública (la portada vieja y Beta pública se retiraron): todo lo
# suyo exige la sesión de admin con 2FA. Público solo /health y /.
app.include_router(public_router, dependencies=[Depends(require_auth)])
app.include_router(router, dependencies=[Depends(require_auth)])
# Omega (momentum), 2ª estrategia independiente del ranker -- mismo candado, tablas
# propias (momentum_*), sin ORM (ver app/momentum/routes.py).
app.include_router(momentum_router, dependencies=[Depends(require_auth)])
# La liga trae sus propias puertas por ruta (identidad de Supabase y RLS).
app.include_router(liga_router)
app.include_router(liga_admin_router)
app.include_router(liga_moderacion_router)


# ---- Público (sin token) ----------------------------------------------------

@app.get("/")
def root() -> dict[str, str]:
    out = {"name": "Agentic Trader API"}
    if not _HIDE_DOCS:
        out["docs"] = "/docs"
    return out


@app.get("/health")
def health() -> dict[str, str]:
    """Público: lo usa el healthcheck de Railway (nunca detrás del login)."""
    return {"status": "ok"}


@app.get("/auth/check", dependencies=[Depends(require_auth)])
def auth_check() -> dict:
    """¿Esta sesión abre las salas? 200 sí; 401 sin sesión, 403 sin 2FA, 404 si no es admin."""
    return {"ok": True}
