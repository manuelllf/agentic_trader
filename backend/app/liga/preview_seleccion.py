"""Vista previa sin persistencia ni llamadas LLM, sobre la última foto y las notas guardadas."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.i18n import current_locale, present_error_detail, translate
from app.liga import acceso, estrategias
from app.liga.auth import Identidad, require_jugador
from app.liga.motor.catalogo import CATALOGO_VERSION
from app.liga.motor.mensajes import presentar
from app.liga.motor.seleccion import SIN_NOTAS, SIN_RESPUESTA, explicar, seleccionar

router = APIRouter(tags=["liga-seleccion"])
_LIMITE_PREVIEW = acceso.LimiteFrecuencia(tope=30, ventana_s=60)


class ReglaPreviewIn(BaseModel):
    clave: str = Field(max_length=40)
    params: dict = Field(default_factory=dict)


class PreviewSeleccionIn(BaseModel):
    idea: str | None = Field(default=None, max_length=400)
    reglas: list[ReglaPreviewIn] = Field(default_factory=list, max_length=30)
    excluidas: list[str] = Field(default_factory=list, max_length=100)
    pregunta: str | None = Field(default=None, max_length=160)
    pesos: dict[str, int] = Field(max_length=10)
    n_empresas: int = Field(ge=1, le=100)
    reparto: str = Field(max_length=20)
    max_por_sector: int = Field(ge=0, le=10)
    ticker: str | None = Field(default=None, min_length=1, max_length=24)


class EmpresaPreviewOut(BaseModel):
    ticker: str
    nombre: str | None
    sector: str | None
    peso: float
    porque: str


class PreviewSeleccionOut(BaseModel):
    estado: Literal["disponible", "incompleto", "sin_datos"]
    mensaje: str
    plan_b: bool | None
    foto_id: int | None
    scan_run_id: int | None
    catalogo_version: int
    evaluadas: int | None
    cumplen_reglas: int | None
    candidatas_ordenadas: int | None
    seleccionadas: int | None
    sin_notas: int | None
    sin_respuesta: int | None
    sin_peso: int | None
    saltadas_por_sector: int | None
    caja_pct: float | None
    elegidas: list[EmpresaPreviewOut]
    explicacion: str | None = None


def _sin_datos(mensaje: str) -> PreviewSeleccionOut:
    return PreviewSeleccionOut(
        estado="sin_datos", mensaje=mensaje, plan_b=None, foto_id=None, scan_run_id=None,
        catalogo_version=CATALOGO_VERSION,
        evaluadas=None, cumplen_reglas=None, candidatas_ordenadas=None, seleccionadas=None,
        sin_notas=None, sin_respuesta=None, sin_peso=None,
        saltadas_por_sector=None, caja_pct=None, elegidas=[],
    )


@router.post("/seleccion/preview", response_model=PreviewSeleccionOut)
def previsualizar(body: PreviewSeleccionIn,
                  ident: Identidad = Depends(require_jugador)) -> PreviewSeleccionOut:
    """Evalúa lo escrito contra la última foto guardada; lectura acotada por usuario."""
    if not _LIMITE_PREVIEW.permitido(ident.uid):
        raise HTTPException(429, "Has cambiado la selección muchas veces. Espera un momento.")
    pregunta = (body.pregunta or "").strip() or None
    receta = estrategias.validar_entrada(
        body.idea, [r.model_dump() for r in body.reglas], body.excluidas, pregunta,
        body.pesos, body.n_empresas, body.reparto, body.max_por_sector,
    )
    try:
        contexto = estrategias.foto_y_notas_actuales()
    except HTTPException as exc:
        if exc.status_code in (404, 409):
            return _sin_datos(present_error_detail(exc.detail, current_locale.get()))
        raise

    respuestas = estrategias.respuestas_sistema(pregunta, contexto.foto_id)
    resultado = seleccionar(list(contexto.empresas), receta, contexto.notas, respuestas)
    sin_notas = sum(f.fallo == SIN_NOTAS for f in resultado.filas)
    sin_respuesta = sum(f.fallo == SIN_RESPUESTA for f in resultado.filas)
    reglas_ok = sum(
        not f.excluida and f.fallo in (None, SIN_NOTAS, SIN_RESPUESTA)
        for f in resultado.filas
    )
    estado = "incompleto" if sin_notas or sin_respuesta else "disponible"
    if estado == "incompleto":
        mensaje = translate("liga_preview_parcial", sin_notas=sin_notas)
        if sin_respuesta:
            mensaje += " " + translate("liga_preview_sin_respuesta", sin_respuesta=sin_respuesta)
    elif contexto.plan_b:
        mensaje = translate("liga_preview_plan_b")
    else:
        mensaje = translate("liga_preview_normal")
    return PreviewSeleccionOut(
        estado=estado, mensaje=mensaje, plan_b=contexto.plan_b,
        foto_id=contexto.foto_id, scan_run_id=contexto.scan_run_id,
        catalogo_version=receta.catalogo_version,
        evaluadas=len(resultado.filas), cumplen_reglas=reglas_ok,
        candidatas_ordenadas=len(resultado.pasan), seleccionadas=len(resultado.elegidas),
        sin_notas=sin_notas, sin_respuesta=sin_respuesta,
        sin_peso=len(resultado.sin_peso),
        saltadas_por_sector=len(resultado.saltadas_por_sector),
        caja_pct=float(resultado.caja_pct),
        elegidas=[EmpresaPreviewOut(
            ticker=e.ticker, nombre=e.fila.empresa.nombre, sector=e.fila.empresa.sector,
            peso=float(e.peso), porque=presentar(e.porque, current_locale.get()),
        ) for e in resultado.elegidas],
        explicacion=presentar(explicar(body.ticker.strip().upper(), resultado, receta),
                              current_locale.get())
        if body.ticker and body.ticker.strip() else None,
    )
