"""Calendario de la NYSE para las jornadas: festivos, fines de semana y cierre de inscripción."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.liga.motor.calendario import (
    TZ_NUEVA_YORK,
    dias_de_bolsa,
    es_dia_de_bolsa,
    es_ultimo_dia_de_bolsa,
    jornada_del_mes,
)


def test_enero_2027_salta_el_festivo_de_anio_nuevo_y_el_fin_de_semana():
    """El 1 de enero de 2027 es viernes y festivo; el 2 y el 3, fin de semana."""
    j = jornada_del_mes(2027, 1)
    assert j.dia_base == date(2026, 12, 31)
    assert j.dia_inicio == date(2027, 1, 4)
    assert j.dia_fin == date(2027, 1, 29)            # el 30 y el 31 son fin de semana
    assert not es_dia_de_bolsa(date(2027, 1, 1))


def test_mes_que_empieza_en_fin_de_semana():
    """Agosto de 2026 empieza en sábado; el día base es el viernes 31 de julio."""
    j = jornada_del_mes(2026, 8)
    assert j.dia_base == date(2026, 7, 31)
    assert j.dia_inicio == date(2026, 8, 3)
    assert j.dia_fin == date(2026, 8, 31)


def test_mes_anterior_que_acaba_en_fin_de_semana():
    j = jornada_del_mes(2026, 11)
    assert j.dia_base == date(2026, 10, 30)          # el 31 de octubre es sábado
    assert j.dia_inicio == date(2026, 11, 2)


@pytest.mark.parametrize(("anio", "viernes_santo", "dia_base"), [
    (2024, date(2024, 3, 29), date(2024, 3, 28)),
    (2029, date(2029, 3, 30), date(2029, 3, 29)),
])
def test_viernes_santo_al_final_de_mes_adelanta_el_dia_base(anio, viernes_santo, dia_base):
    assert not es_dia_de_bolsa(viernes_santo)
    assert jornada_del_mes(anio, 4).dia_base == dia_base
    assert jornada_del_mes(anio, 3).dia_fin == dia_base


def test_viernes_santo_a_mitad_de_mes_no_cuenta_como_dia_de_bolsa():
    assert not es_dia_de_bolsa(date(2026, 4, 3))
    assert date(2026, 4, 3) not in dias_de_bolsa(date(2026, 4, 1), date(2026, 4, 30))


def test_memorial_day_al_final_de_mes_adelanta_el_dia_fin():
    assert jornada_del_mes(2027, 5).dia_fin == date(2027, 5, 28)   # el 31 es festivo


def test_dias_de_bolsa_incluye_los_extremos_y_salta_el_4_de_julio_observado():
    """El 4 de julio de 2026 es sábado: la bolsa cierra el viernes 3."""
    assert dias_de_bolsa(date(2026, 7, 1), date(2026, 7, 7)) == [
        date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 6), date(2026, 7, 7)]
    assert dias_de_bolsa(date(2026, 7, 4), date(2026, 7, 5)) == []


def test_el_corte_es_las_1800_de_nueva_york_del_dia_base_en_invierno_y_en_verano():
    invierno = jornada_del_mes(2027, 1).cierre_inscripcion
    assert invierno.tzinfo is not None
    assert invierno.astimezone(UTC) == datetime(2026, 12, 31, 23, 0, tzinfo=UTC)
    verano = jornada_del_mes(2026, 7).cierre_inscripcion
    assert verano == datetime(2026, 6, 30, 18, 0, tzinfo=TZ_NUEVA_YORK)
    assert verano.utcoffset() == timedelta(hours=-4)


def test_el_corte_cae_siempre_despues_del_escaneo_y_antes_de_la_apertura():
    for mes in range(1, 13):
        j = jornada_del_mes(2027, mes)
        apertura = datetime.combine(j.dia_inicio, time(9, 30), tzinfo=TZ_NUEVA_YORK)
        escaneo = datetime.combine(j.dia_base, time(16, 45), tzinfo=TZ_NUEVA_YORK)
        assert escaneo < j.cierre_inscripcion < apertura


@pytest.mark.parametrize(("dia", "esperado"), [
    (date(2026, 9, 30), True),      # miércoles
    (date(2026, 10, 30), True),     # viernes; el 31 es sábado
    (date(2026, 10, 29), False),
    (date(2026, 10, 31), False),
    (date(2026, 12, 31), True),
    (date(2027, 5, 28), True),      # el 31 es festivo (Memorial Day)
    (date(2027, 5, 31), False),
])
def test_ultimo_dia_de_bolsa(dia, esperado):
    assert es_ultimo_dia_de_bolsa(dia) is esperado


def test_las_jornadas_de_un_anio_se_encadenan_sin_huecos():
    previa = jornada_del_mes(2026, 12)
    for mes in range(1, 13):
        j = jornada_del_mes(2027, mes)
        assert j.dia_base == previa.dia_fin
        assert j.dia_base < j.dia_inicio <= j.dia_fin
        assert (j.dia_inicio.year, j.dia_inicio.month) == (2027, mes)
        assert (j.dia_fin.year, j.dia_fin.month) == (2027, mes)
        assert all(es_dia_de_bolsa(d) for d in (j.dia_base, j.dia_inicio, j.dia_fin))
        previa = j


def test_fechas_que_no_valen():
    with pytest.raises(ValueError):
        jornada_del_mes(2027, 13)
    with pytest.raises(TypeError):
        es_dia_de_bolsa(datetime(2027, 1, 4, 10, 0))
    with pytest.raises(ValueError):
        es_dia_de_bolsa(date(1999, 12, 31))
    with pytest.raises(ValueError):
        jornada_del_mes(2000, 1)                      # no hay día base antes del calendario
