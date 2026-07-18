"""Punto de entrada de FastAPI.

- Inicializa la DB (crea tablas en dev; en prod se usa Alembic).
- Arranca/para el scheduler en el ciclo de vida de la app.
- Registra CORS para el frontend Next.js.
"""

from __future__ import annotations

import logging
import math
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.routes import public_router, router
from app.auth import (
    auth_enabled,
    clear_login_failures,
    login,
    login_blocked,
    register_login_failure,
    require_auth,
)
from app.config import settings
from app.db import init_db
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)


def _require_password_in_prod() -> None:
    """Fail-closed: en la nube (Railway) sin APP_PASSWORD la auth queda DESACTIVADA y la API
    entera sería pública — incluido /admin/seed, que reemplaza la BD. Mejor no arrancar."""
    if os.getenv("RAILWAY_ENVIRONMENT_NAME") and not settings.app_password:
        logging.getLogger(__name__).critical(
            "APP_PASSWORD vacía en producción: la API quedaría PÚBLICA. "
            "El backend se niega a arrancar (auth fail-closed).")
        raise RuntimeError("APP_PASSWORD obligatoria en producción.")


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
    _require_password_in_prod()  # lo primero: sin candado en la nube, no se arranca
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


# Con contraseña puesta (= prod), la superficie de exploración (docs/redoc/openapi) se apaga:
# el esquema entero de la API no se regala a quien pase por ahí. En dev local (sin APP_PASSWORD)
# /docs sigue disponible.
_HIDE_DOCS = bool(settings.app_password)
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

# Lecturas y teaser de portada (public_router): sin token. Todo lo que muta estado, revela las
# picks del método o expone la Sala Real/personal (router) exige token vía require_auth. /ledger
# y /performance son de doble nivel (auth_optional dentro del propio endpoint). Público además:
# /health, /, /auth/login.
app.include_router(public_router)
app.include_router(router, dependencies=[Depends(require_auth)])


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


class LoginIn(BaseModel):
    password: str


def _client_ip(request: Request) -> str:
    """IP del cliente para el rate-limit: primer salto del X-Forwarded-For (lo pone el edge
    de Railway) o la conexión directa. Falsificable por el cliente — por eso el limitador
    lleva también un tope GLOBAL de respaldo."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


@app.post("/auth/login")
def auth_login(body: LoginIn, request: Request) -> dict:
    """Devuelve un token de sesión si la contraseña es correcta. Solo los FALLOS consumen
    rate-limit; demasiados → 429 con Retry-After (frena la fuerza bruta)."""
    ip = _client_ip(request)
    wait = login_blocked(ip)
    if wait:
        raise HTTPException(429, "Demasiados intentos fallidos. Vuelve a intentarlo en un rato.",
                            headers={"Retry-After": str(wait)})
    token = login(body.password)
    if token is None:
        register_login_failure(ip)
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")
    clear_login_failures(ip)
    return {"token": token, "auth_enabled": auth_enabled()}


@app.get("/auth/check", dependencies=[Depends(require_auth)])
def auth_check() -> dict:
    """Valida el token guardado en el navegador (200 si vale, 401 si no)."""
    return {"ok": True}
