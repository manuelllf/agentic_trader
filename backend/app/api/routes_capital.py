"""Libro de capital (sleeve sombra): aportar/retirar, rendimiento, curva histórica y el
teaser de portada. Ver la regla de doble nivel (auth_optional) en app/api/routes.py."""
from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import auth_optional
from app.db import get_db
from app.ledger import service as ledger

from .common import AllocateIn, ledger_snapshot

logger = logging.getLogger(__name__)

public_router = APIRouter()   # sin token: lecturas y teaser de la portada
router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


@public_router.get("/ledger")
def ledger_view(db: Session = Depends(get_db), authed: bool = Depends(auth_optional)) -> dict:
    """Doble nivel: los agregados (caja, equity, P&L...) se ven siempre — son cifras ficticias
    de un sleeve virtual —, pero la identidad de la cartera (qué tickers, con qué peso) es del
    método y solo se revela con sesión: sin token, `positions` va vacío."""
    out = ledger_snapshot(db)
    if not authed:
        out = {**out, "positions": []}
    return out


@router.post("/ledger/allocate")
def ledger_allocate(body: AllocateIn, db: Session = Depends(get_db)) -> dict:
    ledger.allocate(db, body.amount, body.note)
    return ledger_snapshot(db)


def _anonymize_positions(rows: list[dict]) -> list[dict]:
    """Quita la identidad de cada posición (ticker, cantidad, coste...) dejando solo el P&L
    relativo, para que el rendimiento se pueda presumir sin regalar la cartera del método."""
    return [
        {"label": f"Posición {i}", "unrealized_pnl": r["unrealized_pnl"], "unrealized_pct": r["pnl_pct"]}
        for i, r in enumerate(rows, start=1)
    ]


@public_router.get("/performance")
def performance(db: Session = Depends(get_db), authed: bool = Depends(auth_optional)) -> dict:
    """Seguimiento gratis: rentabilidad de la cartera (precio vivo) vs S&P 500 desde la entrada.
    Doble nivel: los agregados (rentabilidad, alpha...) se ven siempre; el detalle por posición
    solo con sesión — sin token llega anonimizado (sin ticker ni cantidades)."""
    from app import tracking
    perf = tracking.performance(db)
    if not authed:
        perf = {**perf, "positions": _anonymize_positions(perf["positions"])}
    return perf


@public_router.get("/history")
def history_series(
    book: str = "shadow", db: Session = Depends(get_db), authed: bool = Depends(auth_optional),
) -> dict:
    """Curva histórica (cierres diarios, índice base 100 vs S&P 500). Doble nivel: la sombra es
    pública entera (cifras de un sleeve virtual); la real sin sesión pierde el equity — quedan
    fechas y % (lo mismo que ya presume la portada), nunca importes."""
    from app import history as history_mod
    from app.models import BOOK_REAL, BOOK_SHADOW

    if book not in (BOOK_SHADOW, BOOK_REAL):
        raise HTTPException(status_code=422, detail="book debe ser 'shadow' o 'real'.")
    out = history_mod.series(db, book)
    if book == BOOK_REAL and not authed:
        out["series"] = [{k: v for k, v in p.items() if k != "equity"} for p in out["series"]]
    return out


@public_router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    """Teaser público de la portada: sombra completa (viene de /performance) + real SOLO el
    % de P&L no realizado + Omega SOLO el % combinado (nunca importes, tickers ni nº de
    posiciones — eso es privado, ver la regla arriba en el docstring del módulo)."""
    from app import tracking
    from app.models import BOOK_REAL
    from app.momentum import capital as momentum_capital

    perf = tracking.performance(db)
    shadow = {
        "return_pct": perf["portfolio_return_pct"] if perf["positions"] else None,
        "spy_pct": perf["spy_return_pct"],
        "alpha_pct": perf["alpha_pct"],
        "since": perf["since"],
        "positions": len(perf["positions"]),
    }

    real_pct: float | None = None
    real_positions = ledger.open_positions(db, BOOK_REAL)
    if real_positions:
        prices = tracking.live_prices([p.ticker for p in real_positions])
        snap = ledger.snapshot(db, price_lookup=lambda t: prices.get(t), book=BOOK_REAL)
        cost_basis = snap.positions_value - snap.unrealized_pnl  # Decimal, cent-exacto
        if cost_basis > 0:
            real_pct = float((snap.unrealized_pnl / cost_basis * 100).quantize(Decimal("0.01")))

    # Las tablas momentum_* viven fuera del ORM (SQL manda, no Alembic) -- en algún entorno de
    # test/dev sin ellas, un fallo aquí no debe tumbar el teaser entero de Alpha/Beta.
    omega_pct: float | None = None
    try:
        combinado = momentum_capital.retorno_combinado(db)
        omega_pct = float(combinado.quantize(Decimal("0.01"))) if combinado is not None else None
    except Exception:  # noqa: BLE001
        logger.exception("No se pudo calcular el retorno combinado de Omega para /overview")

    return {
        "shadow": shadow,
        "real": {"unrealized_pct": real_pct},
        "omega": {"return_pct": omega_pct},
    }
