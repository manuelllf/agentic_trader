"""Selección del día 1: reglas, nota ponderada, desempates, tope por sector, pesos y caja."""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

import pytest

from app.liga.motor.catalogo import EmpresaFoto, RecetaNoValida, regla_por_defecto
from app.liga.motor.formato import NBSP
from app.liga.motor.seleccion import (
    SIN_NOTAS,
    SIN_RESPUESTA,
    NotasJev,
    Receta,
    Respuesta,
    candidatas_pregunta,
    explicar,
    redondear_pesos,
    seleccionar,
    validar_receta,
)

M = 1_000_000
SOLO_NEGOCIO = {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0}


def emp(ticker: str, cap: float = 50_000 * M, sector: str = "Technology", **kw) -> EmpresaFoto:
    return EmpresaFoto(ticker, nombre=f"{ticker} Inc", sector=sector, market_cap_usd=cap, **kw)


def notas(f, v=0, d=0, c=0) -> NotasJev:
    return NotasJev(Decimal(str(f)), Decimal(str(v)), Decimal(str(d)), Decimal(str(c)))


def receta(**kw) -> Receta:
    base = {"reglas": [], "pesos": dict(SOLO_NEGOCIO), "n_empresas": 3, "reparto": "igual",
            "max_por_sector": 0}
    base.update(kw)
    return Receta(**base)


def test_nota_es_la_media_ponderada_de_las_4_notas_pasadas_a_0_10():
    pesos = {"negocio": 50, "precio": 25, "deuda": 25, "pronto": 0, "pregunta": 0}
    s = seleccionar([emp("A")], receta(pesos=pesos), {"A": notas(9, 4.5, 0, 9)})
    fila = s.fila("A")
    # (50·10 + 25·5 + 25·0) / 100; «pronto» no pesa aunque tenga nota.
    assert fila.nota_exacta == Fraction(25, 4)
    assert fila.nota == Decimal("6.2500")
    assert fila.mejor_nota == "negocio"


def test_entran_las_n_mejores_a_partes_iguales_y_la_cartera_suma_100():
    empresas = [emp(t) for t in "ABCDE"]
    n = {"A": notas(3), "B": notas(9), "C": notas(6), "D": notas(8), "E": notas(1)}
    s = seleccionar(empresas, receta(), n)
    assert [e.ticker for e in s.elegidas] == ["B", "D", "C"]
    assert [e.peso for e in s.elegidas] == [Decimal("33.3334"), Decimal("33.3333"),
                                            Decimal("33.3333")]
    assert s.caja_pct == Decimal("0.0000")
    assert [f.ticker for f in s.pasan] == ["B", "D", "C", "A", "E"]
    assert s.elegidas[0].porque == "Destaca en «que el negocio vaya bien». Nota 100."


def test_a_igual_nota_decide_la_capitalizacion_y_luego_el_ticker():
    empresas = [emp("PEQ", cap=1_000 * M), emp("GRA", cap=900_000 * M),
                emp("ZZZ", cap=5_000 * M), emp("AAA", cap=5_000 * M), emp("SIN", cap=None)]
    n = {t.ticker: notas(7) for t in empresas}
    s = seleccionar(empresas, receta(n_empresas=5), n)
    assert [e.ticker for e in s.elegidas] == ["GRA", "AAA", "ZZZ", "PEQ", "SIN"]


def test_empate_exacto_aunque_los_pesos_den_decimales_periodicos():
    """Con fracciones, 1/3 + 1/3 + 1/3 empata de verdad con 1: decide la capitalización."""
    pesos = {"negocio": 5, "precio": 5, "deuda": 5, "pronto": 0, "pregunta": 0}
    empresas = [emp("A", cap=1_000 * M), emp("B", cap=2_000 * M)]
    n = {"A": notas(3, 3, 3), "B": notas(1, 3, 5)}
    s = seleccionar(empresas, receta(pesos=pesos, n_empresas=3), n)
    assert [e.ticker for e in s.elegidas] == ["B", "A"]


