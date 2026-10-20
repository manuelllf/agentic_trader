"""Datos públicos de /aprender: próximo cierre y recuento del ROE.
Sin la puerta de la liga pública porque no enseñan datos de nadie."""

from __future__ import annotations

import threading
from datetime import UTC, date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.liga import estrategias
from app.liga.db import db_anon
from app.liga.mercado_stats import numero
from app.liga.motor.calendario import (
    HORA_APERTURA,
    HORA_CIERRE_INSCRIPCION,
    HORA_CIERRE_JORNADA,
    TZ_NUEVA_YORK,
    cierre_de_cambios,
    jornada_del_mes,
)
from app.liga.motor.catalogo import CATALOGO
from app.liga.motor.puntos import BANDA, PUNTOS
from app.liga.procesos import premio as premio_proceso
from app.liga.rutas_publicas import PremioOut

router = APIRouter(prefix="/aprender", tags=["liga-aprender"])


class JornadaCiclo(BaseModel):
    numero: int | None
    dia_base: date
    dia_inicio: date
    dia_fin: date


class PuntosOut(BaseModel):
    banda: Decimal
    gana: int
    empata: int
    pierde: int


class CicloOut(BaseModel):
    jornada: JornadaCiclo
    escaneo: datetime
    cierre_jornada: datetime
    corte: datetime
    cierre_cambios: datetime
    apertura: datetime
    puntos: PuntosOut
    premio: PremioOut


class RoeOut(BaseModel):
    minimo: int
    maximo: int
    paso: int
    defecto: int
    pasan: list[int]


class MercadoAprenderOut(BaseModel):
    foto_id: int
    total: int
    roe: RoeOut


def horas_del_ciclo(dia_base: date, dia_inicio: date,
                    corte: datetime | None = None) -> dict[str, datetime]:
    horas = {
        "escaneo": datetime.combine(
            dia_base, time(settings.scan_cron_hour, settings.scan_cron_minute),
            tzinfo=ZoneInfo(settings.scan_timezone)),
        "cierre_jornada": datetime.combine(
            dia_base, HORA_CIERRE_JORNADA, tzinfo=TZ_NUEVA_YORK),
        "corte": corte if corte is not None else datetime.combine(
            dia_base, HORA_CIERRE_INSCRIPCION, tzinfo=TZ_NUEVA_YORK),
        "cierre_cambios": cierre_de_cambios(dia_inicio),
        "apertura": datetime.combine(dia_inicio, HORA_APERTURA, tzinfo=TZ_NUEVA_YORK),
    }
    return {clave: hora.astimezone(UTC) for clave, hora in horas.items()}


def _proxima_jornada(db: Session) -> dict | None:
    fila = db.execute(text("""
        select numero, dia_base, dia_inicio, dia_fin, cierre_inscripcion
        from liga.jornadas where estado = 'programada' order by dia_inicio limit 1
    """)).one_or_none()
    return dict(fila._mapping) if fila is not None else None


def _jornada_de_calendario(hoy: date) -> dict:
    anio, mes = (hoy.year + 1, 1) if hoy.month == 12 else (hoy.year, hoy.month + 1)
    f = jornada_del_mes(anio, mes)
    return {"numero": None, "dia_base": f.dia_base, "dia_inicio": f.dia_inicio,
            "dia_fin": f.dia_fin, "cierre_inscripcion": f.cierre_inscripcion}


@router.get("/ciclo", response_model=CicloOut)
def ciclo(response: Response, db: Session = Depends(db_anon)) -> CicloOut:
    j = _proxima_jornada(db) or _jornada_de_calendario(datetime.now(TZ_NUEVA_YORK).date())
    horas = horas_del_ciclo(j["dia_base"], j["dia_inicio"], j["cierre_inscripcion"])
    puntos = PuntosOut(banda=BANDA, gana=PUNTOS["G"], empata=PUNTOS["E"], pierde=PUNTOS["P"])
    premio = PremioOut(**premio_proceso.estado_publico())
    response.headers["Cache-Control"] = "public, max-age=300"
    return CicloOut(
        jornada=JornadaCiclo(numero=j["numero"], dia_base=j["dia_base"],
                             dia_inicio=j["dia_inicio"], dia_fin=j["dia_fin"]),
        **horas, puntos=puntos, premio=premio)


def recuento_roe(empresas) -> RoeOut:
    regla = CATALOGO["rentables"]
    p = next(x for x in regla.parametros if x.nombre == "roe_pct")
    con_precio = [e for e in empresas if numero(e.precio) is not None]
    umbrales = range(int(p.minimo), int(p.maximo) + 1, int(p.paso))
    pasan = [sum(regla.evaluar(e, {"roe_pct": u}) is None for e in con_precio) for u in umbrales]
    return RoeOut(minimo=int(p.minimo), maximo=int(p.maximo), paso=int(p.paso),
                  defecto=int(p.defecto), pasan=pasan)


_cache: dict[tuple, MercadoAprenderOut] = {}
_candado = threading.Lock()


def _mercado() -> MercadoAprenderOut:
    with _candado:
        contexto = estrategias.contexto_de_referencia()
        clave = (contexto.foto_id, contexto.scan_run_id)
        if clave in _cache:
            return _cache[clave]
        datos = MercadoAprenderOut(
            foto_id=contexto.foto_id,
            total=sum(numero(e.precio) is not None for e in contexto.empresas),
            roe=recuento_roe(contexto.empresas))
        _cache.clear()
        _cache[clave] = datos
        return datos


@router.get("/mercado", response_model=MercadoAprenderOut, dependencies=[Depends(db_anon)])
def mercado(response: Response) -> MercadoAprenderOut:
    try:
        datos = _mercado()
    except Exception as e:
        raise HTTPException(503, "Aún no hay datos del mercado.") from e
    response.headers["Cache-Control"] = "public, max-age=600"
    return datos
