"""Solicitudes anónimas de intenciones del usuario."""

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.i18n import current_locale
from app.liga.auth import Identidad, require_usuario
from app.liga.intenciones import registrar_solicitud
from app.liga.procesos.comun import fabrica_sistema

router = APIRouter(tags=["liga-intenciones"])


class SolicitudIn(BaseModel):
    texto: str = Field(max_length=400)


@router.post("/liga/intenciones", status_code=204, response_class=Response)
def solicitar(body: SolicitudIn, ident: Identidad = Depends(require_usuario)) -> Response:
    texto = " ".join(body.texto.split())
    if not texto or len(texto) > 160:
        raise HTTPException(422, "Escribe una frase de hasta 160 caracteres.")
    if not registrar_solicitud(texto, current_locale.get(), ident.uid, fabrica_sistema):
        raise HTTPException(429, "Ya has enviado varias peticiones hoy. Vuelve mañana.")
    return Response(status_code=204)
