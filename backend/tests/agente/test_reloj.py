from __future__ import annotations

from datetime import UTC, date, datetime, time

import pytest

from app.agente.config import AgenteSettings
from app.agente.reloj import (
    Tarea,
    clave,
    en_hora_punta_deepseek,
    pendientes_al_arrancar,
    programa_del_dia,
)
from app.mercado.calendario import TZ_NUEVA_YORK

LUNES = date(2026, 11, 16)
VIERNES = date(2026, 11, 13)
DIA_DE_ACCION_DE_GRACIAS = date(2026, 11, 26)


def ny(anio: int, mes: int, dia: int, hora: int, minuto: int = 0) -> datetime:
    return datetime(anio, mes, dia, hora, minuto, tzinfo=TZ_NUEVA_YORK)


def utc(anio: int, mes: int, dia: int, hora: int, minuto: int = 0) -> datetime:
    return datetime(anio, mes, dia, hora, minuto, tzinfo=UTC)


def test_programa_vacio_en_sabado() -> None:
    assert programa_del_dia(date(2026, 11, 14)) == []


def test_programa_vacio_en_festivo_de_la_nyse() -> None:
    assert programa_del_dia(DIA_DE_ACCION_DE_GRACIAS) == []


def test_programa_de_un_dia_normal_tiene_cinco_tareas_en_orden() -> None:
    programa = programa_del_dia(LUNES)

    assert [tarea for tarea, _ in programa] == [
        Tarea.VIGIA_PREVIO,
        Tarea.EJECUCION,
        Tarea.PREPARACION,
        Tarea.DESPERTAR,
        Tarea.CONSOLIDACION,
    ]
    assert [momento for _, momento in programa] == [
        ny(2026, 11, 16, 8, 45),
        ny(2026, 11, 16, 9, 35),
        ny(2026, 11, 16, 16, 30),
        ny(2026, 11, 16, 17, 30),
        ny(2026, 11, 16, 19, 30),
    ]
    assert all(momento.tzinfo is TZ_NUEVA_YORK for _, momento in programa)


@pytest.mark.parametrize("dia", [date(2026, 12, 15), date(2026, 7, 15)])
def test_ninguna_tarea_cae_en_hora_punta_de_deepseek(dia: date) -> None:
    # Invierno y verano: las horas de Nueva York deben aguantar el cambio de horario.
    for _, momento in programa_del_dia(dia):
        assert not en_hora_punta_deepseek(momento), momento


@pytest.mark.parametrize(
    ("momento", "esperado"),
    [
        (utc(2026, 11, 16, 1, 0), True),
        (utc(2026, 11, 16, 4, 0), False),
        (utc(2026, 11, 16, 5, 59), False),
        (utc(2026, 11, 16, 6, 0), True),
        (utc(2026, 11, 16, 9, 59), True),
        (utc(2026, 11, 14, 2, 0), False),
    ],
)
def test_hora_punta_deepseek_en_los_bordes(momento: datetime, esperado: bool) -> None:
    assert en_hora_punta_deepseek(momento) is esperado


def test_hora_punta_deepseek_exige_zona() -> None:
    with pytest.raises(ValueError):
        en_hora_punta_deepseek(datetime(2026, 11, 16, 2, 0))


def test_pendientes_del_lunes_al_mediodia_sin_nada_hecho() -> None:
    pendientes = pendientes_al_arrancar(ny(2026, 11, 16, 12, 0), set())

    assert pendientes == [
        (Tarea.DESPERTAR, VIERNES),
        (Tarea.CONSOLIDACION, VIERNES),
        (Tarea.VIGIA_PREVIO, LUNES),
        (Tarea.EJECUCION, LUNES),
    ]


def test_sin_pendientes_si_todo_esta_hecho() -> None:
    hechas = {
        clave(Tarea.VIGIA_PREVIO, LUNES),
        clave(Tarea.EJECUCION, LUNES),
        clave(Tarea.DESPERTAR, VIERNES),
        clave(Tarea.CONSOLIDACION, VIERNES),
    }

    assert pendientes_al_arrancar(ny(2026, 11, 16, 12, 0), hechas) == []


def test_no_recupera_la_ejecucion_del_dia_anterior() -> None:
    pendientes = pendientes_al_arrancar(ny(2026, 11, 17, 8, 0), set())

    assert Tarea.EJECUCION not in [tarea for tarea, _ in pendientes]


def test_recupera_la_preparacion_de_hoy_pero_no_la_de_ayer() -> None:
    hoy = [t for t, d in pendientes_al_arrancar(ny(2026, 11, 16, 17, 0), set()) if d == LUNES]
    manana = pendientes_al_arrancar(ny(2026, 11, 17, 8, 0), set())

    assert Tarea.PREPARACION in hoy
    assert Tarea.PREPARACION not in [tarea for tarea, _ in manana]


def test_tras_un_festivo_recupera_el_ultimo_dia_de_bolsa() -> None:
    # Jueves festivo: lo último programado es el miércoles 25 a las 23:30.
    pendientes = pendientes_al_arrancar(ny(2026, 11, 26, 12, 0), set())

    assert pendientes == [
        (Tarea.VIGIA_PREVIO, date(2026, 11, 25)),
        (Tarea.DESPERTAR, date(2026, 11, 25)),
        (Tarea.CONSOLIDACION, date(2026, 11, 25)),
    ]


def test_no_devuelve_dos_tareas_del_mismo_tipo() -> None:
    pendientes = pendientes_al_arrancar(ny(2026, 11, 18, 12, 0), set())

    tipos = [tarea for tarea, _ in pendientes]
    assert len(tipos) == len(set(tipos))


def test_pendientes_exige_zona() -> None:
    with pytest.raises(ValueError):
        pendientes_al_arrancar(datetime(2026, 11, 16, 12, 0), set())


def test_clave_tiene_formato_exacto() -> None:
    assert clave(Tarea.EJECUCION, LUNES) == "ejecucion:2026-11-16"


def test_config_lee_la_hora_de_una_variable_de_entorno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTE_HORA_DESPERTAR", "18:00")

    assert AgenteSettings().hora_despertar == time(18, 0)
