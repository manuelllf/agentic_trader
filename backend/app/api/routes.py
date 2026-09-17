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

Dos routers: `public_router` (sin token, lecturas y teaser de portada) y `router` (exige
`require_auth`, enganchado en `main.py`). Cinco endpoints son de DOBLE NIVEL vía
`auth_optional` (nunca dan 401: sin sesión devuelven agregados/anonimizado; con sesión, todo):
`/ledger`, `/performance`, `/scan/report`, `/scan/funnel`, `/scan/outcomes`. La regla que separa
las dos caras: cómo se comporta el sistema es público, QUÉ nombres elige el método no lo es.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import settings
from app.scan_llm_stage import DEFAULT_TEMPERATURE

from . import (
    routes_admin,
    routes_alpha,
    routes_analytics,
    routes_capital,
    routes_lecturas,
    routes_personal,
    routes_push,
    routes_scan,
)

public_router = APIRouter()   # sin token: lecturas y teaser de la portada
router = APIRouter()          # exige require_auth (dependencies=[...] en main.py)

public_router.include_router(routes_capital.public_router)
router.include_router(routes_capital.router)
public_router.include_router(routes_scan.public_router)
router.include_router(routes_scan.router)
router.include_router(routes_analytics.router)
router.include_router(routes_admin.router)
router.include_router(routes_lecturas.router)
router.include_router(routes_alpha.router)
router.include_router(routes_personal.router)
router.include_router(routes_push.router)


@public_router.get("/config")
def config() -> dict:
    """Parámetros de cartera para el frontend (evita hardcodear el máximo de posiciones, etc.)."""
    return {
        "max_positions": settings.max_positions,
        "min_positions": settings.min_positions,
        "max_position_pct": settings.max_position_pct,
        "dry_run": settings.dry_run,
        "limit_buffer_pct": settings.limit_buffer_pct,
        "approval_expiry_days": settings.approval_expiry_days,
        # Defaults de LLM por etapa, para que el modal de configuración de la simulación
        # (Alpha) arranque con los valores REALES de producción en vez de copias a mano
        # que se desincronizan del config.py el día que alguien lo cambie aquí y no allí.
        # `temperature` va aquí también (no solo model/reasoning_effort): sin esto, el modal
        # partía de un 1.0 fijo en el frontend y el prescore=0.0 recién decidido se anulaba en
        # SILENCIO cada vez que se lanzaba una simulación — el override "ganaba" sobre el
        # default de `settings` en `_stage_cfg` (ver `scan_llm_stage.py`).
        "llm_defaults": {
            "macro": {"model": settings.llm_model, "reasoning_effort": settings.macro_reasoning_effort,
                      "temperature": DEFAULT_TEMPERATURE},
            "prescore": {
                "model": (settings.qwen_model if settings.prescore_provider == "qwen"
                         else settings.prescore_model),
                "reasoning_effort": settings.prescore_reasoning_effort,
                "temperature": settings.prescore_temperature,
            },
            "mid": {"model": settings.mid_model, "reasoning_effort": settings.mid_reasoning_effort,
                    "temperature": settings.mid_temperature},
            "deep": {"model": settings.llm_model, "reasoning_effort": settings.deep_reasoning_effort,
                     "temperature": DEFAULT_TEMPERATURE},
            "constructor": {"model": settings.llm_model, "reasoning_effort": settings.reasoning_effort,
                            "temperature": DEFAULT_TEMPERATURE},
        },
    }


@public_router.get("/macro")
def macro() -> dict:
    from app.screener.macro import get_macro_regime

    return get_macro_regime()


@router.get("/fx")
def fx_eurusd() -> dict:
    """Cambio EUR→USD INDICATIVO para la frontera de aportaciones (el libro vive en USD; el FX
    real lo hace IBKR al suyo). yfinance `EURUSD=X`, cacheado 60s en tracking.live_prices."""
    from datetime import UTC, datetime

    from app import tracking

    rate = tracking.live_prices(["EURUSD=X"]).get("EURUSD=X")
    return {"pair": "EURUSD", "rate": rate,
            "asof": datetime.now(UTC).isoformat() if rate else None}
