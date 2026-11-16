"""La campana del admin: los avisos guardados en `liga.avisos_admin`. Las rutas del panel van como
la propia sesión del admin (la RLS exige admin con 2FA); la del servicio del agente entra con una
clave compartida, no con sesión, y solo deja avisos `agente_*`. El texto lo pone el frontend."""

from __future__ import annotations

import hmac
import json
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import avisos_admin
from app.config import settings
from app.liga.db import db_usuario

router = APIRouter(prefix="/avisos", tags=["liga-admin-avisos"])
router_servicio = APIRouter(prefix="/liga/admin/avisos", tags=["liga-admin-avisos-servicio"])

_CLAVE_DATO = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
# Nombres con los que `avisar` ya tiene argumentos propios: un dato no puede pisarlos.
_RESERVADAS = frozenset({"db", "tipo", "title", "body", "url", "tag", "filas", "resumen"})


class AvisoOut(BaseModel):
    id: int
    tipo: str
    sala: str
    datos: dict
    creado: datetime
    leido: bool


class ListaOut(BaseModel):
    sin_leer: int
    avisos: list[AvisoOut]


def _lista(db: Session) -> ListaOut:
    filas = db.execute(text("""
        select id, tipo, sala, datos, creado, leido_en is not null as leido
        from liga.avisos_admin order by creado desc, id desc limit 50
    """)).all()
    sin_leer = db.execute(text(
        "select count(*) from liga.avisos_admin where leido_en is null")).scalar_one()
    salida = []
    for fila in filas:
        datos = dict(fila._mapping)
        if isinstance(datos["datos"], str):
            datos["datos"] = json.loads(datos["datos"])
        salida.append(AvisoOut(**datos))
    return ListaOut(sin_leer=sin_leer, avisos=salida)


@router.get("", response_model=ListaOut)
def lista(db: Session = Depends(db_usuario)) -> ListaOut:
    """Los últimos 50 avisos, los más recientes primero."""
    return _lista(db)


@router.post("/leidos", response_model=ListaOut)
def marcar_todos(db: Session = Depends(db_usuario)) -> ListaOut:
    db.execute(text("""
        update liga.avisos_admin set leido_en = now(), leido_por = (select auth.uid())
        where leido_en is null
    """))
    return _lista(db)


@router.post("/{aviso_id}/leido", response_model=ListaOut)
def marcar_uno(aviso_id: int, db: Session = Depends(db_usuario)) -> ListaOut:
    hecho = db.execute(text("""
        update liga.avisos_admin
        set leido_en = coalesce(leido_en, now()),
            leido_por = coalesce(leido_por, (select auth.uid()))
        where id = :i returning id
    """), {"i": aviso_id}).first()
    if hecho is None:
        raise HTTPException(404, "Not Found")
    return _lista(db)


class AvisoAgenteIn(BaseModel):
    tipo: str = Field(pattern=r"^agente_[a-z0-9_]{1,57}$")
    datos: dict[str, Any] = Field(default_factory=dict)


@router_servicio.post("/agente", status_code=201)
def avisar_agente(body: AvisoAgenteIn,
                  clave: str = Header(default="", alias="X-Clave-Servicio")) -> dict:
    """El servicio del agente deja un aviso. Sin clave configurada la ruta no existe (404)."""
    esperada = settings.agente_clave_servicio
    if not esperada:
        raise HTTPException(404, "Not Found")
    if not hmac.compare_digest(clave.encode(), esperada.encode()):
        raise HTTPException(401, "Clave de servicio no válida.")
    if any(not _CLAVE_DATO.match(k) or k in _RESERVADAS for k in body.datos):
        raise HTTPException(422, "Claves de datos no válidas.")
    if len(json.dumps(body.datos, default=str).encode()) > 1500:
        raise HTTPException(422, "Datos demasiado grandes.")
    avisos_admin.avisar(None, body.tipo, title=body.tipo, body="", url="/admin",
                        tag=f"agentic-{body.tipo}", **body.datos)
    return {"ok": True}
