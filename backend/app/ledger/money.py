"""Dinero exacto: tipo SQLAlchemy que persiste `Decimal` sin pasar por `float` en ningún dialecto.

Por dialecto, no un tipo fijo: en Postgres usa `NUMERIC(20,8)` nativo; en SQLite (sin tipo
decimal real — sigue siendo el motor de producción hasta que la migración a Supabase conmute
`DATABASE_URL`) sigue guardando TEXTO, como siempre. Fijar `impl` a `Numeric` sin condición
habría roto cada escritura de dinero contra SQLite desde el primer despliegue de este cambio,
antes incluso de que Postgres entrase en juego — inaceptable con dinero real corriendo ahora
mismo. Cero `float` en el dinero, en cualquiera de los dos motores.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Numeric, String
from sqlalchemy.types import TypeDecorator

CENTS = Decimal("0.01")


class DecimalStr(TypeDecorator):
    """Persiste `Decimal` exacto: `NUMERIC(20,8)` en Postgres, TEXT en cualquier otro dialecto."""

    impl = String
    cache_ok = True

    def load_dialect_impl(self, dialect):  # noqa: ANN001
        if dialect.name == "postgresql":
            # Sin (precision, scale) fijos: NUMERIC a secas es precisión arbitraria en
            # Postgres, igual que Decimal de Python. Con (20,8) se truncaba dinero real —
            # el coste medio de una posición se calcula con divisiones encadenadas que
            # llegan a 26+ decimales sin redondear (medido en producción al migrar).
            return dialect.type_descriptor(Numeric())
        return dialect.type_descriptor(String())

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        d = value if isinstance(value, Decimal) else Decimal(value)
        # Postgres recibe el Decimal tal cual (psycopg lo mapea directo a NUMERIC); SQLite
        # sigue queriendo texto, como antes.
        return d if dialect.name == "postgresql" else str(d)

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
