"""El escaneo con decisión corre el primer día de bolsa del mes, el mismo en que empieza la
jornada de la liga: si el 1 cae en fin de semana o festivo, el lunes siguiente."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import scheduler
from app.liga.motor.calendario import es_primer_dia_de_bolsa
from app.scheduler import trigger_escaneo_mensual

NY = ZoneInfo("America/New_York")


@pytest.mark.parametrize(("dia", "esperado"), [
    (date(2026, 10, 1), True),     # jueves
    (date(2026, 8, 3), True),      # el 1 fue sábado
    (date(2026, 8, 1), False),
    (date(2026, 11, 2), True),     # el 1 fue domingo
    (date(2026, 12, 1), True),
    (date(2027, 1, 1), False),     # festivo
    (date(2027, 1, 4), True),      # primer lunes tras el festivo y el fin de semana
    (date(2027, 1, 5), False),
    (date(2026, 10, 2), False),
])
def test_primer_dia_de_bolsa(dia, esperado):
    assert es_primer_dia_de_bolsa(dia) is esperado


def test_el_cron_solo_despierta_dias_laborables_de_la_primera_semana():
    trigger = trigger_escaneo_mensual()
    ahora = datetime(2026, 9, 27, 12, 0, tzinfo=NY)
    fechas, previa = [], None
    for _ in range(6):
        siguiente = trigger.get_next_fire_time(previa, ahora)
        fechas.append(siguiente.astimezone(NY).strftime("%Y-%m-%d %H:%M"))
        previa = ahora = siguiente
    assert fechas == ["2026-10-01 10:15", "2026-10-02 10:15", "2026-10-05 10:15",
                      "2026-10-06 10:15", "2026-10-07 10:15", "2026-11-02 10:15"]


def test_solo_el_primer_dia_de_bolsa_lanza_el_escaneo(monkeypatch):
    lanzados = []
    monkeypatch.setattr(scheduler, "_scan_job", lambda: lanzados.append(1))
    scheduler._escaneo_mensual_job(date(2026, 10, 2))
    scheduler._escaneo_mensual_job(date(2026, 10, 6))
    assert lanzados == []
    scheduler._escaneo_mensual_job(date(2026, 10, 1))
    assert lanzados == [1]
