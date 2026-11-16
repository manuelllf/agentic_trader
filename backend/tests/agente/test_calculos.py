from __future__ import annotations

import math

import numpy as np
import pytest

from app.agente import calculos as c


def _phi(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def test_media_movil():
    assert c.media_movil([1, 2, 3, 4, 5], 3) == pytest.approx(4.0)
    assert c.media_movil([1, 2, 3], 3) == pytest.approx(2.0)


def test_media_movil_invalida():
    assert c.media_movil([1, 2], 3) is None
    assert c.media_movil([1, 2], 0) is None
    assert c.media_movil([], 1) is None
    assert c.media_movil([1, float("nan")], 2) is None


def test_caida_desde_maximo():
    assert c.caida_desde_maximo([10, 20, 15]) == pytest.approx(-0.25)
    assert c.caida_desde_maximo([10, 20]) == pytest.approx(0.0)


def test_caida_maxima_dos_valles():
    # Primer valle: 100 a 80 (-20%); segundo: 120 a 60 (-50%).
    serie = [100, 80, 110, 120, 90, 60, 100]
    assert c.caida_maxima(serie) == pytest.approx(-0.5)
    assert c.caida_maxima([1, 2, 3]) == pytest.approx(0.0)


def test_caidas_invalidas():
    for f in (c.caida_desde_maximo, c.caida_maxima):
        assert f([]) is None
        assert f([10, 0, 5]) is None
        assert f([10, -1]) is None
        assert f([10, float("inf")]) is None


def test_rsi_siempre_al_alza_es_100():
    assert c.rsi([1, 2, 3, 4, 5, 6], n=3) == 100.0


def test_rsi_constante_es_50():
    assert c.rsi([5.0] * 20) == 50.0


def test_rsi_a_mano_n3():
    # Cambios: +2, -1, +3, -2. Primera media (3 cambios): sube 5/3, baja 1/3.
    # Cambio -2: sube (5/3*2+0)/3 = 10/9, baja (1/3*2+2)/3 = 8/9. RSI = 100 - 100/(1+10/8).
    rs = c.rsi([10, 12, 11, 14, 12], n=3)
    assert rs == pytest.approx(100 - 100 / (1 + 10 / 8))


def test_rsi_solo_baja_es_0():
    assert c.rsi([6, 5, 4, 3], n=3) == pytest.approx(0.0)


def test_rsi_invalido():
    assert c.rsi([1, 2, 3], n=3) is None
    assert c.rsi([1, 2, 3, 4], n=0) is None
    assert c.rsi([1, 2, float("nan"), 4], n=3) is None


def test_volatilidad_rendimiento_constante_es_cero():
    serie = [100 * 1.01**i for i in range(10)]
    assert c.volatilidad_anual(serie) == pytest.approx(0.0, abs=1e-12)


def test_volatilidad_escala_con_raiz_de_dias():
    serie = [100, 102, 99, 103, 101, 105]
    v252 = c.volatilidad_anual(serie, 252)
    v63 = c.volatilidad_anual(serie, 63)
    assert v252 is not None and v63 is not None
    assert v252 / v63 == pytest.approx(math.sqrt(252 / 63))
    rend = np.diff(np.log(serie))
    assert v252 == pytest.approx(float(np.std(rend, ddof=1)) * math.sqrt(252))


def test_volatilidad_invalida():
    assert c.volatilidad_anual([100, 101]) is None
    assert c.volatilidad_anual([100, 0, 101]) is None
    assert c.volatilidad_anual([100, -5, 101]) is None
    assert c.volatilidad_anual([100, 101, 102], dias_por_anio=0) is None


def test_cagr():
    assert c.cagr(100, 200, 1) == pytest.approx(1.0)
    assert c.cagr(100, 400, 2) == pytest.approx(1.0)
    assert c.cagr(100, 50, 1) == pytest.approx(-0.5)


def test_cagr_invalido():
    assert c.cagr(0, 100, 1) is None
    assert c.cagr(100, 0, 1) is None
    assert c.cagr(100, 200, 0) is None
    assert c.cagr(100, 200, -1) is None
    assert c.cagr(100, float("nan"), 1) is None


def test_valor_presente():
    assert c.valor_presente(200, 1.0, 1) == pytest.approx(100.0)
    assert c.valor_presente(121, 0.1, 2) == pytest.approx(100.0)
    assert c.valor_presente(100, 0.1, 0) == pytest.approx(100.0)


def test_valor_presente_inverso_de_valor_futuro():
    vp = c.valor_presente(150, 0.08, 5)
    assert vp is not None
    assert vp * 1.08**5 == pytest.approx(150)


def test_valor_presente_invalido():
    assert c.valor_presente(100, -1.0, 1) is None
    assert c.valor_presente(100, 0.1, -1) is None
    assert c.valor_presente(float("inf"), 0.1, 1) is None
    assert c.valor_presente(100, 1e-9 - 1, 1e6) is None


def test_retorno_anual_esperado():
    assert c.retorno_anual_esperado(100, 200, 1) == pytest.approx(1.0)
    assert c.retorno_anual_esperado(100, 200, 1, dividendo_anual=3) == pytest.approx(1.03)


def test_retorno_anual_esperado_invalido():
    assert c.retorno_anual_esperado(0, 200, 1) is None
    assert c.retorno_anual_esperado(100, 200, 0) is None
    assert c.retorno_anual_esperado(100, 200, 1, dividendo_anual=-1) is None
    assert c.retorno_anual_esperado(100, 200, 1, dividendo_anual=float("nan")) is None


def test_margen_de_seguridad():
    assert c.margen_de_seguridad(80, 100) == pytest.approx(0.2)
    assert c.margen_de_seguridad(120, 100) == pytest.approx(-0.2)
    assert c.margen_de_seguridad(0, 100) is None
    assert c.margen_de_seguridad(80, 0) is None
    assert c.margen_de_seguridad(80, -10) is None


def test_meses_de_caja():
    assert c.meses_de_caja(300, 30) == pytest.approx(30.0)
    assert c.meses_de_caja(0, 30) == pytest.approx(0.0)
    assert c.meses_de_caja(300, 0) is None
    assert c.meses_de_caja(300, -5) is None
    assert c.meses_de_caja(-1, 30) is None
    assert c.meses_de_caja(float("nan"), 30) is None


def test_dilucion():
    assert c.dilucion(100, 110) == pytest.approx(0.1)
    assert c.dilucion(100, 90) == pytest.approx(-0.1)
    assert c.dilucion(0, 110) is None
    assert c.dilucion(100, 0) is None
    assert c.dilucion(100, float("inf")) is None


def test_prob_sin_deriva_en_log_coincide_con_formula_cerrada():
    # La deriva del logaritmo es nu = mu - sigma^2/2; con mu = sigma^2/2 vale 0.
    p, nivel, sigma, dias = 100.0, 110.0, 0.3, 60
    mu = sigma**2 / 2
    x = math.log(nivel / p)
    esperado = 2 * (1 - _phi(abs(x) / (sigma * math.sqrt(dias / 252))))
    assert c.prob_tocar_nivel(p, nivel, sigma, dias, mu_anual=mu) == pytest.approx(esperado)
    # Por abajo, mismo |x| en logaritmo.
    p_abajo = c.prob_tocar_nivel(p, p * math.exp(-x), sigma, dias, mu_anual=mu)
    assert p_abajo == pytest.approx(esperado)


def test_prob_nivel_igual_al_precio_es_uno():
    assert c.prob_tocar_nivel(100, 100, 0.3, 10) == 1.0


def test_prob_monotonia():
    base = c.prob_tocar_nivel(100, 115, 0.3, 30)
    mas_dias = c.prob_tocar_nivel(100, 115, 0.3, 90)
    mas_sigma = c.prob_tocar_nivel(100, 115, 0.5, 30)
    assert base is not None and mas_dias is not None and mas_sigma is not None
    assert 0.0 < base < mas_dias <= 1.0
    assert base < mas_sigma <= 1.0


def test_prob_deriva_sube_arriba_y_baja_abajo():
    arriba0 = c.prob_tocar_nivel(100, 115, 0.3, 60, mu_anual=0.0)
    arriba1 = c.prob_tocar_nivel(100, 115, 0.3, 60, mu_anual=0.3)
    abajo0 = c.prob_tocar_nivel(100, 85, 0.3, 60, mu_anual=0.0)
    abajo1 = c.prob_tocar_nivel(100, 85, 0.3, 60, mu_anual=0.3)
    assert None not in (arriba0, arriba1, abajo0, abajo1)
    assert arriba1 > arriba0
    assert abajo1 < abajo0


@pytest.mark.parametrize(
    ("nivel", "mu"),
    [(115.0, 0.0), (115.0, 0.10), (85.0, 0.0), (85.0, 0.10)],
)
def test_prob_contra_montecarlo(nivel: float, mu: float):
    precio, sigma, dias, trayectorias = 100.0, 0.2, 60, 20_000
    dt = 1 / 252
    rng = np.random.default_rng(0)
    pasos = (mu - sigma**2 / 2) * dt + sigma * math.sqrt(dt) * rng.standard_normal(
        (trayectorias, dias)
    )
    log_rel = np.cumsum(pasos, axis=1)
    x = math.log(nivel / precio)
    tocadas = (log_rel.max(axis=1) >= x) if x > 0 else (log_rel.min(axis=1) <= x)
    simulada = float(tocadas.mean())
    # Con pasos diarios se pierden toques entre cierres: la simulación subestima un poco
    # frente a la fórmula continua, de ahí la tolerancia holgada.
    esperada = c.prob_tocar_nivel(precio, nivel, sigma, dias, mu_anual=mu)
    assert esperada is not None
    assert abs(simulada - esperada) < 0.03


def test_prob_extremos_sin_overflow():
    for nivel in (1e-6, 1e6):
        for mu in (-50.0, 0.0, 50.0):
            r = c.prob_tocar_nivel(100, nivel, 0.01, 5000, mu_anual=mu)
            assert r is not None and math.isfinite(r) and 0.0 <= r <= 1.0
    # Deriva enorme hacia arriba con nivel por debajo: exponente gigante.
    r = c.prob_tocar_nivel(100, 50, 0.01, 1, mu_anual=1e5)
    assert r is not None and 0.0 <= r <= 1.0
    r = c.prob_tocar_nivel(100, 1e6, 0.01, 1, mu_anual=-1e5)
    assert r is not None and 0.0 <= r <= 1.0


def test_prob_invalida():
    assert c.prob_tocar_nivel(0, 100, 0.3, 10) is None
    assert c.prob_tocar_nivel(100, 0, 0.3, 10) is None
    assert c.prob_tocar_nivel(100, -5, 0.3, 10) is None
    assert c.prob_tocar_nivel(100, 110, 0, 10) is None
    assert c.prob_tocar_nivel(100, 110, -0.3, 10) is None
    assert c.prob_tocar_nivel(100, 110, 0.3, 0) is None
    assert c.prob_tocar_nivel(100, 110, 0.3, 10, dias_por_anio=0) is None
    assert c.prob_tocar_nivel(100, float("nan"), 0.3, 10) is None
    assert c.prob_tocar_nivel(100, 110, 0.3, 10, mu_anual=float("inf")) is None