def test_tope_por_sector_salta_a_la_siguiente_y_lo_explica():
    empresas = [emp("T1"), emp("T2"), emp("T3"), emp("H1", sector="Healthcare"),
                emp("E1", sector="Energy")]
    n = {"T1": notas(9), "T2": notas(8), "T3": notas(7), "H1": notas(6), "E1": notas(5)}
    r = receta(max_por_sector=2)
    s = seleccionar(empresas, r, n)
    assert [e.ticker for e in s.elegidas] == ["T1", "T2", "H1"]
    assert [f.ticker for f in s.saltadas_por_sector] == ["T3"]
    assert explicar("T3", s, r) == (
        "T3 Inc pasa tus reglas, pero ya hay 2 de tecnología y no caben más.")
    assert explicar("E1", s, r) == (
        "E1 Inc pasa tus reglas, pero queda la 5.ª por nota (5,6) y entran las 3 primeras.")


def test_sin_sector_cuentan_como_un_sector_mas():
    empresas = [emp("A", sector=None), emp("B", sector=" "), emp("C")]
    n = {"A": notas(9), "B": notas(8), "C": notas(1)}
    r = receta(max_por_sector=1)
    s = seleccionar(empresas, r, n)
    assert [e.ticker for e in s.elegidas] == ["A", "C"]
    assert explicar("B", s, r) == (
        "B Inc pasa tus reglas, pero ya hay 1 sin sector conocido y no caben más.")


def test_tope_por_sector_mayor_que_n_es_como_no_ponerlo():
    empresas = [emp(t) for t in "ABC"]
    s = seleccionar(empresas, receta(max_por_sector=10), {t: notas(5) for t in "ABC"})
    assert len(s.elegidas) == 3


def test_si_no_llegan_a_n_el_resto_queda_en_caja():
    empresas = [emp("A"), emp("B"), emp("C", cap=100 * M)]
    r = receta(reglas=[regla_por_defecto("medianas")], n_empresas=5)
    s = seleccionar(empresas, r, {t: notas(5) for t in "ABC"})
    assert [e.peso for e in s.elegidas] == [Decimal("20.0000"), Decimal("20.0000")]
    assert s.caja_pct == Decimal("60.0000")


def test_reparto_por_nota_proporcional_y_con_caja_si_faltan():
    empresas = [emp("A"), emp("B"), emp("C")]
    n = {"A": notas(9), "B": notas(4.5), "C": notas(2.25)}
    s = seleccionar(empresas, receta(reparto="nota", n_empresas=5), n)
    pesos = [e.peso for e in s.elegidas]
    # 3 de 5 plazas: pesan el 60 % entre las tres, en proporción 4 : 2 : 1.
    assert pesos == [Decimal("34.2858"), Decimal("17.1428"), Decimal("8.5714")]
    assert sum(pesos) == Decimal("60.0000")
    assert s.caja_pct == Decimal("40.0000")


def test_reparto_por_nota_con_la_cartera_llena_suma_100_justo_y_nunca_mas():
    empresas = [emp(t) for t in "ABCDEFG"]
    n = {t: notas(1 + i) for i, t in enumerate("ABCDEFG")}
    s = seleccionar(empresas, receta(reparto="nota", n_empresas=7), n)
    assert sum(e.peso for e in s.elegidas) == Decimal(100)
    assert all(e.peso > 0 and e.peso == e.peso.quantize(Decimal("0.0001")) for e in s.elegidas)
    assert s.elegidas[0].peso > s.elegidas[-1].peso


def test_reparto_por_nota_con_nota_0_no_entra_con_peso_0():
    """`liga.posiciones` exige peso > 0; su parte ya la tienen las otras, por proporción."""
    empresas = [emp("A"), emp("B"), emp("CERO")]
    n = {"A": notas(9), "B": notas(9), "CERO": notas(0)}
    r = receta(reparto="nota")
    s = seleccionar(empresas, r, n)
    assert [(e.ticker, e.peso) for e in s.elegidas] == [("A", Decimal("50.0000")),
                                                        ("B", Decimal("50.0000"))]
    assert [f.ticker for f in s.sin_peso] == ["CERO"]
    assert s.caja_pct == Decimal("0.0000")
    assert explicar("CERO", s, r) == (
        "CERO Inc pasa tus reglas, pero su nota es 0 y, repartiendo por nota, no pesa nada.")


