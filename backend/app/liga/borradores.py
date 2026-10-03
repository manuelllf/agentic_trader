"""Borradores privados: guardar el trabajo no cambia una receta ejecutable."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.auth import Identidad, require_usuario
from app.liga.db import db_usuario
from app.liga.rutas_estrategias import EscudoIn, RecetaIn

router = APIRouter(tags=["liga-borradores"])


class InterpretacionBorrador(BaseModel):
    intencion: str = Field(min_length=1, max_length=160)
    tipo: Literal["exacta", "aproximada", "no_disponible"]
    regla: str | None = Field(default=None, max_length=40)
    motivo: str = Field(min_length=1, max_length=180)


class ContenidoBorrador(BaseModel):
    nombre: str = Field(default="", max_length=28)
    idea: str = Field(default="", max_length=300)
    etapa: int = Field(default=0, ge=0, le=4)
    escudo: EscudoIn
    receta: RecetaIn
    interpretacion: list[InterpretacionBorrador] = Field(default_factory=list, max_length=12)
    visibilidad: Literal["privada", "publicada"] = "privada"
    declara_posiciones: Literal["si", "no"] | None = None
    cada_dia_1: Literal["revisar", "mantener"] = "revisar"


class BorradorIn(BaseModel):
    revision: int = Field(ge=0)
    contenido: ContenidoBorrador


class BorradorOut(BaseModel):
    revision: int
    contenido: ContenidoBorrador
    actualizado: datetime


def _clave(clave: str, db: Session) -> str:
    if clave == "nueva":
        return clave
    try:
        clave = str(uuid.UUID(clave))
    except ValueError as exc:
        raise HTTPException(404, "No existe ese borrador.") from exc
    propia = db.execute(text("select id from liga.estrategias "
                             "where id = cast(:id as uuid) and dueno_id = auth.uid()"),
                        {"id": clave}).scalar()
    if propia is None:
        raise HTTPException(404, "No existe esa estrategia tuya.")
    return clave


@router.get("/borradores/{clave}", response_model=BorradorOut | None)
def leer(clave: str, db: Session = Depends(db_usuario)) -> dict | None:
    fila = db.execute(text("select revision, contenido, actualizado from liga.borradores "
                           "where usuario_id = auth.uid() and clave = :c"),
                      {"c": _clave(clave, db)}).mappings().one_or_none()
    return dict(fila) if fila else None


@router.put("/borradores/{clave}", response_model=BorradorOut)
def guardar(clave: str, body: BorradorIn, ident: Identidad = Depends(require_usuario),
            db: Session = Depends(db_usuario)) -> dict:
    clave = _clave(clave, db)
    # La revisión impide que otra pestaña o dispositivo sobrescriba trabajo más reciente.
    fila = db.execute(text("""
        insert into liga.borradores (usuario_id, clave, contenido, revision)
        select cast(:u as uuid), :c, cast(:datos as jsonb), 1 where :rev = 0
        on conflict (usuario_id, clave) do nothing
        returning revision, contenido, actualizado
    """), {"u": ident.uid, "c": clave, "datos": body.contenido.model_dump_json(),
           "rev": body.revision}).mappings().one_or_none()
    if fila is None:
        fila = db.execute(text("""
            update liga.borradores set contenido = cast(:datos as jsonb), revision = revision + 1,
                actualizado = now(), actualizado_por = auth.uid()
            where usuario_id = auth.uid() and clave = :c and revision = :rev
            returning revision, contenido, actualizado
        """), {"c": clave, "datos": json.dumps(body.contenido.model_dump()),
               "rev": body.revision}).mappings().one_or_none()
    if fila is None:
        raise HTTPException(409, "Este borrador cambió en otra pestaña. Recarga para recuperarlo.")
    return dict(fila)


@router.delete("/borradores/{clave}", status_code=204)
def borrar(clave: str, revision: int, db: Session = Depends(db_usuario)) -> None:
    db.execute(text("delete from liga.borradores where usuario_id = auth.uid() "
                    "and clave = :c and revision = :r"),
               {"c": _clave(clave, db), "r": revision})


@router.post("/borradores/nueva/vincular/{estrategia_id}", status_code=204)
def vincular(estrategia_id: uuid.UUID, revision: int,
             db: Session = Depends(db_usuario)) -> None:
    clave = _clave(str(estrategia_id), db)
    fila = db.execute(text("update liga.borradores set clave = :c where "
                           "usuario_id = auth.uid() and clave = 'nueva' and revision = :r "
                           "returning revision"), {"c": clave, "r": revision}).scalar()
    if fila is None and revision != 0:
        raise HTTPException(409, "El borrador cambió mientras se creaba la estrategia.")
