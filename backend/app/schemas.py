"""Esquemas Pydantic (contratos de la API), separados de los modelos ORM."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    ticker: str
    sector: str
    score: float          # dos decimales (ver scorer.SYSTEM); la web la redondea al pintarla
    headline: str
    report: str
    price: float | None
    target_price: float | None
    held: bool
    on_watchlist: bool


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    cash_target_pct: float
    macro_summary: str
    items: list
    # [{ticker, reason}] — candidatos seleccionados que el constructor NO fondeó. La ruta
    # /proposal ya exige sesión (nombra tickers), así que no necesita capa pública aparte.
    omitted: list = []


class WatchlistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticker: str
    score: float
    thesis: str
    last_seen: datetime
