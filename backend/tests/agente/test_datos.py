"""Barras de Yahoo: deshacer el ajuste por splits, descarga simulada y búsquedas por día."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

from app.agente import datos
from app.agente.datos import Barra, FilaYahoo, barra_del_dia, deshacer_ajuste, ultimo_cierre_hasta


def test_descargar_reintenta_si_yahoo_responde_vacio(monkeypatch: pytest.MonkeyPatch) -> None:
    import yfinance as yf

    llamadas: list[int] = []

    def vacio(*args: object, **kwargs: object) -> pd.DataFrame:
        llamadas.append(1)
        return pd.DataFrame()

    monkeypatch.setattr(yf, "download", vacio)
    monkeypatch.setattr(datos, "_PAUSA_S", 0.0)
    assert datos.descargar(["AAA"], date(2026, 11, 1)) == {}
    assert len(llamadas) == datos.INTENTOS_YAHOO


def test_descargar_acepta_el_segundo_intento(monkeypatch: pytest.MonkeyPatch) -> None:
    import yfinance as yf

    llamadas: list[int] = []
    fechas = pd.to_datetime(["2026-11-16"])
    buena = pd.DataFrame({("AAA", "Open"): [100.0], ("AAA", "High"): [101.0],
                          ("AAA", "Low"): [99.0], ("AAA", "Close"): [100.5],
                          ("AAA", "Volume"): [1000], ("AAA", "Dividends"): [0.0],
                          ("AAA", "Stock Splits"): [0.0]}, index=fechas)
    buena.columns = pd.MultiIndex.from_tuples(buena.columns)

    def primero_vacio_luego_datos(*args: object, **kwargs: object) -> pd.DataFrame:
        llamadas.append(1)
        return pd.DataFrame() if len(llamadas) == 1 else buena

    monkeypatch.setattr(yf, "download", primero_vacio_luego_datos)
    monkeypatch.setattr(datos, "_PAUSA_S", 0.0)
    r = datos.descargar(["AAA"], date(2026, 11, 1))
    assert len(llamadas) == 2 and r["AAA"][0].cierre == 100.5

NAN = float("nan")


def fila(dia: date, close: float = 10.0, *, open_: float = 9.0, high: float = 11.0,
         low: float = 8.0, volume: float = 1000.0, dividend: float = 0.0,
         split: float = 0.0) -> FilaYahoo:
    return FilaYahoo(dia, open_, high, low, close, volume, dividend, split)


def barra(dia: date, cierre: str = "10") -> Barra:
    return Barra(dia, None, None, None, Decimal(cierre), None, Decimal(0), Decimal(1))


def test_split_en_medio_multiplica_los_dias_previos() -> None:
    filas = [
        fila(date(2026, 3, 2), 5.0, open_=4.5, high=5.5, low=4.0, volume=2000, dividend=0.25),
        fila(date(2026, 3, 3), 5.2, open_=5.0, high=5.6, low=4.9, volume=2000, split=2.0),
        fila(date(2026, 3, 4), 5.4, open_=5.2, high=5.8, low=5.1, volume=900),
    ]
    a, b, c = deshacer_ajuste(filas)
    assert (a.apertura, a.maximo, a.minimo, a.cierre) == (
        Decimal("9"), Decimal("11"), Decimal("8"), Decimal("10"))
    assert a.volumen == 1000
    assert a.dividendo == Decimal("0.5")
    assert a.split == Decimal(1)
    assert b.cierre == Decimal("5.2") and b.apertura == Decimal("5") and b.volumen == 2000
    assert b.split == Decimal(2)
    assert c.cierre == Decimal("5.4") and c.volumen == 900 and c.split == Decimal(1)


def test_dos_splits_encadenados_dan_factor_seis() -> None:
    filas = [
        fila(date(2026, 1, 5), 1.0, volume=6000, dividend=0.1),
        fila(date(2026, 2, 5), 2.0, volume=3000, split=2.0),
        fila(date(2026, 3, 5), 3.0, volume=1000, split=3.0),
    ]
    a, b, c = deshacer_ajuste(filas)
    assert a.cierre == Decimal("6") and a.volumen == 1000 and a.dividendo == Decimal("0.6")
    assert b.cierre == Decimal("6") and b.volumen == 1000
    assert c.cierre == Decimal("3") and c.volumen == 1000


def test_ordena_por_dia_aunque_lleguen_desordenadas() -> None:
    filas = [fila(date(2026, 3, 4)), fila(date(2026, 3, 2)), fila(date(2026, 3, 3))]
    assert [b.dia for b in deshacer_ajuste(filas)] == sorted(b.dia for b in deshacer_ajuste(filas))


def test_nan_en_apertura_da_none_y_cierre_nan_descarta_la_fila() -> None:
    filas = [
        fila(date(2026, 3, 2), open_=NAN, high=NAN, low=NAN, volume=NAN),
        fila(date(2026, 3, 3), NAN),
        fila(date(2026, 3, 4), 0.0),
        fila(date(2026, 3, 5), -1.0),
    ]
    barras = deshacer_ajuste(filas)
    assert len(barras) == 1
    b = barras[0]
    assert b.apertura is None and b.maximo is None and b.minimo is None and b.volumen is None
    assert b.cierre == Decimal("10")


def test_split_cero_o_nan_cuenta_como_uno() -> None:
    filas = [fila(date(2026, 3, 2), split=0.0), fila(date(2026, 3, 3), split=NAN),
             fila(date(2026, 3, 4), 10.0, dividend=NAN)]
    barras = deshacer_ajuste(filas)
    assert [b.split for b in barras] == [Decimal(1)] * 3
    assert [b.cierre for b in barras] == [Decimal("10")] * 3
    assert barras[2].dividendo == Decimal(0)


def test_decimales_sin_ruido_de_float() -> None:
    filas = [fila(date(2026, 3, 2), 0.1, dividend=0.1), fila(date(2026, 3, 3), 0.3, split=3.0)]
    a = deshacer_ajuste(filas)[0]
    assert a.cierre == Decimal("0.3") and a.dividendo == Decimal("0.3")


def _df_multi() -> pd.DataFrame:
    idx = pd.to_datetime(["2026-03-02", "2026-03-03"])
    campos = ["Open", "High", "Low", "Close", "Volume", "Dividends", "Stock Splits"]
    datos_aapl = {c: [1.0, 2.0] for c in campos}
    datos_aapl["Close"] = [10.0, 11.0]
    datos_aapl["Stock Splits"] = [0.0, 0.0]
    cols = pd.MultiIndex.from_product([["AAPL", "MSFT"], campos])
    df = pd.DataFrame(index=idx, columns=cols, dtype=float)
    for c in campos:
        df[("AAPL", c)] = datos_aapl[c]
        df[("MSFT", c)] = [NAN, NAN]
    return df


def test_descargar_multiindex_y_ticker_sin_datos_ausente(monkeypatch: pytest.MonkeyPatch) -> None:
    pedidos: list[list[str]] = []

    def falso(tickers: list[str], **_kw: object) -> pd.DataFrame:
        pedidos.append(list(tickers))
        return _df_multi()

    monkeypatch.setattr("yfinance.download", falso)
    out = datos.descargar(["AAPL", "MSFT", "AAPL", "XXXX"], date(2026, 3, 1))
    assert pedidos == [["AAPL", "MSFT", "XXXX"]]
    assert set(out) == {"AAPL"}
    assert [b.cierre for b in out["AAPL"]] == [Decimal("10"), Decimal("11")]
    assert out["AAPL"][0].dia == date(2026, 3, 2)


def test_descargar_un_solo_ticker_con_columnas_simples(monkeypatch: pytest.MonkeyPatch) -> None:
    df = pd.DataFrame(
        {"Open": [4.0], "High": [6.0], "Low": [3.0], "Close": [5.0], "Volume": [100.0],
         "Dividends": [0.0], "Stock Splits": [0.0]},
        index=pd.to_datetime(["2026-03-02"]))
    monkeypatch.setattr("yfinance.download", lambda *_a, **_kw: df)
    out = datos.descargar(["SPY"], date(2026, 3, 1))
    assert out["SPY"] == [Barra(date(2026, 3, 2), Decimal("4"), Decimal("6"), Decimal("3"),
                                Decimal("5"), 100, Decimal(0), Decimal(1))]


def test_descargar_excepcion_devuelve_vacio(monkeypatch: pytest.MonkeyPatch) -> None:
    def roto(*_a: object, **_kw: object) -> pd.DataFrame:
        raise RuntimeError("sin red")

    monkeypatch.setattr("yfinance.download", roto)
    assert datos.descargar(["AAPL"], date(2026, 3, 1)) == {}


def test_descargar_sin_tickers_no_llama_a_yahoo(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_debe(*_a: object, **_kw: object) -> pd.DataFrame:
        raise AssertionError("no debía llamar")

    monkeypatch.setattr("yfinance.download", no_debe)
    assert datos.descargar([], date(2026, 3, 1)) == {}
    assert datos.descargar(["", ""], date(2026, 3, 1)) == {}


def test_barra_del_dia_y_ultimo_cierre_con_festivos() -> None:
    barras = [barra(date(2026, 11, 25), "1"), barra(date(2026, 11, 27), "2"),
              barra(date(2026, 11, 30), "3")]
    assert barra_del_dia(barras, date(2026, 11, 27)) is barras[1]
    assert barra_del_dia(barras, date(2026, 11, 26)) is None  # Acción de Gracias
    assert ultimo_cierre_hasta(barras, date(2026, 11, 26)) is barras[0]
    assert ultimo_cierre_hasta(barras, date(2026, 11, 29)) is barras[1]  # domingo
    assert ultimo_cierre_hasta(barras, date(2026, 11, 30)) is barras[2]
    assert ultimo_cierre_hasta(barras, date(2026, 11, 24)) is None
    assert ultimo_cierre_hasta([], date(2026, 11, 24)) is None
