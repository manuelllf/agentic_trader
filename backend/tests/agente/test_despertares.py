"""Revisión diaria del cierre y despertares que se programa el agente: topes y vencimiento."""

from __future__ import annotations

from dataclasses import replace
from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agente import despertares, herramientas, prompts, tareas
from app.agente.config import ajustes
from app.agente.models import Despertar, Ejecucion, Evento
from app.agente.reloj import Tarea

LUNES = date(2026, 11, 16)
MARTES = date(2026, 11, 17)
JUEVES_FESTIVO = date(2026, 11, 26)  # Acción de Gracias


def _ej(s: Session, dia: date, tarea: Tarea = Tarea.DESPERTAR) -> Ejecucion:
    ej = Ejecucion(tarea=tarea.value, fecha_ny=dia)
    s.add(ej)
    s.flush()
    return ej


def _ciclo_lanzado(s: Session, dia: date) -> None:
    tareas.evento(s, "vigia", "ciclo_pendiente", ejecucion_id=_ej(s, dia).id)


def _programar(s: Session, fecha: date, hoy: date = LUNES, motivo: str = "mirar") -> Despertar:
    return despertares.programar(s, hoy, fecha, motivo, None)


@pytest.mark.parametrize(("fecha", "error"), [
    (LUNES, "future trading day"),
    (date(2026, 11, 21), "not a trading day"),
    (JUEVES_FESTIVO, "not a trading day"),
    (date(2027, 6, 1), "beyond the horizon"),
])
def test_programar_rechaza_fechas_fuera_de_regla(sesion_agente: Session, fecha: date,
                                                 error: str) -> None:
    with pytest.raises(ValueError, match=error):
        _programar(sesion_agente, fecha)


def test_horizonte_cuenta_dias_de_bolsa() -> None:
    # 60 sesiones desde el martes 17-nov, con Acción de Gracias, Navidad, Año Nuevo y MLK fuera.
    assert despertares.horizonte(LUNES) == date(2027, 2, 12)


def test_programar_rechaza_motivo_vacio_y_dia_repetido(sesion_agente: Session) -> None:
    s = sesion_agente
    with pytest.raises(ValueError, match="reason"):
        _programar(s, MARTES, motivo="  ")
    d = _programar(s, MARTES)
    with pytest.raises(ValueError, match=f"wake-up {d.id} is already scheduled"):
        _programar(s, MARTES, motivo="otro")


def test_cupo_semanal_cuenta_los_cancelados(sesion_agente: Session,
                                            monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "despertares_semana_max", 2)
    a = _programar(s, MARTES)
    despertares.cancelar(s, a.id, "ya no hace falta")
    _programar(s, date(2026, 11, 18))
    with pytest.raises(ValueError, match="weekly limit of 2"):
        _programar(s, date(2026, 11, 19))
    # La semana siguiente el cupo vuelve a empezar.
    _programar(s, date(2026, 11, 30), hoy=date(2026, 11, 23))


def test_tope_de_pendientes(sesion_agente: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "despertares_pendientes_max", 2)
    _programar(s, MARTES)
    _programar(s, date(2026, 11, 18))
    with pytest.raises(ValueError, match="already 2 pending"):
        _programar(s, date(2026, 11, 19))


def test_cancelar_solo_pendientes(sesion_agente: Session) -> None:
    s = sesion_agente
    with pytest.raises(ValueError, match="no pending wake-up"):
        despertares.cancelar(s, 999_999, "x")
    d = _programar(s, MARTES)
    despertares.cancelar(s, d.id, "cambio de plan")
    assert (d.estado, d.cancelado_motivo) == ("cancelado", "cambio de plan")
    with pytest.raises(ValueError, match="no pending wake-up"):
        despertares.cancelar(s, d.id, "otra vez")


def test_sin_alertas_ni_despertares_la_revision_es_diaria(sesion_agente: Session,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "ia_activa", False)
    _ciclo_lanzado(s, LUNES)
    ej = _ej(s, MARTES)
    tareas.hacer_despertar(s, ej, MARTES, lambda t, desde: {})
    assert despertares.razones_de(s, ej.id) == {"daily_review": True, "alerts": False,
                                                "scheduled": []}


def test_vencer_cierra_los_de_hoy_y_los_atrasados(sesion_agente: Session) -> None:
    s = sesion_agente
    a = _programar(s, MARTES, motivo="resultados")
    b = _programar(s, date(2026, 11, 18), motivo="después")
    c = _programar(s, date(2026, 11, 19), motivo="más tarde")
    # El miércoles no hubo revisión: el jueves vence también el atrasado del martes.
    ej = _ej(s, date(2026, 11, 18))
    r = despertares.razones(s, date(2026, 11, 18), ej.id, False)
    assert [x["id"] for x in r["scheduled"]] == [a.id, b.id]
    assert (a.estado, a.cerrado_en_ejecucion, c.estado) == ("hecho", ej.id, "pendiente")


def test_revision_de_cierre_despierta_por_un_despertar_propio(
        sesion_agente: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "ia_activa", False)
    _ciclo_lanzado(s, LUNES)
    d = _programar(s, MARTES, motivo="ver si el precio aguanta")
    ej = _ej(s, MARTES)
    tareas.hacer_despertar(s, ej, MARTES, lambda t, desde: {})
    ev = list(s.execute(select(Evento).where(Evento.ejecucion_id == ej.id)
                        .order_by(Evento.id)).scalars())
    assert [e.tipo for e in ev] == ["ciclo_pendiente", "ia_apagada"]
    assert ev[0].datos["scheduled"][0]["reason"] == "ver si el precio aguanta"
    assert despertares.razones_de(s, ej.id) == ev[0].datos
    assert d.estado == "hecho"


def test_herramientas_programan_y_cancelan(sesion_agente: Session) -> None:
    s = sesion_agente
    ctx = herramientas.Contexto(hoy=LUNES, ejecucion_id=_ej(s, LUNES).id)
    r = herramientas.ejecutar(s, "schedule_wakeup", {"date": "2026-11-18", "reason": "mirar"}, ctx)
    assert r["date"] == "2026-11-18" and r["limits"]["new_this_week"] == 1
    assert [p["id"] for p in r["pending"]] == [r["wakeup_id"]]
    mal = herramientas.ejecutar(s, "schedule_wakeup", {"date": "18/11", "reason": "x"}, ctx)
    assert mal == {"error": "ValueError: date must be YYYY-MM-DD"}
    c = herramientas.ejecutar(s, "cancel_wakeup", {"wakeup_id": r["wakeup_id"],
                                                   "reason": "no hace falta"}, ctx)
    assert c == {"wakeup_id": r["wakeup_id"], "status": "cancelled", "pending": []}
    solo = herramientas.ejecutar(s, "schedule_wakeup", {"date": "2026-11-18", "reason": "x"},
                                 replace(ctx, solo_lectura=True))
    assert "read-only" in solo["error"]


def test_prompt_lleva_razones_despertares_y_topes(sesion_agente: Session) -> None:
    s = sesion_agente
    _programar(s, MARTES, motivo="resultados de AAA")
    texto = prompts.usuario_ciclo(LUNES, "f", {}, [], [], "", None, None,
                                  {"daily_review": True, "alerts": False, "scheduled": []},
                                  despertares.pendientes(s), despertares.topes(s, LUNES))
    assert '"daily_review": true' in texto
    assert "resultados de AAA" in texto
    assert '"latest_date": "2027-02-12"' in texto
