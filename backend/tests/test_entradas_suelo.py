"""`entradas_suelo`: UNA entrada abierta por nivel a la vez. Mientras la anterior de ese nivel
no se resuelve (objetivo o 90 días), volver a la banda ±10% no crea otra -- la que hay es la
misma tesis. Cuando resuelve, la siguiente salida-y-vuelta al nivel sí abre una nueva.
"""

from __future__ import annotations

import pandas as pd

from app.momentum import signals


def _serie(tramos: list[tuple[int, float]]) -> tuple[pd.Series, pd.Series]:
    """`tramos` = [(n_dias, precio_constante), ...] -> Close y Open (iguales) diarios en NY."""
    precios: list[float] = []
    for n, p in tramos:
        precios.extend([p] * n)
    idx = pd.date_range("2025-08-01", periods=len(precios), freq="D", tz="America/New_York")
    s = pd.Series(precios, index=idx)
    return s, s


def test_una_entrada_abierta_por_nivel():
    # ATH 100 -> desplome a 30 (70% bajo ATH, pasa el 60%) -> rebote a 40 (>20%, confirma el
    # mínimo en 30) -> se queda pegado a ~31 mucho tiempo (nunca +11%, no resuelve por objetivo)
    # -> aún dentro de 90 días vuelve a tocar 30. Debe haber UNA sola entrada.
    # Nivel de referencia = 30 -> banda 27-33. Objetivo flojo desde 31 = 34.4: para que la
    # entrada 1 NO se resuelva, el precio nunca pasa de 34 y todo cabe en <90 días.
    close, opn = _serie([
        (30, 100.0),   # ATH y nivel alto de referencia para el zigzag
        (10, 30.0),    # desplome: mínimo del zigzag
        (10, 40.0),    # rebote >20% -> confirma el mínimo; 40 fuera de la banda
        (5, 31.0),     # vuelve a la banda -> ENTRADA 1
        (15, 32.0),    # orbita el nivel, sin llegar al objetivo -> entrada 1 sigue abierta
        (5, 34.0),     # sale de la banda (pero por debajo del objetivo 34.4)
        (5, 31.0),     # vuelve a la banda con la entrada 1 TODAVÍA abierta -> NO debe disparar
    ])
    ents = signals.entradas_suelo(close, opn, ath=100.0)
    assert len(ents) == 1, [str(e["entry_date"].date()) for e in ents]
    # salió de la banda (34) y volvió (31) con la entrada abierta -> reactivar
    assert ents[0]["reactivar"] is True


def test_no_reactiva_si_no_salio_de_la_banda():
    # La entrada abierta nunca sale de la banda 27-33 -> no hay nada que reactivar.
    close, opn = _serie([
        (30, 100.0),
        (10, 30.0),
        (10, 40.0),
        (5, 31.0),     # ENTRADA 1
        (20, 32.0),    # se queda pegada al nivel, nunca sale de la banda
    ])
    ents = signals.entradas_suelo(close, opn, ath=100.0)
    assert len(ents) == 1
    assert ents[0]["reactivar"] is False


def test_nueva_entrada_tras_resolver_por_tiempo():
    # Igual, pero dejamos pasar >90 días pegados al nivel (entrada 1 resuelve por 'tiempo') y
    # luego una salida-y-vuelta a la banda: ahí SÍ debe abrir una segunda entrada.
    close, opn = _serie([
        (30, 100.0),
        (10, 30.0),
        (10, 40.0),
        (3, 31.0),     # ENTRADA 1
        (95, 32.0),    # >90 días sin objetivo -> entrada 1 resuelve por tiempo
        (5, 45.0),     # sale de la banda (re-arma el nivel)
        (5, 31.0),     # vuelve -> ENTRADA 2
        (10, 33.0),
    ])
    ents = signals.entradas_suelo(close, opn, ath=100.0)
    assert len(ents) == 2, [str(e["entry_date"].date()) for e in ents]
    assert ents[0]["entry_date"] < ents[1]["entry_date"]


def test_sin_vuelta_no_hay_entrada():
    # Nivel confirmado pero el precio nunca vuelve a la banda -> cero entradas.
    close, opn = _serie([
        (30, 100.0),
        (10, 30.0),
        (60, 55.0),    # rebote y se queda lejos, nunca vuelve a 27-33
    ])
    assert signals.entradas_suelo(close, opn, ath=100.0) == []
