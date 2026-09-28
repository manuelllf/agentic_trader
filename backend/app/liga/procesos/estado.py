"""El estado de los procesos para la pantalla de admin, sacado del dominio: temporadas, jornadas,
el interruptor del diario y el último intento de cada proceso (`liga.auditoria`)."""

from __future__ import annotations

from sqlalchemy import text

from app.liga.procesos import diario
from app.liga.procesos.comun import PROCESOS, Fabrica, fabrica_sistema, para_json, sesion


def _siguiente(j) -> str | None:  # noqa: ANN001 — fila de jornada
    if j.estado == "programada":
        return "foto" if j.foto_id is None or j.scan_run_id is None else "formar"
    if j.estado == "formada":
        return "cerrar"
    return None


def general(fabrica: Fabrica = fabrica_sistema) -> dict:
    with sesion(fabrica) as db:
        temporadas = db.execute(text(
            "select id, nombre, cuenta, n_jornadas, estado from liga.temporadas order by id")).all()
        jornadas = db.execute(text("""
            select j.id, j.temporada_id, j.numero, j.dia_base, j.dia_inicio, j.dia_fin,
                   j.cierre_inscripcion, j.estado, j.foto_id, j.scan_run_id, j.sp_rentabilidad,
                   (r.foto_id is distinct from j.foto_id) as plan_b,
                   (select count(*) from liga.inscripciones i where i.jornada_id = j.id)
                     as inscripciones
            from liga.jornadas j left join scan_runs r on r.id = j.scan_run_id
            order by j.dia_inicio, j.id
        """)).all()
        ultimos = {a.accion: a for a in db.execute(text("""
            select distinct on (accion) accion, objeto, detalle, creada from liga.auditoria
            where accion like 'proceso.%' order by accion, creada desc, id desc
        """)).all()}
        # Última designación de foto por jornada (auto o a mano) -- para que la pantalla lo diga
        # sin adivinar; None = nunca se le tocó la foto por proceso (dato viejo o migrado a mano).
        foto_auto = {a.objeto: bool((a.detalle or {}).get("auto")) for a in db.execute(text("""
            select distinct on (objeto) objeto, detalle from liga.auditoria
            where accion = 'proceso.foto' order by objeto, creada desc, id desc
        """)).all()}
        return para_json({
            "diario_activo": diario.activo(db),
            "temporadas": [{
                "id": t.id, "nombre": t.nombre, "cuenta": t.cuenta, "estado": t.estado,
                "n_jornadas": t.n_jornadas,
                "jornadas": [{
                    "id": j.id, "numero": j.numero, "dia_base": j.dia_base,
                    "dia_inicio": j.dia_inicio, "dia_fin": j.dia_fin,
                    "cierre_inscripcion": j.cierre_inscripcion, "estado": j.estado,
                    "foto_id": j.foto_id, "scan_run_id": j.scan_run_id,
                    "plan_b": j.plan_b if j.scan_run_id is not None else None,
                    "inscripciones": j.inscripciones, "sp_rentabilidad": j.sp_rentabilidad,
                    "siguiente": _siguiente(j),
                    "foto_auto": foto_auto.get(f"jornada:{j.id}") if j.foto_id is not None
                        else None,
                } for j in jornadas if j.temporada_id == t.id],
            } for t in temporadas],
            "ultimo_intento": {p: _intento(ultimos, p) for p in PROCESOS},
        })


def _intento(ultimos: dict, proceso: str) -> dict | None:
    ok, fallo = ultimos.get(f"proceso.{proceso}"), ultimos.get(f"proceso.{proceso}.fallo")
    ultimo = max((a for a in (ok, fallo) if a is not None), key=lambda a: a.creada, default=None)
    if ultimo is None:
        return None
    return {"cuando": ultimo.creada, "ok": ultimo is ok, "objeto": ultimo.objeto,
            "detalle": ultimo.detalle}
