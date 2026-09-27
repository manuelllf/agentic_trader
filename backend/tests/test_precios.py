"""`precio_cierre`: cierres tal como se negociaron y rentabilidad total calculada al leer."""

from __future__ import annotations

from datetime import date

import pytest

from app.precios import Cierre, cierre_en, deshacer_ajuste, indice

D1, D2, D3, D4 = date(2026, 9, 1), date(2026, 9, 2), date(2026, 9, 3), date(2026, 9, 4)


def test_deshace_el_ajuste_de_yahoo_por_un_split_posterior():
    """Split 2:1 el día 3. Yahoo devuelve los días 1 y 2 ya divididos entre 2 (también el
    dividendo); guardamos lo que se negoció de verdad."""
    yahoo = [(D1, 50.0, 0.0, 0.0), (D2, 51.0, 0.25, 0.0), (D3, 52.0, 0.0, 2.0),
             (D4, 53.0, 0.0, 0.0)]
    assert deshacer_ajuste(yahoo) == [
        Cierre(D1, 100.0, 0.0, 1.0), Cierre(D2, 102.0, 0.5, 1.0),
        Cierre(D3, 52.0, 0.0, 2.0), Cierre(D4, 53.0, 0.0, 1.0),
    ]


def test_el_split_no_mueve_la_rentabilidad_y_el_dividendo_si():
    cierres = [Cierre(D1, 100.0), Cierre(D2, 102.0, dividendo=0.5), Cierre(D3, 52.0, split=2.0)]
    total = indice(cierres)
    assert total[D2] == pytest.approx(1.025)                  # (102 + 0,5) / 100
    assert total[D3] == pytest.approx(1.025 * 104 / 102)      # 52 × 2 / 102
    assert indice(cierres, dividendos=0)[D2] == pytest.approx(1.02)
    assert indice(cierres, dividendos=0.85)[D2] == pytest.approx(1.02425)


def test_cierre_en_un_dia_sin_bolsa_es_el_anterior():
    cierres = [Cierre(D1, 100.0), Cierre(D3, 110.0)]
    assert cierre_en(cierres, D2) == 100.0
    assert cierre_en(cierres, D4) == 110.0
    assert cierre_en(cierres, date(2026, 8, 31)) is None
