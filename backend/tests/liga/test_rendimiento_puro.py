"""Metodología pura de las métricas de la ficha."""

import math
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.liga.motor.catalogo import CATALOGO_VERSION, EmpresaFoto
from app.liga.rendimiento import (
    _evidencia_formacion,
    _rendimiento_por_posicion,
    _serie_guardada,
    metricas_diarias,
)
from app.precios import Cierre


def test_no_anualiza_muestras_cortas() -> None:
    m = metricas_diarias([0.01] * 59, [1.0, 1.1], minimo=60)
    assert m["observaciones"] == 59
    assert m["sharpe"] is None
    assert m["sortino"] is None
    assert m["volatilidad"] is None
    assert m["max_drawdown"] == 0


def test_metricas_anualizadas_y_drawdown() -> None:
    retornos = [0.01, -0.01] * 30
    niveles = [1.0, 1.1, 0.9, 1.05]
    m = metricas_diarias(retornos, niveles)
    sd = math.sqrt(sum((r - sum(retornos) / len(retornos)) ** 2 for r in retornos) / 59)
    assert m["observaciones"] == 60
    assert m["sharpe"] == pytest.approx(0)
    assert m["sortino"] == pytest.approx(0)
    assert m["volatilidad"] == pytest.approx(sd * math.sqrt(252))
    assert m["max_drawdown"] == pytest.approx(0.9 / 1.1 - 1)


def test_sin_caidas_no_inventa_sortino() -> None:
    m = metricas_diarias([0.001] * 60, [1.0, 1.2])
    assert m["sortino"] is None


def test_retorno_constante_no_amplifica_residuo_de_float_en_sharpe() -> None:
    m = metricas_diarias([0.1] * 60, [1.0, 1.2])
    assert m["sharpe"] is None
    assert m["volatilidad"] == 0.0


def test_metricas_no_devuelven_nan_ni_infinito() -> None:
    m = metricas_diarias([float("nan")] * 60, [1.0, float("inf")])
    assert m == {"sharpe": None, "sortino": None, "volatilidad": None,
                 "max_drawdown": None, "observaciones": 0}


def test_curva_total_incluye_dividendo_split_y_cambio_de_pesos_por_jornada() -> None:
    base = date(2026, 1, 5)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(dias[0], 100), Cierre(dias[1], 101, dividendo=1),
                Cierre(dias[2], 102), Cierre(dias[3], 103), Cierre(dias[4], 104)],
        "AAA": [Cierre(dias[0], 100), Cierre(dias[1], 100, dividendo=2),
                Cierre(dias[2], 51, split=2)],
        "BBB": [Cierre(dias[2], 20), Cierre(dias[3], 22), Cierre(dias[4], 20)],
    }
    rondas = [
        (dias[0], dias[2], True, [("AAA", Decimal("100"))]),
        (dias[2], dias[4], False, [("BBB", Decimal("100"))]),
    ]
    result = _serie_guardada(rondas, cierres, dias[4], dias)
    curve = result["serie"]
    assert result["estado"] == "disponible"
    assert curve[0] == {"dia": dias[0].isoformat(), "estrategia": 0.0, "sp500": 0.0,
                        "provisional": False, "salto": False}
    assert curve[2]["estrategia"] == pytest.approx(4.04)
    assert curve[2]["provisional"] is False
    assert curve[-1]["estrategia"] == pytest.approx(4.04)
    expected_sp = 1.02 * (104 / 101) - 1
    assert curve[-1]["sp500"] == pytest.approx(expected_sp * 100)
    assert curve[-1]["provisional"] is True
    assert result["oficial_hasta"] == dias[2].isoformat()
    assert result["provisional_hasta"] == dias[4].isoformat()


def test_cada_punto_dice_a_que_jornada_pertenece_y_el_dia_base_a_la_que_empieza() -> None:
    base = date(2026, 1, 5)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(d, 100 + i) for i, d in enumerate(dias)],
        "AAA": [Cierre(d, 100 + i) for i, d in enumerate(dias[:3])],
        "BBB": [Cierre(d, 20 + i) for i, d in enumerate(dias[2:])],
    }
    rondas = [
        (dias[0], dias[2], True, [("AAA", Decimal("100"))]),
        (dias[2], dias[4], False, [("BBB", Decimal("100"))]),
    ]
    con_numeros = _serie_guardada(rondas, cierres, dias[4], dias, numeros=[3, 4])
    assert [p["jornada"] for p in con_numeros["serie"]] == [3, 3, 4, 4, 4]
    sin_numeros = _serie_guardada(rondas, cierres, dias[4], dias)
    assert all("jornada" not in p for p in sin_numeros["serie"])


