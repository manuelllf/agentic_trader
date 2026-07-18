"""Indicadores técnicos (pandas puro, sin LLM).

Funciones puras sobre Series → fáciles de testear.
"""

from __future__ import annotations

import pandas as pd


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
