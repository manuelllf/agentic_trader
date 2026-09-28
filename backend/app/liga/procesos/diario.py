"""Cierres diarios de la liga (plan §8): los precios de lo que está en cartera y del S&P, y la
tabla provisional del mes, que se calcula al pedirla y no se guarda (sería una copia).

El horario vive en código (`app.scheduler`, 17:15 de Nueva York los días de bolsa) y se enciende
con el ajuste `procesos.diario.activo` de `liga.ajustes` (apagado si no existe).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada
from app.liga.motor import calendario
from app.liga.motor.puntos import resultado_jornada
from app.liga.motor.rentabilidad import rentabilidad_cartera, rentabilidad_sp
from app.liga.procesos import datos, omega
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    hoy_bolsa,
    jornada,
    para_json,
    sesion,
)

logger = logging.getLogger(__name__)

SPY = precios.REFERENCIA
AJUSTE_ACTIVO = "procesos.diario.activo"


# --- Rentabilidades del mes (compartido con el cierre) -------------------------------------------


def ultimo_dia(db: Session, j: Jornada, hasta: date | None = None) -> date | None:
    """El último día con cierre del S&P dentro de la jornada (hasta `hasta`, si se da)."""
    tope = min(hasta, j.dia_fin) if hasta else j.dia_fin
    return db.execute(text(
        "select max(dia) from precio_cierre where ticker = :t and dia between :a and :b"),
        {"t": SPY, "a": j.dia_base, "b": tope}).scalar()


def calcular(db: Session, j: Jornada, dia: date) -> dict:
    """Rentabilidad de cada inscripción y del S&P desde el cierre del día base hasta `dia`, con
    el motor (`rentabilidad`) y su resultado contra el S&P (`puntos`)."""
    filas = db.execute(text("""
        select i.id, i.estrategia_id, i.estado, e.nombre, e.tipo, e.casa_clave
        from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
        where i.jornada_id = :j order by i.id
    """), {"j": j.id}).all()
    pos = datos.posiciones(db, [f.id for f in filas])
    tickers = {t for ps in pos.values() for t, _ in ps} | {SPY}
    cierres = precios.series(db, sorted(tickers), j.dia_base, dia)
    try:
        sp = rentabilidad_sp(cierres.get(SPY, []), j.dia_base, dia)
    except ValueError as e:
        raise ErrorProceso(f"Sin cierre del S&P del día base ({j.dia_base}).") from e
    salida = []
    for f in filas:
        fila = {"inscripcion_id": f.id, "estrategia_id": f.estrategia_id, "nombre": f.nombre,
                "tipo": f.tipo, "casa_clave": f.casa_clave, "estado": f.estado}
        try:
            if f.casa_clave == "omega":
                r, sin_cierre = omega.rentabilidad(db, j, dia)
            else:
                r = rentabilidad_cartera(pos[f.id], cierres, j.dia_base, dia) if pos[f.id] \
                    else Decimal("0.0000")
                sin_cierre = sorted(t for t, _ in pos[f.id]
                                    if not any(c.dia == dia for c in cierres.get(t, [])))
        except ValueError as e:
            salida.append({**fila, "rentabilidad": None, "error": str(e)})
            continue
        res = resultado_jornada(r, sp)
        salida.append({**fila, "rentabilidad": r, "dif": res.dif, "letra": res.letra,
                       "puntos": res.puntos, "sin_cierre": sin_cierre})
    salida.sort(key=lambda x: (x["rentabilidad"] is None, -(x["rentabilidad"] or 0)))
    return {"dia": dia, "sp_rentabilidad": sp, "filas": salida}


def tabla_provisional(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
                      hasta: date | None = None) -> dict:
    """La tabla del mes en curso, calculada con los cierres guardados."""
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        if j.estado == "programada":
            raise ErrorProceso("La jornada aún no está formada.")
        dia = ultimo_dia(db, j, hasta)
        if dia is None:
            raise ErrorProceso(f"Sin cierre del S&P del día base ({j.dia_base}).")
        return para_json({"jornada_id": j.id, "estado": j.estado, **calcular(db, j, dia)})


# --- El proceso ----------------------------------------------------------------------------------


def _formadas(db: Session) -> list[Jornada]:
    return list(db.scalars(select(Jornada).where(Jornada.estado == "formada")
                           .order_by(Jornada.dia_base, Jornada.id)))


def _inicios(db: Session) -> dict[str, date]:
    """Cada ticker en cartera de una jornada formada, desde su día base; el S&P; y lo que Omega
    puede comprar o ya tiene abierto."""
    inicio = dict(db.execute(text("""
        select p.ticker, min(j.dia_base) from liga.posiciones p
        join liga.inscripciones i on i.id = p.inscripcion_id
        join liga.jornadas j on j.id = i.jornada_id
        where j.estado = 'formada' group by p.ticker
    """)).all())
    base = db.execute(text("select min(dia_base) from liga.jornadas where estado = 'formada'")
                      ).scalar()
    if base is not None:
        inicio[SPY] = min(inicio.get(SPY, base), base)
    for t, desde in omega.inicios(db, _formadas(db)).items():
        inicio[t] = min(inicio.get(t, desde), desde)
    return inicio


def activo(db: Session) -> bool:
    valor = db.execute(text("select valor from liga.ajustes where clave = :c"),
                       {"c": AJUSTE_ACTIVO}).scalar()
    return valor is True


def estado(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        jornadas = db.execute(text(
            "select id, dia_base, dia_fin from liga.jornadas where estado = 'formada' order by id"
        )).all()
        ultimos = {j.id: db.execute(text(
            "select max(dia) from precio_cierre where ticker = :t and dia between :a and :b"),
            {"t": SPY, "a": j.dia_base, "b": j.dia_fin}).scalar() for j in jornadas}
        return para_json({"activo": activo(db), "jornadas_formadas": [
            {"jornada_id": j.id, "ultimo_cierre": ultimos[j.id]} for j in jornadas]})


def vista_previa(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        inicio = _inicios(db)
        return para_json({"activo": activo(db), "tickers": sorted(inicio),
                          "n_tickers": len(inicio)})


def ejecutar(fabrica: Fabrica = fabrica_sistema, actor: str | None = None) -> dict:
    try:
        with candado("diario", fabrica), sesion(fabrica) as db:
            inicio = _inicios(db)
            filas = precios.al_dia(db, inicio) if inicio else 0
            huecos = [omega.sincronizar(db, j, ultimo, actor) for j in _formadas(db)
                      if (ultimo := ultimo_dia(db, j)) is not None]
            auditar(db, "proceso.diario", None, {"tickers": len(inicio), "filas": filas}, actor)
            db.commit()
            return {"tickers": len(inicio), "filas": filas, "omega": huecos}
    except Exception as e:
        auditar_fallo(fabrica, "diario", None, e, actor)
        raise


def interruptor(encender: bool, fabrica: Fabrica = fabrica_sistema,
                actor: str | None = None) -> dict:
    from app.liga.procesos.comun import como_uuid

    with sesion(fabrica) as db:
        db.execute(text("""
            insert into liga.ajustes (clave, valor, actualizado_por)
            values (:c, cast(:v as jsonb), :a)
            on conflict (clave) do update
              set valor = excluded.valor, actualizado = now(),
                  actualizado_por = excluded.actualizado_por
        """), {"c": AJUSTE_ACTIVO, "v": "true" if encender else "false", "a": como_uuid(actor)})
        auditar(db, "proceso.diario.interruptor", None, {"activo": encender}, actor)
        db.commit()
        return {"activo": encender}


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None) -> dict | None:
    """El del scheduler: solo en día de bolsa y con el interruptor encendido. Un fallo se
    registra y avisa por push; nunca tira el scheduler."""
    if not calendario.es_dia_de_bolsa(hoy_bolsa(ahora)):
        return None
    try:
        with sesion(fabrica) as db:
            if not activo(db):
                return None
        return ejecutar(fabrica)
    except Exception as e:
        logger.exception("Fallo en los cierres diarios de la liga")
        try:
            from app import push

            with sesion(fabrica) as db:
                push.send_to_all(db, title="Liguilla: fallaron los cierres diarios",
                                 body=str(e)[:140], url="/admin", tag="agentic-liga")
        except Exception:
            logger.exception("Tampoco se pudo avisar por push")
        return None
