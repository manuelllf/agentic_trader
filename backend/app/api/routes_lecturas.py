"""Lecturas del ranking: scores analizados a fondo, la propuesta vigente (+ejecutarla
en el libro sombra) y la watchlist."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import execution_service
from app.db import get_db
from app.ledger import service as ledger
from app.models import Proposal, Score, Watchlist
from app.schemas import ProposalOut, ScoreOut, WatchlistOut

from .common import ledger_snapshot

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


@router.get("/scores", response_model=list[ScoreOut])
def scores(limit: int = Query(60, ge=1, le=200), db: Session = Depends(get_db)) -> list[Score]:
    # Solo los ANALIZADOS A FONDO (tienen informe). Los pre-cribados de Flash son triaje interno.
    stmt = (select(Score).where(Score.report != "")
            .order_by(Score.score.desc()).limit(limit))
    return list(db.scalars(stmt).all())


@router.get("/proposal", response_model=ProposalOut | None)
def proposal(db: Session = Depends(get_db)) -> Proposal | None:
    stmt = select(Proposal).order_by(Proposal.created_at.desc()).limit(1)
    return db.scalars(stmt).first()


@router.post("/proposal/execute/{ticker}")
def proposal_execute_item(ticker: str, db: Session = Depends(get_db)) -> dict:
    """Ejecuta el item de la propuesta actual (botón Comprar/Vender de Beta)."""
    try:
        res = execution_service.execute_proposal_item(db, ticker.upper())
    except (LookupError, ValueError, ledger.InsufficientFunds, ledger.InsufficientShares) as e:
        raise HTTPException(400, str(e))
    return {**res, "ledger": ledger_snapshot(db)}


@router.post("/proposal/execute")
def proposal_execute_all(db: Session = Depends(get_db)) -> dict:
    """Ejecuta de golpe todos los items accionables de la propuesta en el libro sombra."""
    try:
        res = execution_service.execute_proposal_all(db)
    except LookupError as e:
        raise HTTPException(400, str(e))
    return {**res, "ledger": ledger_snapshot(db)}


@router.get("/watchlist", response_model=list[WatchlistOut])
def watchlist(db: Session = Depends(get_db)) -> list[Watchlist]:
    stmt = select(Watchlist).order_by(Watchlist.score.desc())
    return list(db.scalars(stmt).all())
