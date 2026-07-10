"""Indicadores técnicos y detección de soporte (numpy/pandas puro, sin LLM).

Funciones puras sobre Series → fáciles de testear. Aquí vive la lógica de "¿está en un
soporte real?" y "¿ha perforado el soporte estructural?" que pediste.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd


def clip01(x: float) -> float:
    """Recorta a [0, 1]."""
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def soft_sat(x: float, scale: float) -> float:
    """Saturación suave y MONÓTONA: 0 en x<=0, tiende a 1 sin llegar nunca.

    Clave para rankear: a diferencia de un escalón (buckets), da a cada valor un score
    propio → sin empates que el orden estable rompa alfabéticamente.
    """
    return 1.0 - math.exp(-x / scale) if x > 0 else 0.0


def sma(close: pd.Series, period: int) -> float:
    if len(close) < period:
        return float("nan")
    return float(close.rolling(period).mean().iloc[-1])


def rsi(close: pd.Series, period: int = 14) -> float:
    """RSI de Wilder; último valor (0-100)."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    out = (100 - 100 / (1 + rs)).where(avg_loss != 0, 100.0)
    return float(out.iloc[-1])


def pct_change_ndays(close: pd.Series, n: int) -> float:
    """% de cambio en las últimas n velas."""
    if len(close) < n + 1:
        return 0.0
    return float((close.iloc[-1] / close.iloc[-1 - n] - 1) * 100)


def pct_below_ath(close: pd.Series) -> float:
    """% por debajo del máximo histórico del periodo (proxy de recorrido/asimetría)."""
    ath = float(close.max())
    if ath == 0:
        return 0.0
    return float((1 - close.iloc[-1] / ath) * 100)


def swing_lows(low: pd.Series, order: int = 5, lookback: int = 180) -> list[float]:
    """Mínimos locales recientes (niveles donde el precio ha rebotado) = soportes candidatos."""
    s = low.iloc[-lookback:] if len(low) > lookback else low
    vals = s.values
    levels: list[float] = []
    for i in range(order, len(vals) - order):
        window = vals[i - order : i + order + 1]
        if vals[i] == window.min():
            levels.append(float(vals[i]))
    return levels


@dataclass(frozen=True)
class SupportAnalysis:
    price: float
    ma50: float
    ma200: float
    nearest_support: float          # soporte fuerte igual o por debajo del precio
    dist_to_support_pct: float      # % del precio por encima de ese soporte
    at_support: bool                # el precio está pegado a un soporte fuerte
    broke_structural: bool          # ha perforado el soporte estructural (MA200)


def analyze_support(close: pd.Series, low: pd.Series) -> SupportAnalysis:
    price = float(close.iloc[-1])
    ma50 = sma(close, 50)
    ma200 = sma(close, 200)

    # Niveles de soporte candidatos: MAs + mínimos locales recientes.
    candidates = [lvl for lvl in (ma50, ma200) if not np.isnan(lvl)]
    candidates += swing_lows(low)

    # Soporte fuerte = el nivel más alto que esté en o por debajo del precio (con 2% de margen).
    below = [c for c in candidates if c <= price * 1.02]
    nearest = max(below) if below else price
    dist = (price - nearest) / price * 100 if price else 0.0

    # "En soporte": el precio está entre 0 y ~4% por encima de un soporte fuerte.
    at_support = 0.0 <= dist <= 4.0
    # Rotura estructural: por debajo de la MA200 de forma significativa.
    broke_structural = (not np.isnan(ma200)) and price < ma200 * 0.98

    return SupportAnalysis(
        price=price,
        ma50=ma50,
        ma200=ma200,
        nearest_support=nearest,
        dist_to_support_pct=round(dist, 2),
        at_support=at_support,
        broke_structural=broke_structural,
    )
