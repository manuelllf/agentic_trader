"""Control de los procesos de la liga desde admin (plan §13): estado, vista previa y ejecutar.

Cada ruta exige admin con 2FA (`require_admin`) y no abre sesión de BD: llama al servicio, que
corre como sistema porque es un proceso, no una petición de usuario (lo vigila
`test_liga_puertas`)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.liga.auth import Identidad, require_admin
from app.liga.procesos import cerrar, diario, estado, formar, foto, temporadas
from app.liga.procesos.comun import ErrorProceso

router = APIRouter(prefix="/liga/admin/procesos", tags=["liga-admin"])
ADMIN = [Depends(require_admin)]


class JornadaIn(BaseModel):
    jornada_id: int = Field(gt=0)


class FotoIn(JornadaIn):
    foto_id: int | None = Field(default=None, gt=0)
    scan_run_id: int | None = Field(default=None, gt=0)


class InterruptorIn(BaseModel):
    activo: bool


def _llamar(fn: Callable[..., dict], *args: Any, **kwargs: Any) -> dict:
    try:
        return fn(*args, **kwargs)
    except ErrorProceso as e:
        raise HTTPException(e.codigo, str(e)) from e


@router.get("/estado", dependencies=ADMIN)
def estado_general() -> dict:
    return _llamar(estado.general)


# ---- Temporadas ---------------------------------------------------------------------------------

@router.get("/temporadas/estado", dependencies=ADMIN)
def temporadas_estado() -> dict:
    return _llamar(temporadas.estado)


@router.post("/temporadas/vista-previa", dependencies=ADMIN)
def temporadas_vista_previa() -> dict:
    return _llamar(temporadas.vista_previa)


@router.post("/temporadas/ejecutar", dependencies=ADMIN)
def temporadas_ejecutar(ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(temporadas.ejecutar, actor=ident.uid)


# ---- Foto de la jornada -------------------------------------------------------------------------

@router.get("/foto/estado", dependencies=ADMIN)
def foto_estado(jornada_id: int) -> dict:
    return _llamar(foto.estado, jornada_id)


@router.post("/foto/vista-previa", dependencies=ADMIN)
def foto_vista_previa(body: FotoIn) -> dict:
    return _llamar(foto.vista_previa, body.jornada_id, body.foto_id, body.scan_run_id)


@router.post("/foto/ejecutar", dependencies=ADMIN)
def foto_ejecutar(body: FotoIn, ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(foto.ejecutar, body.jornada_id, body.foto_id, body.scan_run_id,
                   actor=ident.uid)


# ---- Formar la jornada --------------------------------------------------------------------------

@router.get("/formar/estado", dependencies=ADMIN)
def formar_estado(jornada_id: int) -> dict:
    return _llamar(formar.estado, jornada_id)


@router.post("/formar/vista-previa", dependencies=ADMIN)
def formar_vista_previa(body: JornadaIn) -> dict:
    return _llamar(formar.vista_previa, body.jornada_id)


@router.post("/formar/ejecutar", dependencies=ADMIN)
def formar_ejecutar(body: JornadaIn, ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(formar.ejecutar, body.jornada_id, actor=ident.uid)


# ---- Cierres diarios ----------------------------------------------------------------------------

@router.get("/diario/estado", dependencies=ADMIN)
def diario_estado() -> dict:
    return _llamar(diario.estado)


@router.post("/diario/vista-previa", dependencies=ADMIN)
def diario_vista_previa() -> dict:
    return _llamar(diario.vista_previa)


@router.post("/diario/ejecutar", dependencies=ADMIN)
def diario_ejecutar(ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(diario.ejecutar, actor=ident.uid)


@router.post("/diario/interruptor", dependencies=ADMIN)
def diario_interruptor(body: InterruptorIn, ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(diario.interruptor, body.activo, actor=ident.uid)


@router.get("/diario/tabla", dependencies=ADMIN)
def diario_tabla(jornada_id: int, hasta: date | None = None) -> dict:
    return _llamar(diario.tabla_provisional, jornada_id, hasta=hasta)


# ---- Cerrar la jornada --------------------------------------------------------------------------

@router.get("/cerrar/estado", dependencies=ADMIN)
def cerrar_estado(jornada_id: int) -> dict:
    return _llamar(cerrar.estado, jornada_id)


@router.post("/cerrar/vista-previa", dependencies=ADMIN)
def cerrar_vista_previa(body: JornadaIn) -> dict:
    return _llamar(cerrar.vista_previa, body.jornada_id)


@router.post("/cerrar/ejecutar", dependencies=ADMIN)
def cerrar_ejecutar(body: JornadaIn, ident: Identidad = Depends(require_admin)) -> dict:
    return _llamar(cerrar.ejecutar, body.jornada_id, actor=ident.uid)
