"""Puerta de la filosofía: un cambio se propone con hipótesis, criterio de éxito y regla de parada;
el revisor lo admite a prueba, la candidata decide 14 días en sombra junto a la vigente y al final
se adopta o se descarta. Una propuesta activa como mucho y una por semana."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.agente import prompts, revisor
from app.agente.models import FichaMejora, PlaybookVersion

DIAS_SOMBRA = 14
DIAS_ENTRE_PROPUESTAS = 7
ACTIVAS = ("propuesta", "en_sombra")
_CAMPOS = (("hypothesis", 20, 1000), ("change", 20, 1000), ("success_criterion", 20, 1000),
           ("stop_rule", 10, 1000), ("new_philosophy", 200, 20000))


def _texto(a: dict, campo: str, minimo: int, maximo: int) -> str:
    v = str(a.get(campo) or "").strip()
    if not minimo <= len(v) <= maximo:
        raise ValueError(f"{campo} must be {minimo} to {maximo} characters")
    return v


def vigente(s: Session) -> PlaybookVersion | None:
    s.flush()
    return s.execute(select(PlaybookVersion).where(PlaybookVersion.estado == "vigente")
                     ).scalar_one_or_none()


def proponer(s: Session, hoy: date, a: dict) -> int:
    """Crea la ficha de mejora y la versión candidata. Devuelve el id de la ficha."""
    hipotesis, cambio, criterio, parada, nueva = (_texto(a, *c) for c in _CAMPOS)
    actual = vigente(s)
    if actual is None:
        raise ValueError("there is no current philosophy to change")
    if nueva == actual.contenido.strip():
        raise ValueError("new_philosophy is identical to the current one")
    activa = s.execute(select(FichaMejora.id).where(FichaMejora.estado.in_(ACTIVAS))).first()
    if activa is not None:
        raise ValueError("another proposal is already active")
    ultima = s.execute(select(func.max(FichaMejora.creado))).scalar()
    if ultima is not None and ultima.date() > hoy - timedelta(days=DIAS_ENTRE_PROPUESTAS):
        raise ValueError(f"at most one proposal every {DIAS_ENTRE_PROPUESTAS} days")
    numero = (s.execute(select(func.max(PlaybookVersion.version))).scalar() or 0) + 1
    candidata = PlaybookVersion(version=numero, contenido=nueva, diferencia=cambio,
                                motivo=f"Propuesta: {hipotesis[:200]}", estado="candidata")
    s.add(candidata)
    s.flush()
    ficha = FichaMejora(hipotesis=hipotesis, cambio=cambio, criterio_exito=criterio,
                        regla_parada=parada, playbook_candidata_id=candidata.id)
    s.add(ficha)
    s.flush()
    return ficha.id


def en_sombra(s: Session) -> tuple[FichaMejora, PlaybookVersion] | None:
    s.flush()
    ficha = s.execute(select(FichaMejora).where(FichaMejora.estado == "en_sombra")).scalar()
    if ficha is None or ficha.playbook_candidata_id is None:
        return None
    return ficha, s.get_one(PlaybookVersion, ficha.playbook_candidata_id)


def _cerrar_candidata(s: Session, ficha: FichaMejora, estado_ficha: str, motivo: str) -> None:
    ficha.estado = estado_ficha
    ficha.revisor_motivo = motivo[:500]
    if ficha.playbook_candidata_id is not None:
        s.get_one(PlaybookVersion, ficha.playbook_candidata_id).estado = "rechazada"
    s.flush()


def revisar_propuestas(s: Session, hoy: date, llm: Any) -> int:  # noqa: ANN401
    """Las propuestas pendientes pasan a sombra o se rechazan. Devuelve cuántas entran en sombra."""
    actual = vigente(s)
    hechas = 0
    for ficha in s.execute(select(FichaMejora).where(FichaMejora.estado == "propuesta")
                           ).scalars().all():
        cand = s.get_one(PlaybookVersion, ficha.playbook_candidata_id)
        usuario = (f"## Current philosophy\n{actual.contenido if actual else '(none)'}\n\n"
                   f"## Candidate philosophy\n{cand.contenido}\n\n"
                   f"## Hypothesis\n{ficha.hipotesis}\n\n## Change\n{ficha.cambio}\n\n"
                   f"## Success criterion\n{ficha.criterio_exito}\n\n"
                   f"## Stop rule\n{ficha.regla_parada}\n")
        veredicto, motivo = revisor.juzgar(prompts.SYSTEM_REVISOR_MEJORA, usuario, llm)
        ficha.revisor_veredicto = veredicto
        if veredicto != "aprobada":
            _cerrar_candidata(s, ficha, "rechazada", motivo)
            continue
        ficha.estado, ficha.revisor_motivo = "en_sombra", motivo[:500]
        ficha.sombra_desde, ficha.sombra_hasta = hoy, hoy + timedelta(days=DIAS_SOMBRA)
        hechas += 1
    s.flush()
    return hechas


def _decisiones(s: Session, version_id: int | None, desde: date, hasta: date) -> list[dict]:
    filas = s.execute(text(
        "select fecha_ny, tipo, propuesta, razonamiento, revisor_veredicto "
        "from agente.decisiones where playbook_version_id is not distinct from :v "
        "and fecha_ny between :d and :h order by fecha_ny, id"),
        {"v": version_id, "d": desde, "h": hasta}).all()
    return [{"date": f.fecha_ny.isoformat(), "type": f.tipo, "operations":
             (f.propuesta or {}).get("operaciones", []), "reasoning": f.razonamiento[:800],
             "review": f.revisor_veredicto} for f in filas]


def cerrar_sombras(s: Session, hoy: date, llm: Any) -> int:  # noqa: ANN401
    """Al acabar los 14 días, el revisor compara y se adopta o se descarta. Devuelve adopciones."""
    adoptadas = 0
    for ficha in s.execute(select(FichaMejora).where(
            FichaMejora.estado == "en_sombra", FichaMejora.sombra_hasta <= hoy)).scalars().all():
        cand = s.get_one(PlaybookVersion, ficha.playbook_candidata_id)
        actual = vigente(s)
        assert ficha.sombra_desde is not None and ficha.sombra_hasta is not None
        de_vigente = _decisiones(s, actual.id if actual else None, ficha.sombra_desde,
                                 ficha.sombra_hasta)
        de_candidata = _decisiones(s, cand.id, ficha.sombra_desde, ficha.sombra_hasta)
        resultado = {"decisiones_vigente": len(de_vigente),
                     "decisiones_candidata": len(de_candidata),
                     "vigente_previa_id": actual.id if actual else None}
        usuario = (f"## Current philosophy\n{actual.contenido if actual else '(none)'}\n\n"
                   f"## Candidate philosophy\n{cand.contenido}\n\n"
                   f"## Success criterion\n{ficha.criterio_exito}\n\n"
                   f"## Stop rule\n{ficha.regla_parada}\n\n"
                   f"## Decisions of the current version\n"
                   f"{json.dumps(de_vigente, ensure_ascii=False, default=str)}\n\n"
                   f"## Decisions of the candidate\n"
                   f"{json.dumps(de_candidata, ensure_ascii=False, default=str)}\n")
        veredicto, motivo = revisor.juzgar(prompts.SYSTEM_REVISOR_SOMBRA, usuario, llm)
        ficha.resultado = {**resultado, "veredicto": veredicto}
        if veredicto != "aprobada":
            _cerrar_candidata(s, ficha, "descartada", motivo)
            continue
        if actual is not None:
            # Solo una vigente: la anterior se retira antes de adoptar la nueva.
            actual.estado = "retirada"
            s.flush()
        cand.estado, cand.adoptada_en = "vigente", func.now()
        ficha.estado, ficha.revisor_motivo = "adoptada", motivo[:500]
        adoptadas += 1
    s.flush()
    return adoptadas


def _adopcion_reversible(s: Session) -> tuple[FichaMejora, PlaybookVersion, int] | None:
    """La última adopción, si la versión que adoptó sigue vigente y se sabe cuál había antes."""
    ficha = s.execute(select(FichaMejora).where(FichaMejora.estado == "adoptada")
                      .order_by(FichaMejora.id.desc())).scalar()
    previa_id = (ficha.resultado or {}).get("vigente_previa_id") if ficha else None
    actual = vigente(s)
    if ficha is None or previa_id is None or actual is None \
            or actual.id != ficha.playbook_candidata_id:
        return None
    return ficha, actual, int(previa_id)


def revertible(s: Session) -> bool:
    return _adopcion_reversible(s) is not None


def revertir(s: Session) -> int:
    """Deshace la última adopción: vuelve la versión que estaba vigente antes. Lo decide Manuel."""
    hallada = _adopcion_reversible(s)
    if hallada is None:
        raise ValueError("no adoption to revert")
    ficha, actual, previa_id = hallada
    actual.estado = "retirada"
    s.flush()
    previa = s.get_one(PlaybookVersion, previa_id)
    previa.estado, previa.adoptada_en = "vigente", func.now()
    ficha.estado = "revertida"
    s.flush()
    return previa.version
