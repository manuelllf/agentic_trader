"""Lectura y cierre de la hoja de novedades de la cuenta."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.auth import require_usuario
from app.liga.db import db_usuario
from app.liga.novedades import NovedadesOut, construir

router = APIRouter(tags=["liga-novedades"], dependencies=[Depends(require_usuario)])


@router.get("/novedades", response_model=NovedadesOut | None)
def novedades(db: Session = Depends(db_usuario)) -> NovedadesOut | None:
    return construir(db)


@router.post("/novedades/vistas", status_code=204)
def vistas(db: Session = Depends(db_usuario)) -> Response:
    db.execute(text("select liga.marcar_novedades_vistas()"))
    return Response(status_code=204)
