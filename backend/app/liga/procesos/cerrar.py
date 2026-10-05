"""Cerrar la jornada (formada → cerrada), plan §8: rentabilidad de cada inscripción y del S&P del
día base al último día de bolsa, puntos con `motor.puntos`, y el registro oficial en
`liga.resultados` (solo añadir) y `jornadas.sp_rentabilidad`. Aunque luego se corrija un precio,
lo cerrado no cambia.

Las estrategias no cambian de estado: las que juegan siguen jugando la siguiente jornada (ya
creada con su temporada) hasta que su dueño las retire.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada
from app.liga.motor.calendario import HORA_CIERRE_INSCRIPCION, HORA_CIERRE_JORNADA
from app.liga.procesos import datos, omega
from app.liga.procesos.comun import (
    TZ_BOLSA,
    ErrorProceso,
    Fabrica,
    ahora_utc,
    auditar,
    auditar_fallo,
    avisar_admin,
    candado,
    fabrica_sistema,
    hoy_bolsa,
    jornada,
    jornada_bloqueada,
    para_json,
    sesion,
)
from app.liga.procesos.diario import SPY, calcular

logger = logging.getLogger(__name__)


def motivos_no_lista(db: Session, j: Jornada) -> list[str]:
    motivos = []
    if j.estado != "formada":
        motivos.append(f"La jornada está {j.estado}: solo se cierra una formada.")
    if not datos.con_cierre(db, [SPY], j.dia_fin):
        motivos.append(f"Aún no hay cierre del S&P del último día ({j.dia_fin}).")
    return motivos


def estado(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        n = db.execute(text(
            "select count(*) from liga.resultados r join liga.inscripciones i "
            "on i.id = r.inscripcion_id where i.jornada_id = :j"), {"j": j.id}).scalar()
        return para_json({"jornada_id": j.id, "estado": j.estado, "resultados": n,
                          "sp_rentabilidad": j.sp_rentabilidad,
                          "motivos": motivos_no_lista(db, j)})


def vista_previa(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> dict:
    """Los resultados que saldrían con los cierres guardados, sin escribir ni pedir precios."""
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        motivos = motivos_no_lista(db, j)
        if j.estado != "formada" or motivos:
            return para_json({"jornada_id": j.id, "listo": False, "motivos": motivos})
        calculo = calcular(db, j, j.dia_fin)
        return para_json({"jornada_id": j.id, "listo": True, "motivos": [],
                          "faltan_cierres": _sin_cierre(calculo), **calculo})


def _sin_cierre(calculo: dict) -> list[str]:
    """Valores en cartera a los que les falta el cierre del último día: sin él, el cálculo usaría
    su cierre anterior y el resultado, que ya no se corrige, quedaría con un precio viejo."""
    return sorted({t for f in calculo["filas"] for t in f.get("sin_cierre") or []})


def _tickers(db: Session, jornada_id: int) -> list[str]:
    return list(db.execute(text("""
        select distinct p.ticker from liga.posiciones p
        join liga.inscripciones i on i.id = p.inscripcion_id where i.jornada_id = :j
    """), {"j": jornada_id}).scalars())


def ejecutar(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
             actor: str | None = None, aceptar_sin_cierre: bool = False) -> dict:
    """`aceptar_sin_cierre`: cerrar aunque a algún valor le falte el cierre del último día (una
    suspendida o retirada de bolsa); usa su último cierre conocido y queda anotado en la
    auditoría. Sin él, la jornada no se cierra: casi siempre es un fallo puntual de la fuente."""
    try:
        with candado("cerrar", fabrica):
            with sesion(fabrica) as db:
                j = jornada(db, jornada_id)
                if j.estado != "formada":
                    raise ErrorProceso(f"La jornada está {j.estado}: solo se cierra una formada.")
                inicio = dict.fromkeys(_tickers(db, j.id) + [SPY], j.dia_base)
                for t, desde in omega.inicios(db, [j]).items():
                    inicio[t] = min(inicio.get(t, desde), desde)
                precios.al_dia(db, inicio)
            with sesion(fabrica) as db:
                return _escribir(db, jornada_id, actor, aceptar_sin_cierre)
    except Exception as e:
        auditar_fallo(fabrica, "cerrar", f"jornada:{jornada_id}", e, actor)
        raise


def _escribir(db: Session, jornada_id: int, actor: str | None, aceptar_sin_cierre: bool) -> dict:
    j = jornada_bloqueada(db, jornada_id)
    motivos = motivos_no_lista(db, j)
    if motivos:
        raise ErrorProceso(" ".join(motivos))
    omega.sincronizar(db, j, j.dia_fin, actor)
    calculo = calcular(db, j, j.dia_fin)
    errores = [f"{f['nombre']}: {f['error']}" for f in calculo["filas"] if f.get("error")]
    if errores:
        raise ErrorProceso("No se puede calcular: " + " · ".join(errores))
    faltan = _sin_cierre(calculo)
    if faltan and not aceptar_sin_cierre:
        raise ErrorProceso(
            f"Faltan los cierres del {j.dia_fin} de: {', '.join(faltan)}. Suele ser un fallo "
            "puntual de la fuente: vuelve a intentarlo. Si esos valores no cotizan (suspendidos "
            "o retirados), ciérrala aceptando su último cierre conocido.")
    for f in calculo["filas"]:
        db.execute(text("""
            insert into liga.resultados (inscripcion_id, rentabilidad, puntos)
            values (:i, :r, :p) on conflict (inscripcion_id) do nothing
        """), {"i": f["inscripcion_id"], "r": f["rentabilidad"], "p": f["puntos"]})
    db.execute(text("update liga.inscripciones set estado = 'cerrada' where jornada_id = :j"),
               {"j": j.id})
    j.sp_rentabilidad = calculo["sp_rentabilidad"]
    j.estado = "cerrada"
    db.flush()
    db.execute(text("""
        update liga.temporadas t set estado = 'cerrada'
        where t.id = :t and not exists (
          select 1 from liga.jornadas j where j.temporada_id = t.id and j.estado <> 'cerrada')
    """), {"t": j.temporada_id})
    auditar(db, "proceso.cerrar", f"jornada:{j.id}",
            {"resultados": len(calculo["filas"]), "sp_rentabilidad": calculo["sp_rentabilidad"],
             "sin_cierre_aceptado": faltan},
            actor)
    db.commit()
    return para_json({"jornada_id": j.id, "estado": j.estado, **calculo})


# --- El del scheduler ---------------------------------------------------------------------------

AJUSTE_AUTO = "procesos.cerrar.auto"
_AVISO_CADA_S = 1800.0     # si no se puede cerrar: un aviso cada media hora, no cada 5 min
_ultimo_aviso: dict[int, float] = {}


def _auto_activo(db: Session) -> bool:
    """Encendido salvo que alguien lo apague a propósito (interruptor de emergencia)."""
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_AUTO}).scalar()
    return valor is not False


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None,
        reloj=time.monotonic) -> dict | None:  # noqa: ANN001 — reloj inyectable en pruebas
    """Cierra sola la jornada que acaba hoy, desde las 17:30 de Nueva York. Corre cada 5 minutos y
    solo cierra con todo limpio: sin el cierre del S&P o de algún valor no escribe nada, porque lo
    cerrado ya no se corrige. Un fallo se registra y, pasada la hora del corte (cuando ya estorba
    a la formación de la siguiente), avisa por push como mucho cada media hora."""
    jornada_id = None
    try:
        ahora_t = ahora_utc(ahora)
        if ahora_t.astimezone(TZ_BOLSA).time() < HORA_CIERRE_JORNADA:
            return None
        with sesion(fabrica) as db:
            if not _auto_activo(db):
                return None
            j = db.scalars(select(Jornada).where(
                Jornada.estado == "formada", Jornada.dia_fin == hoy_bolsa(ahora))).first()
            if j is None:
                return None
            jornada_id = j.id
        hecho = ejecutar(jornada_id, fabrica=fabrica)
        _ultimo_aviso.pop(jornada_id, None)
        return hecho
    except Exception as e:
        logger.exception("No se pudo cerrar la jornada %s", jornada_id)
        if ahora_utc(ahora).astimezone(TZ_BOLSA).time() < HORA_CIERRE_INSCRIPCION:
            return None
        clave = jornada_id or 0
        ahora_s = reloj()
        if ahora_s - _ultimo_aviso.get(clave, -_AVISO_CADA_S) < _AVISO_CADA_S:
            return None
        _ultimo_aviso[clave] = ahora_s
        with sesion(fabrica) as db:
            avisar_admin(db, "Vennett: no se pudo cerrar la jornada", str(e)[:140])
        return None
