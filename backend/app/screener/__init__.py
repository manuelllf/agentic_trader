"""Capa 1 · Universo (determinista, sin LLM).

Barre el mercado US entero (sin suelo ni techo de capitalización — ver
`config.py::universe_market_cap_min/max`) y aplica solo higiene de liquidez (precio, dólar-
volumen, tope de nombres). El LLM (Capa 2, `agents/`) juzga después, sobre el universo entero
en el pre-score y sobre los finalistas en el informe profundo.
"""
