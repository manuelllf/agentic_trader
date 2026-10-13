"""Métricas nuevas de la foto, con sus escalas y sin base de datos."""

from __future__ import annotations

import json

import pytest

from app.liga.motor.catalogo import EmpresaFoto
from app.liga.procesos.datos import _derivadas, _metricas_catalogo

EJEMPLO = {
    "freeCashflow": 50_000_000,
    "payoutRatio": 0.4,
    "heldPercentInsiders": 0.025,
    "shortPercentOfFloat": 0.08,
    "52WeekChange": 0.3,
    "SandP52WeekChange": 0.1,
    "averageVolume": 2_000_000,
}
CAMPOS = {"fcf_pct", "payout_pct", "directivos_pct", "cortos_pct",
          "vs_sp_52s", "volumen_usd_dia"}


@pytest.mark.parametrize(("campo", "esperado"), [
    ("fcf_pct", 5), ("payout_pct", 40), ("directivos_pct", 2.5),
    ("cortos_pct", 8), ("vs_sp_52s", 20), ("volumen_usd_dia", 50),
])
def test_derivadas_con_unidades_del_motor(campo, esperado):
    assert _derivadas(EJEMPLO, 25, 1_000_000_000)[campo] == pytest.approx(esperado)


@pytest.mark.parametrize("metricas", [None, {}, "{}"])
def test_ausencias(metricas):
    assert _derivadas(metricas, None, None) == dict.fromkeys(CAMPOS)


@pytest.mark.parametrize(("clave", "campo"), [
    ("freeCashflow", "fcf_pct"), ("payoutRatio", "payout_pct"),
    ("heldPercentInsiders", "directivos_pct"), ("shortPercentOfFloat", "cortos_pct"),
    ("52WeekChange", "vs_sp_52s"), ("SandP52WeekChange", "vs_sp_52s"),
    ("averageVolume", "volumen_usd_dia"),
])
@pytest.mark.parametrize("valor", [None, True, False, "0.5"])
def test_entrada_ausente_o_no_numerica(clave, campo, valor):
    assert _derivadas({**EJEMPLO, clave: valor}, 25, 1_000_000_000)[campo] is None


@pytest.mark.parametrize("valor", [None, 0, -1, True, False])
def test_precio_y_capitalizacion_no_validos(valor):
    assert _derivadas(EJEMPLO, valor, 1_000_000_000)["volumen_usd_dia"] is None
    assert _derivadas(EJEMPLO, 25, valor)["fcf_pct"] is None


def test_cadena_json_equivale_al_diccionario():
    assert _derivadas(json.dumps(EJEMPLO), 25, 1_000_000_000) == (
        _derivadas(EJEMPLO, 25, 1_000_000_000))


def test_ceros_y_negativos_son_datos():
    datos = _derivadas({clave: 0 for clave in EJEMPLO}, 25, 100)
    assert datos == dict.fromkeys(CAMPOS, 0)
    assert _derivadas({**EJEMPLO, "freeCashflow": -5}, 25, 100)["fcf_pct"] == -5


@pytest.mark.parametrize(("clave", "campo", "valor"), [
    ("priceToBook", "pb", 2), ("enterpriseToEbitda", "ev_ebitda", 8.5),
    ("returnOnAssets", "roa", 0.05), ("profitMargins", "margen_neto", -0.1),
    ("debtToEquity", "deuda_pn_pct", 120), ("currentRatio", "liquidez_corriente", 0),
    ("beta", "beta", 1.2),
])
def test_metricas_directas(clave, campo, valor):
    assert _metricas_catalogo({clave: valor}, 25) == {campo: float(valor)}
    assert _metricas_catalogo(json.dumps({clave: valor}), 25) == {campo: float(valor)}
    assert _metricas_catalogo({clave: True}, 25) == {}
    assert getattr(EmpresaFoto("X"), campo) is None


def test_derivadas_encajan_en_empresa_foto():
    empresa = EmpresaFoto("X", **_derivadas(EJEMPLO, 25, 1_000_000_000))
    assert empresa.fcf_pct == 5
    for campo in CAMPOS:
        assert getattr(EmpresaFoto("X"), campo) is None
