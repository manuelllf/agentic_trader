"""Precios de la IA de la liga (plan §10 y §16). 1 crédito = 0,01 $ (`creditos_movimientos.importe`
cuenta créditos, no dólares). Provisionales hasta medir en F6; conversor, moderación, prueba sin
pregunta y la jornada nunca cobran."""

from __future__ import annotations

import math
from decimal import Decimal

CREDITOS_POR_1000_EMPRESAS = 10
CREDITOS_LECTURA = Decimal(5)


def precio_pregunta(n_evaluadas: int) -> Decimal:
    """`ceil(n_evaluadas * 10 / 1000)`, mínimo 1 crédito."""
    return Decimal(max(1, math.ceil(n_evaluadas * CREDITOS_POR_1000_EMPRESAS / 1000)))


def precio_lectura() -> Decimal:
    return CREDITOS_LECTURA
