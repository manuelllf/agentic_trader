"""El escaneo con decisión corre el primer martes de cada mes, como dicen Alpha y Beta."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.scheduler import trigger_escaneo_mensual

NY = ZoneInfo("America/New_York")


def test_primer_martes_de_cada_mes_a_las_10_15_de_nueva_york():
    trigger = trigger_escaneo_mensual()
    ahora = datetime(2026, 9, 27, 12, 0, tzinfo=NY)
    fechas = []
    previa = None
    for _ in range(4):
        siguiente = trigger.get_next_fire_time(previa, ahora)
        fechas.append(siguiente.astimezone(NY).strftime("%Y-%m-%d %H:%M"))
        previa = ahora = siguiente
    assert fechas == ["2026-10-06 10:15", "2026-11-03 10:15", "2026-12-01 10:15",
                      "2027-01-05 10:15"]
