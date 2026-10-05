"""Agrupa la actividad por sesión verificada, con corte a los 30 minutos de inactividad."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.auth import Identidad, require_admin, require_usuario
from app.liga.db import db_usuario

router = APIRouter(tags=["liga-visitas"])
router_admin = APIRouter(tags=["liga-admin-visitas"])


class ActividadOut(BaseModel):
    ok: bool = True


class ResumenVisitas(BaseModel):
    visitas: int
    ultima_visita: datetime | None
    ultima_actividad: datetime | None


class FilaVisita(BaseModel):
    inicio: datetime
    ultima_actividad: datetime


class HistorialVisitas(BaseModel):
    total: int
    filas: list[FilaVisita]


def _session_id(ident: Identidad) -> uuid.UUID:
    """Valida el claim firmado `session_id`; jamás recibe el valor desde el cuerpo o la URL."""
    try:
        return uuid.UUID(str(ident.claims["session_id"]))
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise HTTPException(401, "Sesión no válida. Vuelve a entrar.") from exc


def registrar_actividad(db: Session, ident: Identidad) -> None:
    """Call the constrained writer; RLS never grants clients direct ledger writes."""
    _session_id(ident)
    db.execute(text("select liga.registrar_visita()"))


@router.post("/visitas/actividad", response_model=ActividadOut, status_code=202)
def actividad(ident: Identidad = Depends(require_usuario),
              db: Session = Depends(db_usuario)) -> ActividadOut:
    registrar_actividad(db, ident)
    return ActividadOut()


@router_admin.get("/usuarios/{id}/visitas", response_model=ResumenVisitas,
                  dependencies=[Depends(require_admin)])
def resumen_visitas(id: uuid.UUID, db: Session = Depends(db_usuario)) -> ResumenVisitas:
    fila = db.execute(text("""
        select count(*) as visitas, max(inicio) as ultima_visita,
               max(ultima_actividad) as ultima_actividad
        from liga.visitas where usuario_id = :uid
    """), {"uid": id}).one()
    return ResumenVisitas(**fila._mapping)


@router_admin.get("/usuarios/{id}/visitas/historial", response_model=HistorialVisitas,
                  dependencies=[Depends(require_admin)])
def historial_visitas(id: uuid.UUID, desde: int = Query(0, ge=0),
                      cuantos: int = Query(20, ge=1, le=100),
                      db: Session = Depends(db_usuario)) -> HistorialVisitas:
    total = db.execute(text("select count(*) from liga.visitas where usuario_id = :uid"),
                       {"uid": id}).scalar_one()
    filas = db.execute(text("""
        select inicio, ultima_actividad from liga.visitas
        where usuario_id = :uid
        order by inicio desc, id desc
        offset :desde limit :cuantos
    """), {"uid": id, "desde": desde, "cuantos": cuantos}).all()
    return HistorialVisitas(total=total, filas=[FilaVisita(**f._mapping) for f in filas])
