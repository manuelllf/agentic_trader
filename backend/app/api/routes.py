"""Agregador de la API: junta los routers por dominio y expone `public_router`/`router` que
importa `main.py`. Cada dominio vive en su propio fichero:

- `routes_capital.py`   — libro sombra: aportar, rendimiento, curva, teaser de portada.
- `routes_scan.py`      — escaneo: lanzar/cancelar, progreso, informe, embudo, recheck/redeep.
- `routes_analytics.py` — analítica columnar (DuckDB) y el explorador de universo.
- `routes_admin.py`     — mantenimiento: fotos, universo global, FX, volcado de BD.
- `routes_lecturas.py`  — scores, propuesta (+ejecutarla), watchlist.
- `routes_alpha.py`     — cuenta IBKR real: resumen, aportar/retirar, aprobaciones.
- `routes_personal.py`  — cartera personal de Manuel (solo lectura, intocable para el agente).
- `routes_push.py`      — web push.

Dos routers, los dos detrás de `require_auth` en `main.py` desde que las salas dejaron de tener
cara pública: `public_router` (lo que antes veía la portada) y `router`. Los endpoints de doble
nivel (`auth_optional`) ya siempre llegan con sesión.
"""

from __future__ import annotations

from fastapi import APIRouter


from . import (
    routes_admin,
    routes_capital,
    routes_analytics,
    routes_personal,
    routes_push,
    routes_scan,
)

public_router = APIRouter()   # lo que veía la portada; también exige sesión (main.py)
router = APIRouter()          # exige require_auth (dependencies=[...] en main.py)
public_router.include_router(routes_capital.public_router)
public_router.include_router(routes_scan.public_router)
router.include_router(routes_capital.router)
router.include_router(routes_scan.router)
router.include_router(routes_analytics.router)
router.include_router(routes_admin.router)
router.include_router(routes_personal.router)
router.include_router(routes_push.router)

@router.get("/fx")
def fx_eurusd() -> dict:
    """Cambio EUR→USD INDICATIVO para la frontera de aportaciones (el libro vive en USD; el FX
    real lo hace IBKR al suyo). yfinance `EURUSD=X`, cacheado 60s en tracking.live_prices."""
    from datetime import UTC, datetime

    from app import tracking

    rate = tracking.live_prices(["EURUSD=X"]).get("EURUSD=X")
    return {"pair": "EURUSD", "rate": rate,
            "asof": datetime.now(UTC).isoformat() if rate else None}