def test_reparto_por_nota_con_todas_a_0_va_a_partes_iguales():
    s = seleccionar([emp("A"), emp("B"), emp("C")], receta(reparto="nota"),
                    {t: notas(0) for t in "ABC"})
    assert sum(e.peso for e in s.elegidas) == Decimal(100)


def test_quitadas_a_mano_sin_notas_y_reglas_que_no_cumplen():
    empresas = [emp("A"), emp("QUITADA"), emp("SINNOTA"), emp("CHICA", cap=1_900 * M)]
    r = receta(reglas=[regla_por_defecto("medianas")], excluidas=("QUITADA",))
    n = {"A": notas(1), "QUITADA": notas(9), "CHICA": notas(9)}
    s = seleccionar(empresas, r, n)
    assert [e.ticker for e in s.elegidas] == ["A"]
    assert s.fila("SINNOTA").fallo == SIN_NOTAS
    assert explicar("QUITADA", s, r) == (
        "QUITADA Inc: la quitaste tú. Si la quieres de vuelta, recupérala en tus reglas.")
    assert explicar("CHICA", s, r) == (
        f"CHICA Inc no entra: vale 1.900{NBSP}M$ y pides más de 2.000{NBSP}M$.")
    assert explicar("SINNOTA", s, r) == f"SINNOTA Inc no entra: {SIN_NOTAS}."
    assert explicar("A", s, r) == f"A Inc entra: es la 1.ª, con un 33{NBSP}%."
    assert explicar("NOESTA", s, r) == "NOESTA no está entre las empresas de la foto de este mes."


def test_si_no_pasa_una_regla_manda_la_regla_aunque_falten_las_notas():
    r = receta(reglas=[regla_por_defecto("medianas")])
    s = seleccionar([emp("CHICA", cap=1 * M)], r, {})
    assert s.fila("CHICA").fallo.startswith("vale")


@pytest.mark.parametrize(("si", "seguridad", "nota"), [
    (True, "alta", "9.2"), (True, "media", "7.4"), (True, "baja", "5.8"),
    (False, "alta", "1.2"), (False, "media", "2.8"), (False, "baja", "4.2"),
])
def test_nota_de_la_respuesta_a_la_pregunta(si, seguridad, nota):
    assert Respuesta(si, seguridad).nota == Decimal(nota)


def test_respuestas_que_no_valen():
    with pytest.raises(ValueError):
        Respuesta(True, "total")
    with pytest.raises(TypeError):
        Respuesta(1, "alta")  # type: ignore[arg-type]