def test_curva_omite_dias_incompletos_y_no_cuenta_salto_como_retorno_diario() -> None:
    base = date(2026, 2, 2)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(d, 100 + i) for i, d in enumerate(dias)],
        "AAA": [Cierre(dias[0], 100), Cierre(dias[1], 101),
                Cierre(dias[3], 105), Cierre(dias[4], 106)],
    }
    result = _serie_guardada([(dias[0], dias[4], True,
                               [("AAA", Decimal("100"))])], cierres, dias[4], dias)
    plotted = [p["dia"] for p in result["serie"]]
    assert dias[2].isoformat() not in plotted
    assert result["serie"][-2]["salto"] is True
    assert result["incompleta"] is True
    # Días 2 y 3 no forman una observación diaria válida al faltar el cierre del ticker.
    assert result["metricas"]["observaciones"] == 2


def test_base_siguiente_debe_ser_el_cierre_exacto_del_mes_previo() -> None:
    base = date(2026, 3, 2)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(d, 100 + i) for i, d in enumerate(dias)],
        "AAA": [Cierre(d, 100 + i) for i, d in enumerate(dias)],
        "BBB": [Cierre(dias[3], 21), Cierre(dias[4], 22)],
    }
    rondas = [
        (dias[0], dias[2], True, [("AAA", Decimal("100"))]),
        # The prior round ended on days[2], but BBB has no exact base close there.
        (dias[2], dias[4], True, [("BBB", Decimal("100"))]),
    ]
    result = _serie_guardada(rondas, cierres, dias[4], dias)
    assert [p["dia"] for p in result["serie"]][-1] == dias[2].isoformat()
    assert result["oficial_hasta"] == dias[2].isoformat()
    assert result["incompleta"] is True


def test_fin_oficial_requiere_cierre_exacto_de_sp_y_cartera() -> None:
    base = date(2026, 4, 6)
    dias = [base + timedelta(days=i) for i in range(4)]
    cierres = {
        "SPY": [Cierre(dias[0], 100), Cierre(dias[1], 101), Cierre(dias[2], 102)],
        "AAA": [Cierre(dias[0], 50), Cierre(dias[1], 51), Cierre(dias[2], 52)],
    }
    result = _serie_guardada([(dias[0], dias[3], True,
                               [("AAA", Decimal("100"))])], cierres, dias[3], dias)
    assert result["oficial_hasta"] is None
    assert result["incompleta"] is True


def test_no_encadena_si_falta_el_cierre_del_sp_en_base_del_mes() -> None:
    base = date(2026, 5, 4)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(dias[0], 100), Cierre(dias[1], 101),
                Cierre(dias[3], 103), Cierre(dias[4], 104)],
        "AAA": [Cierre(dias[0], 50), Cierre(dias[1], 51), Cierre(dias[2], 52)],
        "BBB": [Cierre(dias[2], 20), Cierre(dias[3], 21), Cierre(dias[4], 22)],
    }
    rondas = [
        (dias[0], dias[2], True, [("AAA", Decimal("100"))]),
        (dias[2], dias[4], False, [("BBB", Decimal("100"))]),
    ]
    result = _serie_guardada(rondas, cierres, dias[4], dias)
    assert [p["dia"] for p in result["serie"]][-1] == dias[1].isoformat()
    assert result["oficial_hasta"] is None
    assert result["incompleta"] is True


def test_salto_de_sp_conserva_nivel_acumulado_pero_excluye_retorno_diario() -> None:
    base = date(2026, 5, 11)
    dias = [base + timedelta(days=i) for i in range(5)]
    cierres = {
        "SPY": [Cierre(dias[i], 100 + i) for i in (0, 1, 3, 4)],
        "AAA": [Cierre(d, 50 + i) for i, d in enumerate(dias)],
    }
    result = _serie_guardada([(dias[0], dias[4], True,
                               [("AAA", Decimal("100"))])], cierres, dias[4], dias)
    assert [p["dia"] for p in result["serie"]] == [
        dias[i].isoformat() for i in (0, 1, 3, 4)]
    assert result["serie"][2]["salto"] is True
    assert result["metricas"]["observaciones"] == 2
    assert result["incompleta"] is True


def test_fecha_duplicada_no_se_elige_segun_el_orden_de_entrada() -> None:
    base = date(2026, 7, 6)
    dias = [base + timedelta(days=i) for i in range(3)]
    spy = [Cierre(dias[0], 100), Cierre(dias[1], 101), Cierre(dias[1], 110),
           Cierre(dias[2], 102)]
    cierres = {"SPY": spy, "AAA": [Cierre(d, 50 + i) for i, d in enumerate(dias)]}
    result = _serie_guardada([(dias[0], dias[2], True,
                               [("AAA", Decimal("100"))])], cierres, dias[2], dias)
    assert dias[1].isoformat() not in [p["dia"] for p in result["serie"]]
    assert result["serie"][-1]["salto"] is True
    assert result["incompleta"] is True


