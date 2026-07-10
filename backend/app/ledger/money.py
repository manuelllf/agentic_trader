"""Dinero exacto: tipo SQLAlchemy que guarda `Decimal` como TEXTO.

SQLite no tiene DECIMAL nativo y SQLAlchemy lo degradaría a float → errores de redondeo
en dinero real. Guardándolo como texto y cargándolo como `Decimal`, la aritmética es
exacta y además el valor es legible cuando abres el `.sqlite`. Cero `float` en el dinero.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

CENTS = Decimal("0.01")


class DecimalStr(TypeDecorator):
    """Persiste `Decimal` como TEXT exacto."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        return str(Decimal(value))

    def process_result_value(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        return Decimal(value)


def D(value) -> Decimal:  # noqa: ANN001, N802
    """Convierte a Decimal de forma segura (acepta str, int, float, Decimal)."""
    return value if isinstance(value, Decimal) else Decimal(str(value))


def to_cents(value) -> Decimal:  # noqa: ANN001
    """Redondea a céntimos (2 decimales) para importes de dinero."""
    return D(value).quantize(CENTS, rounding=ROUND_HALF_UP)
