"""Pruebas del vigía (código puro, sin base ni red)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.agente.datos import Extendido
from app.agente.limites import Alerta, Cartera, Posicion
from app.agente.vigia import (
    Evento,
    Movimiento,
    Nivel,
    hay_que_despertar,
    movimientos_extendidos,
    niveles_desde_json,
    revisar,
)
from app.ledger.money import D

HOY = date(2026, 11, 16)


def _cartera_limpia() -> Cartera:
    """Dos posiciones al mismo peso y sin pérdidas: no genera alertas de cartera."""
    return Cartera(
        caja=D("1000"),
        posiciones=(
            Posicion("AAA", D("10"), D("100"), D("100")),
            Posicion("BBB", D("10"), D("100"), D("100")),
        ),
        valor_maximo=D("3000"),
    )


def _cartera_con_caida() -> Cartera:
    """AAA pierde un 35 % frente a su coste: genera revision_caida_posicion."""
    return Cartera(
        caja=D("1000"),
        posiciones=(
            Posicion("AAA", D("10"), D("100"), D("65")),
            Posicion("BBB", D("10"), D("100"), D("100")),
        ),
        valor_maximo=D("2650"),
    )


def _codigos(alertas: list[Alerta]) -> list[tuple[str, str | None]]:
    return [(a.codigo, a.ticker) for a in alertas]


# Nivel cruzado

def test_nivel_arriba_cruzado_genera_alerta() -> None:
    niveles = [Nivel("BBB", D("100"), "arriba", "ruptura")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("101")}, {"BBB": D("99")}, niveles, [], HOY)
    assert _codigos(alertas) == [("nivel_cruzado", "BBB")]
    assert alertas[0].valor == D("100")


def test_nivel_arriba_tocado_justo_cuenta() -> None:
    niveles = [Nivel("BBB", D("100"), "arriba", "")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("100")}, {"BBB": D("99")}, niveles, [], HOY)
    assert _codigos(alertas) == [("nivel_cruzado", "BBB")]


def test_nivel_arriba_ya_estaba_por_encima_no_cuenta() -> None:
    niveles = [Nivel("BBB", D("100"), "arriba", "")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("102")}, {"BBB": D("100")}, niveles, [], HOY)
    assert alertas == []


def test_nivel_abajo_cruzado_genera_alerta() -> None:
    niveles = [Nivel("BBB", D("100"), "abajo", "soporte")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("99")}, {"BBB": D("101")}, niveles, [], HOY)
    assert _codigos(alertas) == [("nivel_cruzado", "BBB")]


def test_nivel_abajo_tocado_justo_cuenta() -> None:
    niveles = [Nivel("BBB", D("100"), "abajo", "")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("100")}, {"BBB": D("101")}, niveles, [], HOY)
    assert _codigos(alertas) == [("nivel_cruzado", "BBB")]


def test_nivel_abajo_previo_en_el_nivel_no_cuenta() -> None:
    niveles = [Nivel("BBB", D("100"), "abajo", "")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("99")}, {"BBB": D("100")}, niveles, [], HOY)
    assert alertas == []


def test_nivel_sin_cierre_previo_o_de_hoy_no_alerta() -> None:
    niveles = [Nivel("BBB", D("100"), "arriba", "")]
    sin_previo = revisar(_cartera_limpia(), {"BBB": D("101")}, {}, niveles, [], HOY)
    sin_hoy = revisar(_cartera_limpia(), {}, {"BBB": D("99")}, niveles, [], HOY)
    assert sin_previo == []
    assert sin_hoy == []


# Evento próximo

def test_evento_hoy_y_hoy_mas_siete_cuentan() -> None:
    cartera = _cartera_limpia()
    for dias in (0, 7):
        eventos = [Evento("AAA", date.fromordinal(HOY.toordinal() + dias), "resultados")]
        alertas = revisar(cartera, {}, {}, [], eventos, HOY)
        assert _codigos(alertas) == [("evento_proximo", "AAA")]
        assert alertas[0].valor == D(dias)


def test_evento_a_hoy_mas_ocho_no_cuenta_ni_los_pasados() -> None:
    cartera = _cartera_limpia()
    eventos = [
        Evento("AAA", date.fromordinal(HOY.toordinal() + 8), "binario"),
        Evento("AAA", date.fromordinal(HOY.toordinal() - 1), "resultados"),
    ]
    assert revisar(cartera, {}, {}, [], eventos, HOY) == []


def test_evento_de_ticker_con_nivel_cuenta_aunque_no_este_en_cartera() -> None:
    niveles = [Nivel("CCC", D("50"), "arriba", "")]
    eventos = [Evento("CCC", date.fromordinal(HOY.toordinal() + 3), "resultados")]
    alertas = revisar(_cartera_limpia(), {}, {}, niveles, eventos, HOY)
    assert _codigos(alertas) == [("evento_proximo", "CCC")]


def test_evento_de_ticker_sin_cartera_ni_nivel_se_ignora() -> None:
    eventos = [Evento("ZZZ", HOY, "resultados")]
    assert revisar(_cartera_limpia(), {}, {}, [], eventos, HOY) == []


# Movimiento fuerte

def test_movimiento_justo_ocho_por_ciento_cuenta() -> None:
    alertas = revisar(_cartera_limpia(), {"AAA": D("108")}, {"AAA": D("100")}, [], [], HOY)
    assert _codigos(alertas) == [("movimiento_fuerte", "AAA")]
    assert alertas[0].valor == D("0.08")


def test_movimiento_de_siete_con_noventa_y_nueve_no_cuenta() -> None:
    alertas = revisar(_cartera_limpia(), {"AAA": D("107.99")}, {"AAA": D("100")}, [], [], HOY)
    assert alertas == []


def test_movimiento_a_la_baja_cuenta_con_valor_negativo() -> None:
    alertas = revisar(_cartera_limpia(), {"AAA": D("92")}, {"AAA": D("100")}, [], [], HOY)
    assert _codigos(alertas) == [("movimiento_fuerte", "AAA")]
    assert alertas[0].valor == D("-0.08")


def test_movimiento_solo_para_posiciones_en_cartera() -> None:
    alertas = revisar(_cartera_limpia(), {"ZZZ": D("150")}, {"ZZZ": D("100")}, [], [], HOY)
    assert alertas == []


def test_falta_de_cierres_no_lanza_ni_alerta() -> None:
    cartera = _cartera_limpia()
    assert revisar(cartera, {}, {}, [], [], HOY) == []
    assert revisar(cartera, {"AAA": D("150")}, {}, [], [], HOY) == []
    assert revisar(cartera, {"AAA": D("150")}, {"AAA": D("0")}, [], [], HOY) == []


# Niveles mal formados

def test_niveles_mal_formados_se_ignoran() -> None:
    datos = [
        {"precio": "123.4", "direccion": "arriba", "motivo": "buena"},
        {"precio": "abc", "direccion": "arriba", "motivo": "no numérico"},
        {"precio": "0", "direccion": "arriba", "motivo": "cero"},
        {"precio": "-5", "direccion": "abajo", "motivo": "negativo"},
        {"precio": "NaN", "direccion": "arriba", "motivo": "nan"},
        {"precio": "10", "direccion": "lateral", "motivo": "dirección desconocida"},
        {"direccion": "arriba", "motivo": "sin precio"},
        {"precio": "10", "direccion": None},
        "no es un dict",
        None,
    ]
    niveles = niveles_desde_json("BBB", datos)
    assert niveles == [Nivel("BBB", D("123.4"), "arriba", "buena")]


def test_niveles_con_datos_no_lista_devuelven_vacio() -> None:
    assert niveles_desde_json("BBB", None) == []  # type: ignore[arg-type]


def test_nivel_sin_motivo_queda_con_cadena_vacia() -> None:
    niveles = niveles_desde_json("BBB", [{"precio": 99.5, "direccion": "abajo"}])
    assert niveles == [Nivel("BBB", D("99.5"), "abajo", "")]


# Duplicados y orden

def test_nivel_repetido_y_evento_repetido_cuentan_una_vez() -> None:
    nivel = Nivel("BBB", D("100"), "arriba", "")
    evento = Evento("AAA", date.fromordinal(HOY.toordinal() + 2), "resultados")
    alertas = revisar(_cartera_limpia(), {"BBB": D("101")}, {"BBB": D("99")},
                      [nivel, nivel], [evento, evento], HOY)
    assert _codigos(alertas) == [("nivel_cruzado", "BBB"), ("evento_proximo", "AAA")]


def test_distintos_niveles_del_mismo_ticker_dan_una_alerta_cada_uno() -> None:
    niveles = [Nivel("BBB", D("105"), "arriba", ""), Nivel("BBB", D("106"), "arriba", "")]
    alertas = revisar(_cartera_limpia(), {"BBB": D("110")}, {"BBB": D("100")}, niveles, [], HOY)
    cruces = [a.valor for a in alertas if a.codigo == "nivel_cruzado"]
    assert cruces == [D("105"), D("106")]


def test_orden_estable_cartera_niveles_eventos_movimientos() -> None:
    cartera = _cartera_con_caida()
    cierres = {"AAA": D("108"), "BBB": D("110")}
    previos = {"AAA": D("100"), "BBB": D("100")}
    niveles = [Nivel("CCC", D("1"), "arriba", ""), Nivel("BBB", D("105"), "arriba", "")]
    eventos = [Evento("CCC", date.fromordinal(HOY.toordinal() + 3), "binario")]
    esperado = [
        ("revision_caida_posicion", "AAA"),
        ("nivel_cruzado", "BBB"),
        ("evento_proximo", "CCC"),
        ("movimiento_fuerte", "AAA"),
        ("movimiento_fuerte", "BBB"),
    ]
    alertas = revisar(cartera, cierres, previos, niveles, eventos, HOY)
    assert _codigos(alertas) == esperado
    # El orden no depende del orden de entrada de niveles ni eventos.
    invertido = revisar(cartera, cierres, previos, list(reversed(niveles)),
                        list(reversed(eventos)), HOY)
    assert _codigos(invertido) == esperado


def test_alertas_de_cartera_van_primero_y_sin_ticker_al_final() -> None:
    # La pausa de cartera no tiene ticker: con 50 % de caída desde el máximo, va al final.
    cartera = Cartera(
        caja=D("0"),
        posiciones=(Posicion("AAA", D("10"), D("100"), D("65")),),
        valor_maximo=D("1300"),
    )
    alertas = revisar(cartera, {}, {}, [], [], HOY)
    codigos = [a.codigo for a in alertas]
    assert codigos[-1] == "cartera_pausa"
    assert "revision_caida_posicion" in codigos


# Despertar

def test_lista_vacia_no_despierta() -> None:
    assert hay_que_despertar([]) is False
    assert revisar(_cartera_limpia(), {}, {}, [], [], HOY) == []
    assert hay_que_despertar(revisar(_cartera_limpia(), {}, {}, [], [], HOY)) is False


def test_alguna_alerta_despierta() -> None:
    alertas = revisar(_cartera_limpia(), {"AAA": D("108")}, {"AAA": D("100")}, [], [], HOY)
    assert hay_que_despertar(alertas) is True


# Horario extendido

_NY = ZoneInfo("America/New_York")


def _ext(ticker: str, ultimo: str, volumen: int = 50_000) -> Extendido:
    return Extendido(ticker, D(ultimo), volumen, datetime(2026, 11, 16, 8, 44, tzinfo=_NY))


def _mov(extendidos: dict[str, Extendido], resultados: dict[str, date] | None = None,
         referencias: dict[str, Decimal] | None = None) -> list[Movimiento]:
    refs = referencias or {t: D("100") for t in extendidos}
    return movimientos_extendidos("premarket", refs, extendidos, resultados or {}, HOY)


def test_movimiento_extendido_sobre_el_umbral_se_registra() -> None:
    movs = _mov({"AAA": _ext("AAA", "91"), "BBB": _ext("BBB", "103")})
    assert [(m.ticker, m.franja, m.por_resultados) for m in movs] == [("AAA", "premarket", False)]
    assert movs[0].datos() == {
        "valor": "-0.0900", "precio": "91", "referencia": "100", "volumen": 50_000,
        "hasta": "2026-11-16T08:44:00-05:00", "resultados": False}


def test_el_umbral_es_justo_del_ocho_por_ciento() -> None:
    assert [m.ticker for m in _mov({"AAA": _ext("AAA", "108"), "BBB": _ext("BBB", "107.99")})] == [
        "AAA"]
    assert [m.ticker for m in _mov({"AAA": _ext("AAA", "92")})] == ["AAA"]


def test_con_resultados_de_hoy_o_ayer_el_umbral_baja_al_tres_por_ciento() -> None:
    ext = {"AAA": _ext("AAA", "104"), "BBB": _ext("BBB", "104"), "CCC": _ext("CCC", "104"),
           "DDD": _ext("DDD", "104")}
    resultados = {"AAA": HOY, "BBB": date(2026, 11, 15), "CCC": date(2026, 11, 14),
                  "DDD": date(2026, 11, 17)}
    movs = _mov(ext, resultados)
    assert [(m.ticker, m.por_resultados) for m in movs] == [("AAA", True), ("BBB", True)]


def test_poco_volumen_no_cuenta() -> None:
    assert _mov({"AAA": _ext("AAA", "80", volumen=9_999)}) == []
    assert [m.ticker for m in _mov({"AAA": _ext("AAA", "80", volumen=10_000)})] == ["AAA"]


def test_sin_referencia_o_referencia_cero_se_ignora() -> None:
    ext = {"AAA": _ext("AAA", "80"), "BBB": _ext("BBB", "80")}
    assert _mov(ext, referencias={"BBB": D("0")}) == []


def test_movimientos_salen_ordenados_por_ticker() -> None:
    ext = {"ZZZ": _ext("ZZZ", "80"), "AAA": _ext("AAA", "120")}
    assert [m.ticker for m in _mov(ext)] == ["AAA", "ZZZ"]
