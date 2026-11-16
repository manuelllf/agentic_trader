"""Memoria del agente: lecciones aprobadas por el revisor y el resumen de sus últimas decisiones.
El diario (decisiones) y las fichas viven en sus tablas; aquí se decide qué entra en cada ciclo."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.agente import prompts, revisor
from app.agente.models import Leccion

MAX_LECCIONES = 20
MAX_PROPUESTAS = 3
RECIENTES = 5
RECORTE = 400
LARGO_LECCION = (20, 600)


def lecciones_aprobadas(s: Session) -> list[dict]:
    s.flush()
    filas = s.execute(select(Leccion).where(Leccion.estado == "aprobada")
                      .order_by(Leccion.id)).scalars()
    return [{"id": f.id, "lesson": f.texto} for f in filas]


def decisiones_recientes(s: Session, n: int = RECIENTES) -> list[dict]:
    """Las últimas de la filosofía vigente o de las retiradas; las de una candidata en prueba no
    son suyas todavía y no cuentan como memoria."""
    s.flush()
    filas = s.execute(text(
        "select d.id, d.fecha_ny, d.tipo, d.revisor_veredicto, d.razonamiento "
        "from agente.decisiones d left join agente.playbook_versiones p "
        "on p.id = d.playbook_version_id "
        "where p.id is null or p.estado in ('vigente', 'retirada') "
        "order by d.fecha_ny desc, d.id desc limit :n"), {"n": n}).all()
    return [{"id": f.id, "date": f.fecha_ny.isoformat(), "type": f.tipo,
             "review": f.revisor_veredicto, "reasoning": f.razonamiento[:RECORTE]} for f in filas]


def proponer_leccion(s: Session, texto: str, decision_ids: Any) -> int:  # noqa: ANN401
    texto = str(texto).strip()
    if not LARGO_LECCION[0] <= len(texto) <= LARGO_LECCION[1]:
        raise ValueError(f"lesson must be {LARGO_LECCION[0]} to {LARGO_LECCION[1]} characters")
    if (not isinstance(decision_ids, list) or not decision_ids
            or not all(isinstance(i, int) and not isinstance(i, bool) for i in decision_ids)):
        raise ValueError("decision_ids must be a non-empty list of decision ids")
    ids = sorted(set(decision_ids))
    s.flush()
    existen = s.execute(text("select count(*) from agente.decisiones where id = any(:i)"),
                        {"i": ids}).scalar_one()
    if existen != len(ids):
        raise ValueError("some decision_ids do not exist")
    pendientes = s.execute(select(func.count()).select_from(Leccion)
                           .where(Leccion.estado == "propuesta")).scalar_one()
    if pendientes >= MAX_PROPUESTAS:
        raise ValueError(f"already {MAX_PROPUESTAS} lessons waiting for review")
    fila = Leccion(texto=texto, decision_ids=ids)
    s.add(fila)
    s.flush()
    return fila.id


def retirar_leccion(s: Session, leccion_id: Any, motivo: str) -> None:  # noqa: ANN401
    s.flush()
    fila = s.get(Leccion, leccion_id) if isinstance(leccion_id, int) else None
    if fila is None or fila.estado != "aprobada":
        raise ValueError("no approved lesson with that id")
    fila.estado = "retirada"
    fila.revisor_motivo = f"Retirada por el agente: {str(motivo).strip()[:300]}"
    s.flush()


def _decisiones(s: Session, ids: list[int]) -> list[dict]:
    filas = s.execute(text(
        "select id, fecha_ny, tipo, propuesta, razonamiento, revisor_veredicto "
        "from agente.decisiones where id = any(:i) order by id"), {"i": ids}).all()
    return [{"id": f.id, "date": f.fecha_ny.isoformat(), "type": f.tipo,
             "proposal": f.propuesta, "reasoning": f.razonamiento,
             "review": f.revisor_veredicto} for f in filas]


def revisar_lecciones(s: Session, llm: Any) -> int:  # noqa: ANN401
    """El revisor juzga las propuestas pendientes; devuelve cuántas quedan aprobadas."""
    s.flush()
    aprobadas = len(lecciones_aprobadas(s))
    hechas = 0
    for fila in s.execute(select(Leccion).where(Leccion.estado == "propuesta")
                          .order_by(Leccion.id)).scalars().all():
        if aprobadas >= MAX_LECCIONES:
            # Sin hueco no se gasta en el revisor: el agente tiene que retirar una antes.
            fila.estado, fila.revisor_motivo = "retirada", f"Ya hay {MAX_LECCIONES} aprobadas."
            continue
        citadas = json.dumps(_decisiones(s, fila.decision_ids), ensure_ascii=False, default=str)
        usuario = f"## Proposed lesson\n{fila.texto}\n\n## Cited decisions\n{citadas}"
        veredicto, motivo = revisor.juzgar(prompts.SYSTEM_REVISOR_LECCION, usuario, llm)
        fila.estado = "aprobada" if veredicto == "aprobada" else "retirada"
        fila.revisor_motivo = motivo[:500]
        if fila.estado == "aprobada":
            aprobadas += 1
            hechas += 1
    s.flush()
    return hechas
