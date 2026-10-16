"""Avisos por Web Push de la cuenta (`/liga/avisos`): la clave pública, los dispositivos suscritos y
el alta y la baja de este navegador. Solo exige identidad (`require_usuario`); la suscripción se
guarda como la cuenta que la pide, en `app.liga.avisos`, que abre su propia sesión de sistema (nunca
`db_sistema` aquí: lo vigila `test_liga_puertas`)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app import push
from app.i18n import translate
from app.liga import acceso, avisos
from app.liga.auth import Identidad, require_usuario

router = APIRouter(tags=["liga-avisos"])

# Activar o desactivar son gestos puntuales; así se frena un bucle del cliente.
_LIMITE = acceso.LimiteFrecuencia(tope=20, ventana_s=60 * 10)


class ClaveOut(BaseModel):
    key: str


class EstadoOut(BaseModel):
    dispositivos: list[str]
    maximo: int


class SuscripcionIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)
    keys: dict = Field(default_factory=dict)


class BajaIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=1000)


@router.get("/avisos/clave", response_model=ClaveOut)
def clave(_ident: Identidad = Depends(require_usuario)) -> ClaveOut:
    return ClaveOut(key=push.vapid_public_key())


@router.get("/avisos", response_model=EstadoOut)
def estado(ident: Identidad = Depends(require_usuario)) -> EstadoOut:
    return EstadoOut(dispositivos=avisos.dispositivos(ident.uid), maximo=avisos.MAX_DISPOSITIVOS)


@router.post("/avisos/probar")
def probar(ident: Identidad = Depends(require_usuario)) -> dict:
    from app.liga.procesos.comun import fabrica_sistema, sesion

    resumen = {"dispositivos": 0, "ok": 0, "baja": 0, "error": 0}
    with sesion(fabrica_sistema) as db:
        subs = db.execute(text("select id, endpoint, p256dh, auth from liga.suscripciones_push "
                               "where usuario_id = cast(:u as uuid)"), {"u": ident.uid}).all()
        payload = json.dumps({"title": translate("push_liga_prueba_title"),
                              "body": translate("push_liga_prueba_body"),
                              "url": "/cuenta/avisos", "tag": "agentic-liga-prueba"})
        for s in subs:
            resultado = push.enviar(s.endpoint, s.p256dh, s.auth, payload)
            resumen["dispositivos"] += 1
            resumen[resultado] += 1
            if resultado == "baja":
                db.execute(text("delete from liga.suscripciones_push where id = :i"), {"i": s.id})
        db.commit()
    return resumen


@router.post("/avisos/suscribir", response_model=EstadoOut)
def suscribir(body: SuscripcionIn, ident: Identidad = Depends(require_usuario)) -> EstadoOut:
    if not _LIMITE.permitido(ident.uid):
        raise HTTPException(429, translate("liga_alerts_too_fast"))
    try:
        avisos.suscribir(ident.uid, body.model_dump())
    except avisos.DemasiadosDispositivos as e:
        raise HTTPException(409, translate("liga_alerts_too_many", count=avisos.MAX_DISPOSITIVOS)
                            ) from e
    except ValueError as e:
        raise HTTPException(422, translate("liga_alerts_invalid")) from e
    return EstadoOut(dispositivos=avisos.dispositivos(ident.uid), maximo=avisos.MAX_DISPOSITIVOS)


@router.post("/avisos/baja", response_model=EstadoOut)
def baja(body: BajaIn, ident: Identidad = Depends(require_usuario)) -> EstadoOut:
    if not _LIMITE.permitido(ident.uid):
        raise HTTPException(429, translate("liga_alerts_too_fast"))
    avisos.dar_de_baja(ident.uid, body.endpoint)
    return EstadoOut(dispositivos=avisos.dispositivos(ident.uid), maximo=avisos.MAX_DISPOSITIVOS)
