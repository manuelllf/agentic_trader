"""Cerrar la jornada (formada → cerrada), plan §8: rentabilidad de cada inscripción y del S&P del
día base al último día de bolsa, puntos con `motor.puntos`, y el registro oficial en
`liga.resultados` (solo añadir) y `jornadas.sp_rentabilidad`. Aunque luego se corrija un precio,
lo cerrado no cambia.

Las estrategias no cambian de estado: las que juegan siguen jugando la siguiente jornada (ya
creada con su temporada) hasta que su dueño las retire.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import precios
from app.liga.models import Jornada
from app.liga.procesos import datos, omega
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    jornada,
    jornada_bloqueada,
    para_json,
    sesion,
)
from app.liga.procesos.diario import SPY, calcular


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
        return para_json({"jornada_id": j.id, "listo": True, "motivos": [],
                          **calcular(db, j, j.dia_fin)})


def _tickers(db: Session, jornada_id: int) -> list[str]:
    return list(db.execute(text("""
        select distinct p.ticker from liga.posiciones p
        join liga.inscripciones i on i.id = p.inscripcion_id where i.jornada_id = :j
    """), {"j": jornada_id}).scalars())


def ejecutar(jornada_id: int, fabrica: Fabrica = fabrica_sistema,
             actor: str | None = None) -> dict:
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
                return _escribir(db, jornada_id, actor)
    except Exception as e:
        auditar_fallo(fabrica, "cerrar", f"jornada:{jornada_id}", e, actor)
        raise


def _escribir(db: Session, jornada_id: int, actor: str | None) -> dict:
    j = jornada_bloqueada(db, jornada_id)
    motivos = motivos_no_lista(db, j)
    if motivos:
        raise ErrorProceso(" ".join(motivos))
    omega.sincronizar(db, j, j.dia_fin, actor)
    calculo = calcular(db, j, j.dia_fin)
    errores = [f"{f['nombre']}: {f['error']}" for f in calculo["filas"] if f.get("error")]
    if errores:
        raise ErrorProceso("No se puede calcular: " + " · ".join(errores))
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
            {"resultados": len(calculo["filas"]), "sp_rentabilidad": calculo["sp_rentabilidad"]},
            actor)
    db.commit()
    return para_json({"jornada_id": j.id, "estado": j.estado, **calculo})
