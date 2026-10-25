"""API pública del acertijo diario y su suscripción."""

import logging
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import correo, correo_plantilla
from app.criptico import logica
from app.i18n import translate
from app.liga import acceso
from app.liga.db import db_anon

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/criptico", tags=["criptico"])
_limite = acceso.LimiteFrecuencia(tope=10, ventana_s=15 * 60)
Idioma = Literal["es", "en"]


class Segmento(BaseModel):
    texto: str
    papel: Literal["def", "ind", "mat"] | None


class Ayudas(BaseModel):
    definicion: str = Field(alias="def")
    ind: str
    mat: str


class Acertijo(BaseModel):
    id: int
    idioma: Idioma
    numero: int
    fecha: date
    nivel: Literal["facil", "media", "dificil"]
    pista: list[Segmento]
    longitud: int
    ayudas: Ayudas
    media: float | None
    n_media: int | None


class Detalle(BaseModel):
    respuesta: str
    palabra: str
    resolucion: str
    concepto: str
    ejemplo: str
    regla_catalogo: str | None


class HoyOut(BaseModel):
    acertijo: Acertijo


class NumeroOut(HoyOut):
    detalle: Detalle | None = None


class LetrasIn(BaseModel):
    letras: str

    @field_validator("letras", mode="before")
    @classmethod
    def validar(cls, valor: Any) -> str:
        if not isinstance(valor, str):
            raise HTTPException(422, "criptico_letras_invalidas")
        return valor


class ResultadoIn(BaseModel):
    ayudas_usadas: int

    @field_validator("ayudas_usadas", mode="before")
    @classmethod
    def validar(cls, valor: Any) -> int:
        if type(valor) is not int or not 0 <= valor <= logica.MAX_AYUDAS:
            raise HTTPException(422, "criptico_ayudas_invalidas")
        return valor


class VacioIn(BaseModel):
    pass


class LetraOut(BaseModel):
    letra: str


class ComprobarOut(BaseModel):
    correcta: bool
    detalle: Detalle | None


class SolucionOut(BaseModel):
    detalle: Detalle


class SuscripcionIn(BaseModel):
    email: str
    idioma: Idioma


class OkOut(BaseModel):
    ok: bool


def _correo_confirmacion(destino: str, idioma: str, alta: str, baja: str) -> None:
    asunto = "Confirm your daily puzzle subscription" if idioma == "en" else (
        "Confirma tu suscripción al acertijo diario")
    texto, html = correo_plantilla.render(
        idioma=idioma, asunto=asunto, intro=asunto,
        enlace_texto="Confirm" if idioma == "en" else "Confirmar",
        ruta="/criptico/suscripcion/confirmar?token=" + alta,
        pie=translate("blog_correo_confirmar_pie", locale=idioma),
        ajustes_texto=translate("blog_correo_baja_enlace", locale=idioma),
        ajustes_ruta="/criptico/suscripcion/baja?token=" + baja,
        legal_texto=translate("correo_legal", locale=idioma))
    if not correo.enviar(destino, asunto, texto, html):
        logger.warning("No se pudo enviar la confirmación del acertijo")


@router.get("/hoy", response_model=HoyOut)
def hoy(idioma: Idioma = "es", db: Session = Depends(db_anon)) -> dict:
    return {"acertijo": logica.leer_publicado(db, idioma)}


class IndiceOut(BaseModel):
    numero: int
    fecha: date


@router.get("/indice", response_model=list[IndiceOut])
def indice(idioma: Idioma = "es", db: Session = Depends(db_anon)) -> list[dict]:
    filas = db.execute(text("""
        select numero, dia as fecha from criptico.acertijos
        where idioma = :idioma and estado = 'publicado' and dia <= :hoy
        order by numero asc
    """), {"idioma": idioma, "hoy": logica.hoy_madrid()}).mappings().all()
    return [dict(fila) for fila in filas]


@router.get("/numero/{numero}", response_model=NumeroOut, response_model_exclude_unset=True)
def numero(numero: int, idioma: Idioma = "es", db: Session = Depends(db_anon)) -> dict:
    acertijo = logica.leer_publicado(db, idioma, numero=numero)
    salida = {"acertijo": acertijo}
    if acertijo["fecha"] < logica.hoy_madrid():
        salida["detalle"] = logica.leer_detalle(acertijo["id"])
    return salida


@router.post("/suscripcion", status_code=202, response_model=OkOut)
def suscripcion(body: SuscripcionIn, request: Request, db: Session = Depends(db_anon)) -> dict:
    if _limite.permitido(acceso.ip_cliente(request)):
        enviar, alta, baja = logica.alta_suscripcion(db, body.email, body.idioma)
        if enviar:
            _correo_confirmacion(body.email.strip().lower(), body.idioma, alta, baja)
    return {"ok": True}


@router.get("/suscripcion/confirmar", response_model=OkOut)
def confirmar(token: str, db: Session = Depends(db_anon)) -> dict:
    return {"ok": logica.confirmar_suscripcion(db, token)}


@router.get("/suscripcion/baja", response_model=OkOut)
def baja(token: str, db: Session = Depends(db_anon)) -> dict:
    return {"ok": logica.baja_suscripcion(db, token)}


@router.post("/{id}/letra", response_model=LetraOut)
def letra(id: int, body: VacioIn, db: Session = Depends(db_anon)) -> dict:
    logica.exigir_publicado(db, id)
    return {"letra": logica.leer_detalle(id)["respuesta"][0]}


@router.post("/{id}/comprobar", response_model=ComprobarOut)
def comprobar(id: int, body: LetrasIn, db: Session = Depends(db_anon)) -> dict:
    logica.exigir_publicado(db, id)
    detalle = logica.leer_detalle(id)
    correcta = logica.comprobar(body.letras, detalle["respuesta"])
    return {"correcta": correcta, "detalle": detalle if correcta else None}


@router.post("/{id}/resuelto", status_code=204)
def resuelto(id: int, body: ResultadoIn, db: Session = Depends(db_anon)) -> Response:
    logica.registrar(db, id, body.ayudas_usadas, False)
    return Response(status_code=204)


@router.post("/{id}/solucion", response_model=SolucionOut)
def solucion(id: int, body: ResultadoIn, db: Session = Depends(db_anon)) -> dict:
    logica.exigir_publicado(db, id)
    detalle = logica.leer_detalle(id)
    logica.registrar(db, id, body.ayudas_usadas, True)
    return {"detalle": detalle}
