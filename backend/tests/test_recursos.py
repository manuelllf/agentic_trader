"""Medición de CPUs y memoria, y que las descargas de outcomes no se dupliquen."""

from __future__ import annotations

import logging
import threading
import time
from datetime import date

import pytest

from app import recursos, scan_outcomes


def test_cpus_reales_sale_de_la_cuota_del_contenedor(tmp_path, monkeypatch) -> None:
    cuota = tmp_path / "cpu.max"
    monkeypatch.setattr(recursos, "_CUOTA_CPU", cuota)

    cuota.write_text("800000 100000\n")
    assert recursos.cpus_reales() == 8
    cuota.write_text("50000 100000\n")            # medio CPU sigue contando como uno
    assert recursos.cpus_reales() == 1
    cuota.write_text("max 100000\n")              # sin cuota: las que vea el sistema
    assert recursos.cpus_reales() >= 1


def test_los_hilos_de_calculo_tienen_tope(monkeypatch) -> None:
    monkeypatch.setattr(recursos, "cpus_reales", lambda: 48)
    assert recursos.hilos_calculo() == 4
    monkeypatch.setattr(recursos, "cpus_reales", lambda: 2)
    assert recursos.hilos_calculo() == 2


def test_medido_deja_en_el_log_lo_que_engorda_un_trabajo(monkeypatch, caplog) -> None:
    lecturas = iter([300.0, 1100.0])
    monkeypatch.setattr(recursos, "rss_mb", lambda: next(lecturas))

    @recursos.medido("trabajo de prueba")
    def trabajo() -> str:
        return "hecho"

    with caplog.at_level(logging.INFO, logger="app.recursos"):
        assert trabajo() == "hecho"
    assert "Memoria tras trabajo de prueba: 300 → 1100 MB (+800)" in caplog.text


def test_medido_calla_las_variaciones_pequenas(monkeypatch, caplog) -> None:
    lecturas = iter([300.0, 310.0])
    monkeypatch.setattr(recursos, "rss_mb", lambda: next(lecturas))

    with caplog.at_level(logging.INFO, logger="app.recursos"):
        recursos.medido("ruido")(lambda: None)()
    assert caplog.text == ""


def test_dos_visitas_a_la_vez_descargan_una_sola_vez(monkeypatch) -> None:
    yf = pytest.importorskip("yfinance")
    import pandas as pd

    descargas = []

    def descarga_lenta(tickers, **kw):  # noqa: ANN001, ANN003
        descargas.append(tickers)
        time.sleep(0.3)                             # da tiempo a que llegue la segunda visita
        dias = pd.to_datetime(["2026-09-01", "2026-09-02"])
        return pd.DataFrame({"Close": [1.0, 2.0]}, index=dias)

    monkeypatch.setattr(yf, "download", descarga_lenta)
    monkeypatch.setattr(scan_outcomes, "_cache", {})

    resultados = []
    hilos = [threading.Thread(target=lambda: resultados.append(
        scan_outcomes._cierres_ajustados(["SPY"], date(2026, 9, 1)))) for _ in range(2)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()

    assert len(descargas) == 1
    assert resultados[0] == resultados[1] != {}
