"""El escaneo con decisión corre el último día de bolsa del mes, tras el cierre (16:45 de Nueva
York), para que la jornada siguiente tenga notas oficiales antes de su corte, a las 18:00 ET."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import scheduler
from app.config import Settings, settings
from app.liga.motor.calendario import es_ultimo_dia_de_bolsa
from app.scheduler import trigger_escaneo_mensual

NY = ZoneInfo("America/New_York")


def _proximos(trigger, desde: datetime, cuantos: int) -> list[str]:
    fechas, previa, ahora = [], None, desde
    for _ in range(cuantos):
        siguiente = trigger.get_next_fire_time(previa, ahora)
        fechas.append(siguiente.astimezone(NY).strftime("%Y-%m-%d %H:%M"))
        previa = ahora = siguiente
    return fechas


def test_las_horas_por_defecto_son_las_de_la_config_y_no_las_del_env(monkeypatch):
    """Mercado siempre en hora de Nueva York: el escaneo, a las 16:45."""
    defecto = Settings.model_fields
    assert (defecto["scan_cron_hour"].default, defecto["scan_cron_minute"].default) == (16, 45)
    assert defecto["scan_timezone"].default == "America/New_York"


def test_el_cron_solo_despierta_dias_laborables_del_final_del_mes_a_las_1645_de_nueva_york(
        monkeypatch):
    # El .env de cada máquina no puede cambiar lo que comprueba el test.
    monkeypatch.setattr(settings, "scan_cron_hour", 16)
    monkeypatch.setattr(settings, "scan_cron_minute", 45)
    monkeypatch.setattr(settings, "scan_timezone", "America/New_York")
    fechas = _proximos(trigger_escaneo_mensual(), datetime(2026, 9, 23, 12, 0, tzinfo=NY), 6)
    assert fechas == ["2026-09-24 16:45", "2026-09-25 16:45", "2026-09-28 16:45",
                      "2026-09-29 16:45", "2026-09-30 16:45", "2026-10-26 16:45"]


@pytest.mark.parametrize(("dia", "lanza"), [
    (date(2026, 9, 30), True),       # miércoles
    (date(2026, 9, 29), False),
    (date(2026, 10, 30), True),      # viernes: el 31 es sábado
    (date(2026, 10, 29), False),
    (date(2027, 5, 28), True),       # el 31 es festivo
])
def test_solo_el_ultimo_dia_de_bolsa_lanza_el_escaneo(monkeypatch, dia, lanza):
    lanzados = []
    monkeypatch.setattr(scheduler, "_scan_job", lambda: lanzados.append(1))
    scheduler._escaneo_mensual_job(dia)
    assert lanzados == ([1] if lanza else [])
    assert es_ultimo_dia_de_bolsa(dia) is lanza
