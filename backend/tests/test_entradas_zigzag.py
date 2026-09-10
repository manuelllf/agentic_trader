"""`entradas_zigzag`: además del -40% desde el último pico, la entrada exige estar >=45% bajo
el ATH real (`ZIGZAG_MIN_BAJO_ATH`). Un -40% desde un pico que fue un spike deja el precio aún
caro; esa banda 40-45% bajo ATH concentraba los timeouts rojos.
"""

from __future__ import annotations

import pandas as pd

from app.momentum import signals


def _serie(vals: list[float]) -> pd.Series:
    idx = pd.date_range("2025-09-05", periods=len(vals), freq="D", tz="America/New_York")
    return pd.Series(vals, index=idx)


def test_no_dispara_si_no_llega_al_45_bajo_ath():
    # ATH = 100. Cae a 58 (-42% del pico Y -42% bajo ATH): -40% cumplido pero <45% bajo ATH.
    px = _serie([100.0] * 10 + [58.0] * 3 + [52.0] * 5)
    assert signals.entradas_zigzag(px, [], 0.40) == []


def test_dispara_si_llega_al_45_bajo_ath():
    # ATH = 100. Cae directa a 53 (-47%): cumple -40% del pico y >=45% bajo ATH.
    px = _serie([100.0] * 10 + [53.0] * 6)
    ents = signals.entradas_zigzag(px, [], 0.40)
    assert len(ents) == 1
    assert round(ents[0]["entry_price"], 1) == 53.0


def test_el_disparo_bloqueado_consume_el_tramo():
    # Toca -42% (bloqueado por el filtro ATH) y LUEGO baja a 50 (-50%): NO se reintenta,
    # el tramo ya se consumio en el primer -40%.
    px = _serie([100.0] * 10 + [58.0] * 3 + [50.0] * 6)
    assert signals.entradas_zigzag(px, [], 0.40) == []


def test_ath_min_0_recupera_el_comportamiento_viejo():
    # El mismo -42% que el filtro bloquea, con ath_min=0 SI dispara (comportamiento pre-filtro).
    px = _serie([100.0] * 10 + [58.0] * 6)
    assert signals.entradas_zigzag(px, [], 0.40) == []                    # filtro por defecto (0.45)
    assert len(signals.entradas_zigzag(px, [], 0.40, ath_min=0.0)) == 1   # sin filtro
