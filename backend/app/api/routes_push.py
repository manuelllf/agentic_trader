"""Web Push: clave VAPID publica, alta/baja de subscripcion y notificacion de
prueba para verificar el canal end-to-end."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


class PushSubscribeIn(BaseModel):
    endpoint: str
    keys: dict


@router.get("/push/key")
def push_key() -> dict:
    from app import push

    return {"key": push.vapid_public_key()}


@router.post("/push/subscribe")
def push_subscribe(body: PushSubscribeIn, db: Session = Depends(get_db)) -> dict:
    from app import push

    try:
        push.subscribe(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True}


@router.post("/push/unsubscribe")
def push_unsubscribe(body: PushSubscribeIn, db: Session = Depends(get_db)) -> dict:
    from app import push

    push.unsubscribe(db, body.endpoint)
    return {"ok": True}


@router.post("/push/test")
def push_test(db: Session = Depends(get_db)) -> dict:
    """Notificación de prueba para verificar el canal de alertas end-to-end."""
    from app import push

    sent = push.send_to_all(db, "Agentic Trader — Alpha",
                            "Canal de alertas operativo. Así llegarán las propuestas.", "/alpha")
    return {"sent": sent}
