"""Cartera personal de Manuel en IBKR: intocable para el agente, mini-tracker
de solo lectura (snapshot + precios vivos)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


@router.get("/personal")
def personal_summary(db: Session = Depends(get_db)) -> dict:
    """Mini-tracker de la cartera personal del usuario (snapshot + precios vivos)."""
    from app import personal

    return personal.summary(db)


@router.post("/personal/sync")
def personal_sync(db: Session = Depends(get_db)) -> dict:
    """Refresca el snapshot desde IBKR (READ-ONLY: jamás envía órdenes)."""
    from app import personal

    try:
        n = personal.sync_from_ibkr(db)
    except Exception as exc:  # noqa: BLE001 — motivo legible en el panel
        raise HTTPException(502, f"No se pudo sincronizar con IBKR: {exc}")
    return {"synced": n, **personal.summary(db)}
