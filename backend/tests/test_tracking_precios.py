"""Caché de precios por ticker: cada endpoint pedía un conjunto distinto y, con una sola
ranura, se pisaban y se descargaba de Yahoo en cada petición."""

from __future__ import annotations

import pandas as pd
import pytest

from app import tracking


@pytest.fixture(autouse=True)
def _limpia(monkeypatch):  # noqa: ANN001
    monkeypatch.setattr(tracking, "_precios", {})


def _descarga_falsa(pedidos: list, precio: float = 100.0):
    def descargar(tickers, **kw):  # noqa: ANN001, ANN202
        pedidos.append(list(tickers))
        cols = pd.MultiIndex.from_product([tickers, ["Close"]])
        return pd.DataFrame([[precio] * len(tickers)], columns=cols)
    return descargar


def test_solo_descarga_lo_que_falta(monkeypatch) -> None:  # noqa: ANN001
    pedidos: list = []
    monkeypatch.setattr(tracking.yf, "download", _descarga_falsa(pedidos))

    assert tracking.live_prices(["AAA", "BBB"]) == {"AAA": 100.0, "BBB": 100.0}
    tracking.live_prices(["EURUSD=X"])          # otro endpoint, otro conjunto
    tracking.live_prices(["AAA", "EURUSD=X"])   # ya todo en caché: no descarga

    assert pedidos == [["AAA", "BBB"], ["EURUSD=X"]]


def test_caducado_se_refresca_y_si_yahoo_falla_queda_el_ultimo(monkeypatch) -> None:  # noqa: ANN001
    pedidos: list = []
    monkeypatch.setattr(tracking.yf, "download", _descarga_falsa(pedidos, 50.0))
    tracking.live_prices(["AAA"])
    tracking._precios["AAA"] = (0.0, 50.0)       # caducado

    def caido(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise TimeoutError("yahoo lento")

    monkeypatch.setattr(tracking.yf, "download", caido)
    assert tracking.live_prices(["AAA"]) == {"AAA": 50.0}
    assert tracking.live_prices(["ZZZ"]) == {}
