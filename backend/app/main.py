"""Punto de entrada de FastAPI.

- Inicializa la DB (crea tablas en dev; en prod se usa Alembic).
- Arranca/para el scheduler en el ciclo de vida de la app.
- Registra CORS para el frontend Next.js.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.routes import router
from app.auth import auth_enabled, login, require_auth
from app.config import settings
from app.db import init_db
from app.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    _reconcile_on_startup()
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


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


app = FastAPI(title="Agentic Trader API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

# TODA la API de negocio exige token (require_auth). Público solo: /health, /, /auth/login.
app.include_router(router, dependencies=[Depends(require_auth)])


# ---- Público (sin token) ----------------------------------------------------

@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Agentic Trader API", "docs": "/docs"}


@app.get("/health")
def health() -> dict[str, str]:
    """Público: lo usa el healthcheck de Railway (nunca detrás del login)."""
    return {"status": "ok"}


class LoginIn(BaseModel):
    password: str


@app.post("/auth/login")
def auth_login(body: LoginIn) -> dict:
    """Devuelve un token de sesión si la contraseña es correcta."""
    token = login(body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")
    return {"token": token, "auth_enabled": auth_enabled()}


@app.get("/auth/check", dependencies=[Depends(require_auth)])
def auth_check() -> dict:
    """Valida el token guardado en el navegador (200 si vale, 401 si no)."""
    return {"ok": True}
