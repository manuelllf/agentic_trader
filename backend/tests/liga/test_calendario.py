"""Calendario de la NYSE para las jornadas: festivos, fines de semana y cierre de inscripción."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.liga.motor.calendario import (
    TZ_NUEVA_YORK,
    cortes_entre,
    dias_de_bolsa,
    es_corte,
    es_dia_de_bolsa,
    es_ultimo_dia_de_bolsa,
    escaneo_de_la_semana,
    jornada_del_mes,
    jornada_semanal,
    jornadas_semanales,
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


def test_corte_semanal_normal():
    assert cortes_entre(date(2026, 1, 5), date(2026, 1, 9)) == [date(2026, 1, 9)]
    jornada = jornada_semanal(date(2026, 1, 9))
    assert jornada.dia_base == date(2026, 1, 9)
    assert jornada.dia_inicio == date(2026, 1, 12)
    assert jornada.dia_fin == date(2026, 1, 16)
    assert jornada.cierre_inscripcion == datetime(2026, 1, 9, 18, tzinfo=TZ_NUEVA_YORK)


def test_fin_de_mes_entre_semana_no_corta_la_semana():
    assert cortes_entre(date(2026, 9, 28), date(2026, 10, 2)) == [date(2026, 10, 2)]
    assert not es_corte(date(2026, 9, 30))
    jornada = jornada_semanal(date(2026, 9, 25))
    assert (jornada.dia_inicio, jornada.dia_fin) == (date(2026, 9, 28), date(2026, 10, 2))
    assert escaneo_de_la_semana(date(2026, 10, 2)) == date(2026, 9, 30)
    assert escaneo_de_la_semana(date(2026, 10, 9)) is None


def test_viernes_santo_adelanta_el_corte_semanal():
    assert not es_dia_de_bolsa(date(2026, 4, 3))
    assert not es_corte(date(2026, 4, 3))
    assert not es_corte(date(2026, 3, 31))
    assert cortes_entre(date(2026, 3, 30), date(2026, 4, 5)) == [date(2026, 4, 2)]
    assert jornada_semanal(date(2026, 3, 27)).dia_fin == date(2026, 4, 2)
    assert escaneo_de_la_semana(date(2026, 4, 2)) == date(2026, 3, 31)


@pytest.mark.parametrize("dia", [date(2026, 1, 8), date(2026, 1, 10), date(2026, 9, 30)])
def test_jornada_y_escaneo_rechazan_fechas_sin_corte(dia):
    with pytest.raises(ValueError):
        jornada_semanal(dia)
    with pytest.raises(ValueError):
        escaneo_de_la_semana(dia)


def test_cortes_incluyen_extremos():
    corte = date(2026, 10, 30)
    assert cortes_entre(corte, corte) == [corte]
    assert cortes_entre(date(2026, 10, 31), corte) == []


def test_jornadas_semanales_del_anio_sin_huecos():
    desde, hasta = date(2027, 1, 1), date(2027, 12, 31)
    cortes = cortes_entre(desde, hasta)
    jornadas = jornadas_semanales(desde, hasta)
    assert [j.dia_base for j in jornadas] == cortes[:-1]
    assert [j.dia_fin for j in jornadas] == cortes[1:]
    for jornada in jornadas:
        assert desde <= jornada.dia_base < jornada.dia_inicio <= jornada.dia_fin <= hasta
        assert jornada.dia_inicio == dias_de_bolsa(jornada.dia_base, jornada.dia_fin)[1]
    for anterior, siguiente in zip(jornadas, jornadas[1:], strict=False):
        assert anterior.dia_fin == siguiente.dia_base


def test_jornadas_semanales_omite_la_ultima_si_no_cabe():
    assert jornadas_semanales(date(2026, 1, 9), date(2026, 1, 15)) == []
    jornadas = jornadas_semanales(date(2026, 1, 9), date(2026, 1, 16))
    assert jornadas == [jornada_semanal(date(2026, 1, 9))]


@pytest.mark.parametrize(("corte", "esperado"), [
    (date(2026, 10, 30), date(2026, 10, 30)),
    (date(2026, 12, 4), date(2026, 11, 30)),
    (date(2027, 4, 2), date(2027, 3, 31)),
    (date(2027, 5, 28), date(2027, 5, 28)),
    (date(2027, 4, 9), None),
])
def test_escaneo_de_la_semana(corte, esperado):
    assert escaneo_de_la_semana(corte) == esperado


def test_semanas_de_la_pretemporada_y_de_2027():
    pre = jornadas_semanales(date(2026, 10, 30), date(2026, 12, 31))
    t1 = [j for j in jornadas_semanales(date(2026, 12, 1), date(2027, 12, 31))
          if j.dia_inicio.year == 2027]
    assert len(pre) == 9
    assert len(t1) == 52
    assert pre[0].dia_base == date(2026, 10, 30)
    assert pre[-1].dia_fin == t1[0].dia_base == date(2026, 12, 31)
    assert t1[-1].dia_fin == date(2027, 12, 31)
    for j in pre + t1:
        assert len(dias_de_bolsa(j.dia_inicio, j.dia_fin)) in (4, 5)
        assert j.dia_inicio.isocalendar()[:2] == j.dia_fin.isocalendar()[:2]