def test_sesiones_no_consecutivas_no_se_cuentan_como_retorno_diario() -> None:
    base = date(2026, 6, 1)
    sesiones = [base + timedelta(days=i) for i in range(5)]
    cierres_observados = [sesiones[i] for i in (0, 1, 3, 4)]
    cierres = {
        "SPY": [Cierre(d, 100 + i) for i, d in enumerate(cierres_observados)],
        "AAA": [Cierre(d, 100 + i) for i, d in enumerate(cierres_observados)],
    }
    result = _serie_guardada([(sesiones[0], sesiones[-1], True,
                               [("AAA", Decimal("100"))])], cierres, sesiones[-1], sesiones)
    assert result["metricas"]["observaciones"] == 2
    assert result["serie"][2]["salto"] is True


def test_evidencia_usa_receta_foto_y_pesos_fijados_en_la_formacion() -> None:
    base, fin = date(2026, 8, 3), date(2026, 8, 4)
    receta = SimpleNamespace(
        id=17, catalogo_version=CATALOGO_VERSION,
        reglas=[{"clave": "grandes", "params": {}}], excluidas=[],
        idea="empresas grandes", pregunta=None, peso_negocio=20, peso_precio=30,
        peso_deuda=20, peso_pronto=30, peso_pregunta=0, n_empresas=5,
        reparto="igual", max_por_sector=2,
    )
    anterior = {"inscripcion_id": 22, "jornada_id": 2}
    contexto = {
        "actual": {"inscripcion_id": 23, "jornada_id": 3, "numero": 3,
                   "dia_base": base, "dia_fin": fin, "estado_jornada": "cerrada",
                   "receta_id": 17, "receta_vigente_id": 17, "n_pasan": 1},
        "anterior": anterior, "tickers_actuales": ["AAA"],
        "tickers_anteriores": ["BBB"],
        "posiciones_actuales": [{"ticker": "AAA", "peso": Decimal("80")}],
        "foto_disponible": True,
        "empresas": {"AAA": EmpresaFoto(ticker="AAA", market_cap_usd=20_000_000_000),
                     "BBB": EmpresaFoto(ticker="BBB", market_cap_usd=1_000_000_000)},
        "receta": receta, "receta_anterior": receta,
    }
    series = {
        "AAA": [Cierre(base, 100), Cierre(fin, 110)],
        "BBB": [Cierre(base, 100), Cierre(fin, 90)],
        "SPY": [Cierre(base, 100), Cierre(fin, 105)],
    }

    evidence = _evidencia_formacion(contexto, series, fin, [base, fin])

    assert evidence["formacion"]["receta_id"] == 17
    assert evidence["formacion"]["pesos"]["precio"] == 30
    assert evidence["formacion"]["idea"] == "empresas grandes"
    assert evidence["posiciones"][0]["peso"] == Decimal("80")
    assert evidence["posiciones"][0]["reglas"][0]["cumple"] is True
    assert evidence["posiciones"][0]["rendimiento"]["rentabilidad_pct"] == pytest.approx(10)
    assert evidence["cambios"]["entradas"] == ["AAA"]
    assert evidence["cambios"]["salidas"][0]["causa"] == "regla_no_cumplida"


def _contexto_evidencia(*, foto_disponible: bool = True, mantenida: bool = False,
                        receta_actual_id: int = 17, excluir: list[str] | None = None,
                        misma_cartera: bool = False) -> dict:
    receta = SimpleNamespace(
        id=receta_actual_id, catalogo_version=CATALOGO_VERSION,
        reglas=[{"clave": "grandes", "params": {}}], excluidas=excluir or [],
        idea="empresas grandes", pregunta=None, peso_negocio=20, peso_precio=30,
        peso_deuda=20, peso_pronto=30, peso_pregunta=0, n_empresas=5,
        reparto="igual", max_por_sector=2,
    )
    receta_anterior = SimpleNamespace(id=17)
    actual_tickers = ["AAA"]
    previous_tickers = ["AAA"] if misma_cartera else ["BBB"]
    empresas = {"AAA": EmpresaFoto(ticker="AAA", market_cap_usd=20_000_000_000),
                "BBB": EmpresaFoto(ticker="BBB", market_cap_usd=20_000_000_000)}
    if not foto_disponible:
        empresas = {}
    return {
        "actual": {"inscripcion_id": 23, "jornada_id": 3, "numero": 3,
                   "dia_base": date(2026, 8, 3), "dia_fin": date(2026, 8, 4),
                   "estado_jornada": "cerrada", "receta_id": receta_actual_id,
                   "receta_vigente_id": receta_actual_id,
                   "n_pasan": None if mantenida else 1},
        "anterior": {"inscripcion_id": 22, "jornada_id": 2},
        "tickers_actuales": actual_tickers, "tickers_anteriores": previous_tickers,
        "posiciones_actuales": [{"ticker": "AAA", "peso": Decimal("100")}],
        "foto_disponible": foto_disponible, "empresas": empresas,
        "receta": receta,
        "receta_anterior": receta_anterior if receta_actual_id == 17 else SimpleNamespace(id=16),
    }


