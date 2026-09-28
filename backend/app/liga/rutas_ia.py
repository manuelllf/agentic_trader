"""IA de la liga expuesta al usuario (`/liga`, plan §10 F6-A): el conversor. Solo exige identidad
(`require_usuario`): la llamada de IA en sí (switches, tope, foto, créditos) va por
`app.liga.ia`, que abre su propia sesión de sistema — nunca `db_sistema` aquí (lo vigila
`test_liga_puertas`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.liga.auth import Identidad, require_usuario
from app.liga.ia import conversor
from app.liga.ia.conversor import LARGO_FRASE, TOPE_DIARIO

router = APIRouter(tags=["liga-ia"])


class ConvertirIn(BaseModel):
    frase: str = Field(min_length=1, max_length=LARGO_FRASE)


class ReglaSugeridaOut(BaseModel):
    clave: str
    params: dict = Field(default_factory=dict)


class ConvertirOut(BaseModel):
    reglas: list[ReglaSugeridaOut]
    pesos: dict[str, int] | None
    pregunta: str | None
    nombre: str | None
    usos_hoy: int
    usos_tope: int


@router.post("/convertir", response_model=ConvertirOut)
def convertir(body: ConvertirIn, ident: Identidad = Depends(require_usuario)) -> ConvertirOut:
    sugerencia, usos = conversor.convertir(ident.uid, body.frase)
    return ConvertirOut(
        reglas=[ReglaSugeridaOut(**r) for r in sugerencia.reglas], pesos=sugerencia.pesos,
        pregunta=sugerencia.pregunta, nombre=sugerencia.nombre, usos_hoy=usos,
        usos_tope=TOPE_DIARIO)
