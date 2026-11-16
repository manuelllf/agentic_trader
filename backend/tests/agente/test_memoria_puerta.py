"""Memoria (lecciones) y puerta de la filosofía, con revisor falso: sin red ni llamadas de pago."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import memoria, puerta
from app.agente.models import Decision, FichaMejora, Leccion, PlaybookVersion

HOY = date(2026, 11, 17)
FILOSOFIA = "# Filosofía\n\n" + "Elijo poco y con calma. " * 20


class Revisor:
    def __init__(self, *veredictos: str) -> None:
        self.veredictos = list(veredictos)
        self.llamadas: list[str] = []

    def chat(self, system: str, user: str, **_: object) -> str:
        self.llamadas.append(user)
        return json.dumps({"verdict": self.veredictos.pop(0), "reason": "motivo"})


def _vigente(s: Session) -> PlaybookVersion:
    p = PlaybookVersion(version=1, contenido=FILOSOFIA, motivo="nacimiento", estado="vigente")
    s.add(p)
    s.flush()
    return p


def _decision(s: Session, version_id: int | None = None, dia: date = HOY) -> int:
    d = Decision(fecha_ny=dia, tipo="nada", propuesta={}, razonamiento="sin novedades",
                 modelo="m", playbook_version_id=version_id)
    s.add(d)
    s.flush()
    return d.id


def _propuesta(**cambios: str) -> dict:
    return {"hypothesis": "Más paciencia mejora las entradas en mercados laterales.",
            "change": "Añado esperar dos cierres sobre la media antes de comprar.",
            "success_criterion": "Menos decisiones de operar sin perder tesis aprobadas.",
            "stop_rule": "Si deja pasar dos tesis aprobadas.",
            "new_philosophy": FILOSOFIA + "\nEspero dos cierres.", **cambios}


# Lecciones

def test_proponer_leccion_valida_texto_y_decisiones(sesion_agente: Session) -> None:
    s = sesion_agente
    d = _decision(s)
    with pytest.raises(ValueError):
        memoria.proponer_leccion(s, "corta", [d])
    with pytest.raises(ValueError):
        memoria.proponer_leccion(s, "Una lección suficientemente larga", [d + 999])
    with pytest.raises(ValueError):
        memoria.proponer_leccion(s, "Una lección suficientemente larga", [])
    assert memoria.proponer_leccion(s, "Una lección suficientemente larga", [d, d]) > 0


def test_revisor_aprueba_y_rechaza_y_solo_las_aprobadas_entran_al_ciclo(
        sesion_agente: Session) -> None:
    s = sesion_agente
    d = _decision(s)
    memoria.proponer_leccion(s, "Primera lección suficientemente larga", [d])
    memoria.proponer_leccion(s, "Segunda lección suficientemente larga", [d])
    assert memoria.revisar_lecciones(s, Revisor("approve", "reject")) == 1
    assert [x["lesson"] for x in memoria.lecciones_aprobadas(s)] == [
        "Primera lección suficientemente larga"]


def test_con_veinte_aprobadas_no_se_gasta_revisor(sesion_agente: Session) -> None:
    s = sesion_agente
    d = _decision(s)
    s.add_all(Leccion(texto=f"Lección {i}", decision_ids=[d], estado="aprobada")
              for i in range(memoria.MAX_LECCIONES))
    memoria.proponer_leccion(s, "Una más, suficientemente larga", [d])
    revisor = Revisor()
    assert memoria.revisar_lecciones(s, revisor) == 0
    assert revisor.llamadas == []


def test_retirar_solo_una_aprobada(sesion_agente: Session) -> None:
    s = sesion_agente
    d = _decision(s)
    fila = Leccion(texto="Lección aprobada", decision_ids=[d], estado="aprobada")
    s.add(fila)
    s.flush()
    memoria.retirar_leccion(s, fila.id, "ya no aplica")
    assert fila.estado == "retirada"
    with pytest.raises(ValueError):
        memoria.retirar_leccion(s, fila.id, "otra vez")


def test_decisiones_recientes_no_incluye_las_de_una_candidata(sesion_agente: Session) -> None:
    s = sesion_agente
    v = _vigente(s)
    cand = PlaybookVersion(version=2, contenido="x", motivo="m", estado="candidata")
    s.add(cand)
    s.flush()
    propia = _decision(s, v.id)
    _decision(s, cand.id)
    assert [x["id"] for x in memoria.decisiones_recientes(s)] == [propia]


# Puerta

def test_proponer_crea_candidata_y_ficha_y_bloquea_la_segunda(sesion_agente: Session) -> None:
    s = sesion_agente
    _vigente(s)
    ficha_id = puerta.proponer(s, HOY, _propuesta())
    ficha = s.get_one(FichaMejora, ficha_id)
    cand = s.get_one(PlaybookVersion, ficha.playbook_candidata_id)
    assert (ficha.estado, cand.estado, cand.version) == ("propuesta", "candidata", 2)
    with pytest.raises(ValueError, match="already active"):
        puerta.proponer(s, HOY, _propuesta(new_philosophy=FILOSOFIA + " otra"))


def test_proponer_exige_cambio_real_y_campos(sesion_agente: Session) -> None:
    s = sesion_agente
    _vigente(s)
    with pytest.raises(ValueError, match="identical"):
        puerta.proponer(s, HOY, _propuesta(new_philosophy=FILOSOFIA))
    with pytest.raises(ValueError, match="stop_rule"):
        puerta.proponer(s, HOY, _propuesta(stop_rule=""))


def test_una_propuesta_por_semana(sesion_agente: Session) -> None:
    s = sesion_agente
    _vigente(s)
    ficha = s.get_one(FichaMejora, puerta.proponer(s, HOY, _propuesta()))
    ficha.estado = "rechazada"
    s.flush()
    # `creado` es de hoy de verdad: se mira desde la fecha real.
    hoy_real = s.execute(text("select current_date")).scalar_one()
    with pytest.raises(ValueError, match="one proposal every"):
        puerta.proponer(s, hoy_real, _propuesta(new_philosophy=FILOSOFIA + " otra"))
    assert puerta.proponer(s, hoy_real + timedelta(days=8),
                           _propuesta(new_philosophy=FILOSOFIA + " otra")) > 0


def test_revisor_rechaza_y_la_candidata_queda_rechazada(sesion_agente: Session) -> None:
    s = sesion_agente
    _vigente(s)
    ficha = s.get_one(FichaMejora, puerta.proponer(s, HOY, _propuesta()))
    assert puerta.revisar_propuestas(s, HOY, Revisor("reject")) == 0
    assert ficha.estado == "rechazada"
    assert s.get_one(PlaybookVersion, ficha.playbook_candidata_id).estado == "rechazada"


def _en_sombra(s: Session) -> tuple[FichaMejora, PlaybookVersion, PlaybookVersion]:
    v = _vigente(s)
    ficha = s.get_one(FichaMejora, puerta.proponer(s, HOY, _propuesta()))
    assert puerta.revisar_propuestas(s, HOY, Revisor("approve")) == 1
    cand = s.get_one(PlaybookVersion, ficha.playbook_candidata_id)
    return ficha, v, cand


def test_aprobada_pasa_catorce_dias_en_sombra(sesion_agente: Session) -> None:
    s = sesion_agente
    ficha, _, cand = _en_sombra(s)
    assert (ficha.estado, ficha.sombra_desde, ficha.sombra_hasta) == (
        "en_sombra", HOY, HOY + timedelta(days=14))
    hallada = puerta.en_sombra(s)
    assert hallada is not None and hallada[1].id == cand.id


def test_la_sombra_no_se_cierra_antes_de_tiempo(sesion_agente: Session) -> None:
    s = sesion_agente
    _en_sombra(s)
    assert puerta.cerrar_sombras(s, HOY + timedelta(days=13), Revisor()) == 0


def test_al_acabar_se_adopta_y_se_puede_revertir(sesion_agente: Session) -> None:
    s = sesion_agente
    ficha, v, cand = _en_sombra(s)
    _decision(s, v.id, HOY + timedelta(days=1))
    _decision(s, cand.id, HOY + timedelta(days=1))
    revisor = Revisor("approve")
    assert puerta.cerrar_sombras(s, HOY + timedelta(days=14), revisor) == 1
    assert (v.estado, cand.estado, ficha.estado) == ("retirada", "vigente", "adoptada")
    assert ficha.resultado["decisiones_candidata"] == 1
    assert "Decisions of the candidate" in revisor.llamadas[0]
    assert puerta.revertible(s)
    assert puerta.revertir(s) == 1
    assert (v.estado, cand.estado, ficha.estado) == ("vigente", "retirada", "revertida")
    assert not puerta.revertible(s)
    with pytest.raises(ValueError):
        puerta.revertir(s)


def test_al_acabar_sin_aprobar_se_descarta(sesion_agente: Session) -> None:
    s = sesion_agente
    ficha, v, cand = _en_sombra(s)
    assert puerta.cerrar_sombras(s, HOY + timedelta(days=14), Revisor("reject")) == 0
    assert (v.estado, cand.estado, ficha.estado) == ("vigente", "rechazada", "descartada")