def test_foto_exacta_ausente_deja_reglas_desconocidas_y_salida_sin_causa_inventada() -> None:
    contexto = _contexto_evidencia(foto_disponible=False)
    d0, d1 = date(2026, 8, 3), date(2026, 8, 4)
    series = {"AAA": [Cierre(d0, 100), Cierre(d1, 101)],
              "SPY": [Cierre(d0, 100), Cierre(d1, 102)]}

    evidence = _evidencia_formacion(contexto, series, d1, [d0, d1])

    assert evidence["formacion"]["estado_foto"] == "sin_datos"
    assert evidence["posiciones"][0]["reglas"][0]["cumple"] is None
    assert evidence["posiciones"][0]["reglas"][0]["motivo"] == \
        "No se conserva la foto exacta de formación."
    assert evidence["cambios"]["salidas"][0]["causa"] == "no_disponible"


def test_cambios_distingue_metodologia_cambiada_de_exclusion_manual() -> None:
    d0, d1 = date(2026, 8, 3), date(2026, 8, 4)
    series = {"AAA": [Cierre(d0, 100), Cierre(d1, 101)],
              "BBB": [Cierre(d0, 100), Cierre(d1, 99)],
              "SPY": [Cierre(d0, 100), Cierre(d1, 102)]}
    context_method = _contexto_evidencia(receta_actual_id=18)
    method = _evidencia_formacion(context_method, series, d1, [d0, d1])
    context_excluded = _contexto_evidencia(excluir=["BBB"])
    excluded = _evidencia_formacion(context_excluded, series, d1, [d0, d1])

    assert method["cambios"]["salidas"][0]["causa"] == "metodologia_cambiada"
    assert excluded["cambios"]["salidas"][0]["causa"] == "excluida_manual"


def test_cartera_mantenida_marca_su_origen_sin_afirmar_una_seleccion_nueva() -> None:
    contexto = _contexto_evidencia(mantenida=True, misma_cartera=True)
    d0, d1 = date(2026, 8, 3), date(2026, 8, 4)
    series = {"AAA": [Cierre(d0, 100), Cierre(d1, 101)],
              "SPY": [Cierre(d0, 100), Cierre(d1, 102)]}

    evidence = _evidencia_formacion(contexto, series, d1, [d0, d1])

    assert evidence["formacion"]["metodo"] == "mantenida"
    assert evidence["posiciones"][0]["origen"] == "mantenida"
    assert evidence["cambios"]["entradas"] == []
    assert evidence["cambios"]["salidas"] == []


def test_rentabilidad_de_posicion_incluye_dividendo_y_split_en_extremos_comunes() -> None:
    d0, d1, d2 = date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3)
    series = {
        "AAA": [Cierre(d0, 100), Cierre(d1, 101, dividendo=1),
                Cierre(d2, 51, split=2)],
        "SPY": [Cierre(d0, 100), Cierre(d1, 101), Cierre(d2, 102)],
    }

    result = _rendimiento_por_posicion(["AAA"], d0, d2, series, [d0, d1, d2])["AAA"]

    # Day 1 reinvests the dividend (102/100); day 2 applies the 2:1 split
    # (51*2/101). The exact stored-close total return is their product minus one.
    assert result["rentabilidad_pct"] == pytest.approx(100 * ((102 / 100) * (102 / 101) - 1))
    assert result["sp500_pct"] == pytest.approx(2.0)
    assert result["diferencia_pp"] == pytest.approx(
        100 * ((102 / 100) * (102 / 101) - 1) - 2.0)
    assert result["incompleta"] is False


@pytest.mark.parametrize("series", [
    {"AAA": [Cierre(date(2026, 10, 2), 101)],
     "SPY": [Cierre(date(2026, 10, 1), 100), Cierre(date(2026, 10, 2), 101)]},
    {"AAA": [Cierre(date(2026, 10, 1), 100), Cierre(date(2026, 10, 2), 101)],
     "SPY": [Cierre(date(2026, 10, 2), 101)]},
])
def test_rentabilidad_sin_base_o_fin_comun_no_sustituye_cierres(series: dict) -> None:
    base, limite = date(2026, 10, 1), date(2026, 10, 2)

    result = _rendimiento_por_posicion(["AAA"], base, limite, series, [base, limite])["AAA"]

    assert result["estado"] == "sin_datos"
    assert result["hasta"] is None
    assert result["rentabilidad_pct"] is None
    assert result["sp500_pct"] is None
    assert result["diferencia_pp"] is None
