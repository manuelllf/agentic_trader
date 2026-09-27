"""Designar la foto de la jornada (plan §8): `jornadas.foto_id` (una `public.foto` completa) y
`jornadas.scan_run_id` (el escaneo de decisión que puso las 4 notas de Jev sobre ella).

Plan B: si esa foto no tiene escaneo de decisión con notas, la jornada usa la foto nueva y las
notas del escaneo de decisión anterior. No hace falta guardarlo aparte: es plan B cuando el
escaneo apunta a otra foto que la jornada (`es_plan_b`), y así lo puede decir la UI.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.models import Jornada
from app.liga.procesos import datos
from app.liga.procesos.comun import (
    ErrorProceso,
    Fabrica,
    NoEncontrado,
    auditar,
    auditar_fallo,
    candado,
    fabrica_sistema,
    jornada,
    jornada_bloqueada,
    para_json,
    sesion,
)


@dataclass(frozen=True)
class Designacion:
    foto_id: int
    scan_run_id: int
    plan_b: bool
    n_empresas: int
    n_notas: int
    avisos: tuple[str, ...]


def es_plan_b(db: Session, j: Jornada) -> bool | None:
    """None si aún no tiene escaneo."""
    if j.scan_run_id is None:
        return None
    foto_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                              {"s": j.scan_run_id}).scalar()
    return foto_escaneo != j.foto_id


def _foto(db: Session, foto_id: int | None):  # noqa: ANN202 — fila de public.foto
    if foto_id is None:
        fila = db.execute(text(
            "select id, inicio, fin, estado from foto where estado = 'completa' "
            "order by fin desc, id desc limit 1")).one_or_none()
        if fila is None:
            raise ErrorProceso("No hay ninguna foto completa. Lánzala desde Alpha.")
        return fila
    fila = db.execute(text("select id, inicio, fin, estado from foto where id = :f"),
                      {"f": foto_id}).one_or_none()
    if fila is None:
        raise NoEncontrado(f"No existe la foto {foto_id}.")
    if fila.estado != "completa":
        raise ErrorProceso(f"La foto {foto_id} está «{fila.estado}»: solo vale una completa.")
    return fila


_ESCANEOS = """
    select r.id, r.scan_at, r.foto_id from scan_runs r
    where r.decide and r.error is null {filtro}
      and exists (select 1 from scan_audit a
                  where a.scan_run_id = r.id and a.jev_fundamentals is not null)
    order by r.scan_at desc, r.id desc limit 1
"""


def _escaneo(db: Session, foto, scan_run_id: int | None) -> tuple[int, list[str]]:  # noqa: ANN001
    if scan_run_id is not None:
        fila = db.execute(text("select id, decide, error from scan_runs where id = :s"),
                          {"s": scan_run_id}).one_or_none()
        if fila is None:
            raise NoEncontrado(f"No existe el escaneo {scan_run_id}.")
        if not fila.decide or fila.error is not None:
            raise ErrorProceso(f"El escaneo {scan_run_id} no es de decisión o terminó con error.")
        if datos.n_notas(db, scan_run_id) == 0:
            raise ErrorProceso(f"El escaneo {scan_run_id} no tiene notas de Jev.")
        return scan_run_id, []
    propio = db.execute(text(_ESCANEOS.format(filtro="and r.foto_id = :f")),
                        {"f": foto.id}).one_or_none()
    if propio is not None:
        return propio.id, []
    anterior = db.execute(text(_ESCANEOS.format(filtro="and r.scan_at < :inicio")),
                          {"inicio": foto.inicio}).one_or_none()
    if anterior is None:
        raise ErrorProceso("No hay escaneo de decisión con notas de Jev, ni de esta foto ni "
                           "anterior.")
    return anterior.id, [f"Plan B: la foto {foto.id} no tiene escaneo de decisión con notas; "
                         f"se usan las del escaneo {anterior.id}."]


def _designar(db: Session, j: Jornada, foto_id: int | None,
              scan_run_id: int | None) -> Designacion:
    if j.estado != "programada":
        raise ErrorProceso(f"La jornada {j.id} ya está {j.estado}: su foto no se cambia.")
    foto = _foto(db, foto_id)
    sid, avisos = _escaneo(db, foto, scan_run_id)
    foto_escaneo = db.execute(text("select foto_id from scan_runs where id = :s"),
                              {"s": sid}).scalar()
    if foto.fin > j.cierre_inscripcion:
        avisos.append("La foto se terminó después del corte: la cartera usará datos posteriores "
                      "al día base.")
    n_empresas = db.execute(text(
        "select count(distinct ticker) from fundamentals_snapshot where foto_id = :f"),
        {"f": foto.id}).scalar()
    if n_empresas == 0:
        raise ErrorProceso(f"La foto {foto.id} no tiene empresas.")
    return Designacion(foto.id, sid, foto_escaneo != foto.id, n_empresas,
                       datos.n_notas(db, sid), tuple(avisos))


def _salida(j: Jornada, d: Designacion, **extra: object) -> dict:
    return para_json({"jornada_id": j.id, "foto_id": d.foto_id, "scan_run_id": d.scan_run_id,
                      "plan_b": d.plan_b, "empresas": d.n_empresas, "con_notas": d.n_notas,
                      "avisos": list(d.avisos), **extra})


def estado(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        return para_json({"jornada_id": j.id, "estado": j.estado, "foto_id": j.foto_id,
                          "scan_run_id": j.scan_run_id, "plan_b": es_plan_b(db, j)})


def vista_previa(jornada_id: int, foto_id: int | None = None, scan_run_id: int | None = None,
                 fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        j = jornada(db, jornada_id)
        return _salida(j, _designar(db, j, foto_id, scan_run_id),
                       actual={"foto_id": j.foto_id, "scan_run_id": j.scan_run_id})


def ejecutar(jornada_id: int, foto_id: int | None = None, scan_run_id: int | None = None,
             fabrica: Fabrica = fabrica_sistema, actor: str | None = None) -> dict:
    try:
        with candado("foto", fabrica), sesion(fabrica) as db:
            j = jornada_bloqueada(db, jornada_id)
            d = _designar(db, j, foto_id, scan_run_id)
            cambia = (j.foto_id, j.scan_run_id) != (d.foto_id, d.scan_run_id)
            if cambia:
                j.foto_id, j.scan_run_id = d.foto_id, d.scan_run_id
                auditar(db, "proceso.foto", f"jornada:{j.id}",
                        {"foto_id": d.foto_id, "scan_run_id": d.scan_run_id,
                         "plan_b": d.plan_b}, actor)
            db.commit()
            return _salida(j, d, cambiada=cambia)
    except Exception as e:
        auditar_fallo(fabrica, "foto", f"jornada:{jornada_id}", e, actor)
        raise
