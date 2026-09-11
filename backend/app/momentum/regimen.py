"""Termómetro de régimen del universo de momentum (10-sep-2026): retorno a 60 sesiones de una
cesta equiponderada de los tickers activos. SOLO informativo -- nunca bloquea ni filtra nada,
ver docs/momentum-sim/RESULTADOS.md para el porqué (un solo episodio histórico real, no hay
base para automatizarlo). Se enseña en la sala y se guarda, congelado, en cada señal nueva --
control de decisión siempre de Manuel (ver [[momentum-discovery-design]]).

Detectado auditando el racimo rojo de agosto-2026: la estrategia rinde MEJOR cuando el S&P está
débil (compra caídas de verdad) y PEOR cuando el S&P está tranquilo pero el sector propio de
estos nombres lleva meses cayendo por su cuenta -- el SPY no lo ve, esta cesta sí.
"""

from __future__ import annotations

import logging

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

VENTANA = 60          # sesiones de mercado
UMBRAL = -10.0         # % bajo el cual "el gate la habría bloqueado" (informativo, no aplicado)


def cesta_60d(universo: list[str]) -> float | None:
    """Retorno a `VENTANA` sesiones (hoy) de la cesta equiponderada del universo dado.
    `None` si no hay universo o falla la descarga -- nunca rompe el escaneo por esto."""
    if not universo:
        return None
    try:
        df = yf.download(universo, period="6mo", interval="1d", auto_adjust=True,
                         progress=False)["Close"]
    except Exception:
        logger.warning("No se pudo calcular la cesta de régimen.", exc_info=True)
        return None
    if df.empty or len(df) < VENTANA + 1:
        return None
    cesta = df.pct_change().mean(axis=1).add(1).cumprod()
    if len(cesta) < VENTANA + 1 or pd.isna(cesta.iloc[-1]) or pd.isna(cesta.iloc[-VENTANA - 1]):
        return None
    return float((cesta.iloc[-1] / cesta.iloc[-VENTANA - 1] - 1) * 100)