def test_la_pregunta_entra_en_la_media_y_sin_respuesta_no_se_pasa():
    pesos = {"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 50}
    empresas = [emp("SI"), emp("NO"), emp("SINPREGUNTA")]
    n = {"SI": notas(4.5), "NO": notas(9), "SINPREGUNTA": notas(9)}
    resp = {"SI": Respuesta(True, "alta"), "NO": Respuesta(False, "alta")}
    r = receta(pesos=pesos)
    s = seleccionar(empresas, r, n, resp)
    assert s.fila("SI").nota_exacta == (5 + Fraction("9.2")) / 2        # 7,1
    assert s.fila("NO").nota_exacta == (10 + Fraction("1.2")) / 2       # 5,6
    assert [e.ticker for e in s.elegidas] == ["SI", "NO"]
    assert s.elegidas[0].porque == "La IA contesta que sí, con seguridad alta. Nota 71."
    assert s.fila("SINPREGUNTA").fallo == SIN_RESPUESTA
    assert explicar("SINPREGUNTA", s, r) == f"SINPREGUNTA Inc no entra: {SIN_RESPUESTA}."


def test_si_solo_pesa_la_pregunta_la_nota_es_la_de_la_respuesta():
    pesos = {"negocio": 0, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 25}
    s = seleccionar([emp("A")], receta(pesos=pesos), {"A": notas(9)},
                    {"A": Respuesta(False, "baja")})
    assert s.fila("A").nota == Decimal("4.2000")
    assert s.fila("A").mejor_nota is None


def test_la_pregunta_se_hace_solo_a_las_300_mejores_que_pasan_las_reglas():
    empresas = [emp(f"T{i:03d}", cap=(3_000 + i) * M) for i in range(310)]
    empresas += [emp("CHICA", cap=1 * M), emp("QUITADA"), emp("SINNOTA")]
    n = {e.ticker: notas(i % 10 * 0.9) for i, e in enumerate(empresas) if e.ticker != "SINNOTA"}
    pesos = {"negocio": 25, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 25}
    r = receta(pesos=pesos, reglas=[regla_por_defecto("medianas")], excluidas=("QUITADA",))
    candidatas = candidatas_pregunta(empresas, r, n)
    assert len(candidatas) == 300
    assert not {"CHICA", "QUITADA", "SINNOTA"} & set(candidatas)
    # Las 31 de nota 8,1 y luego las de 7,2, cada grupo de más a menos capitalización.
    assert candidatas[0] == "T309" and candidatas[30] == "T009"
    assert candidatas[31] == "T308"
    assert len(candidatas_pregunta(empresas, r, n, tope=5)) == 5


def test_candidatas_si_solo_pesa_la_pregunta_ordena_por_las_4_notas_a_partes_iguales():
    pesos = {"negocio": 0, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 25}
    empresas = [emp("A"), emp("B"), emp("C")]
    n = {"A": notas(9, 0, 0, 0), "B": notas(3, 3, 3, 3), "C": notas(0, 0, 0, 1)}
    assert candidatas_pregunta(empresas, receta(pesos=pesos), n, tope=2) == ["B", "A"]


def test_notas_de_jev_desde_la_bd_y_fuera_de_rango():
    assert NotasJev.desde_bd(450, 900, 0, 125) == notas(4.5, 9, 0, 1.25)
    assert NotasJev.desde_bd(450, None, 0, 125) is None
    with pytest.raises(ValueError):
        notas(9.5)


@pytest.mark.parametrize(("cambios", "error"), [
    ({"n_empresas": 4}, "3, 5, 7 o 10"),
    ({"n_empresas": True}, "3, 5, 7 o 10"),
    ({"reparto": "mitad"}, "reparto"),
    ({"max_por_sector": 11}, "máximo por sector"),
    ({"max_por_sector": -1}, "máximo por sector"),
    ({"pesos": {**SOLO_NEGOCIO, "negocio": 7}}, "de 5 en 5"),
    ({"pesos": {**SOLO_NEGOCIO, "negocio": 55}}, "de 0 a 50"),
    ({"pesos": {**SOLO_NEGOCIO, "negocio": 0}}, "al menos a una nota"),
    ({"pesos": {"negocio": 50}}, "cinco"),
    ({"excluidas": ("A", "A")}, "dos veces"),
    ({"excluidas": tuple(f"T{i}" for i in range(51))}, "hasta 50"),
    ({"excluidas": ("",)}, "sin ticker"),
    ({"catalogo_version": 2}, "versión 2 del catálogo"),
    ({"reglas": [{"clave": "inventada"}]}, "no está en el catálogo"),
])
def test_recetas_que_no_valen(cambios, error):
    r = receta(**cambios)
    assert any(error in e for e in validar_receta(r)), validar_receta(r)
    with pytest.raises(RecetaNoValida):
        seleccionar([emp("A")], r, {"A": notas(5)})


def test_un_ticker_repetido_en_la_foto_es_un_error():
    with pytest.raises(ValueError, match="dos veces"):
        seleccionar([emp("A"), emp("A")], receta(), {"A": notas(5)})


def test_redondear_pesos():
    siete = redondear_pesos([Fraction(100, 7)] * 7)
    assert siete[0] == Decimal("14.2858") and set(siete[1:]) == {Decimal("14.2857")}
    assert sum(siete) == Decimal(100)
    assert redondear_pesos([]) == []
    assert redondear_pesos([Fraction(1, 3), Fraction(2, 3)]) == [Decimal("0.3333"),
                                                                 Decimal("0.6667")]
    with pytest.raises(ValueError):
        redondear_pesos([60, 41])
    with pytest.raises(ValueError):
        redondear_pesos([-1, 50])
