"""Puntos de la liga (plan §8): el resultado de cada jornada contra el S&P y la clasificación.

La banda va sobre la diferencia redondeada a una décima, la cifra que ve el usuario: más de
+0,2 gana (3 puntos), de −0,2 a +0,2 empata (1) y por debajo de −0,2 pierde (0). La
clasificación va por puntos, luego por la diferencia de la temporada contra el S&P (con las
rentabilidades compuestas, incluido el mes en curso) y luego por la fecha de alta, la más antigua
primero.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, localcontext

from app.liga.motor.formato import redondear

BANDA = Decimal("0.2")
PUNTOS = {"G": 3, "E": 1, "P": 0}
_LETRAS = {puntos: letra for letra, puntos in PUNTOS.items()}


@dataclass(frozen=True)
class Resultado:
    """`dif`: la rentabilidad de la estrategia menos la del S&P, en puntos porcentuales y
    redondeada a una décima. `letra`: G (ganada), E (empate) o P (perdida)."""

    dif: Decimal
    puntos: int
    letra: str


@dataclass(frozen=True)
class FilaClasificacion:
    """Una estrategia en la temporada. `puntos`: los de sus jornadas cerradas. `rentabilidades`:
    (la suya, la del S&P) en % de cada jornada que ha jugado, incluida la que está en curso.
    `alta`: cuándo se apuntó, con zona horaria."""

    id: str
    puntos: int
    rentabilidades: tuple[tuple[Decimal, Decimal], ...]
    alta: datetime

    def __post_init__(self) -> None:
        # Sin zona no se puede ordenar junto a las que la tienen, ni saber qué instante es.
        if self.alta.tzinfo is None or self.alta.utcoffset() is None:
            raise ValueError(f"{self.id}: la fecha de alta necesita zona horaria")


@dataclass(frozen=True)
class Puesto:
    """`dif_temporada`: la diferencia compuesta contra el S&P, en puntos porcentuales."""

    puesto: int
    fila: FilaClasificacion
    dif_temporada: Decimal


def resultado_jornada(rent: Decimal, rent_sp: Decimal) -> Resultado:
    """Resultado con las rentabilidades de la jornada en % (las guardadas, con 4 decimales).

    Se redondea la diferencia exacta, la mitad hacia fuera (`formato.redondear`): +0,25 es +0,3
    y gana; +0,24 es +0,2 y empata; −0,25 es −0,3 y pierde."""
    dif = redondear(_decimal(rent) - _decimal(rent_sp), 1)
    if dif == 0:
        dif = abs(dif)  # nunca «−0,0»
    if dif > BANDA:
        letra = "G"
    elif dif < -BANDA:
        letra = "P"
    else:
        letra = "E"
    return Resultado(dif, PUNTOS[letra], letra)


def letra(puntos: int) -> str:
    """G, E o P a partir de los puntos que guarda `liga.resultados`."""
    return _LETRAS[puntos]


def diferencia_temporada(rentabilidades: Iterable[tuple[Decimal, Decimal]]) -> Decimal:
    """(Π(1 + r/100) − Π(1 + sp/100)) × 100, en puntos porcentuales y sin redondear."""
    with localcontext() as ctx:
        ctx.prec = 50
        propia = sp = Decimal(1)
        for r, s in rentabilidades:
            propia *= 1 + _decimal(r) / 100
            sp *= 1 + _decimal(s) / 100
        return (propia - sp) * 100


def clasificacion(filas: Iterable[FilaClasificacion]) -> list[Puesto]:
    """La tabla de la temporada, del primero al último (el id desempata lo que quede igual)."""
    con_dif = [(f, diferencia_temporada(f.rentabilidades)) for f in filas]
    # `copy_negate` no redondea: ordenar no depende de la precisión del contexto.
    con_dif.sort(key=lambda x: (-x[0].puntos, x[1].copy_negate(), x[0].alta, x[0].id))
    return [Puesto(i, f, redondear(d, 4)) for i, (f, d) in enumerate(con_dif, 1)]


def _decimal(valor: Decimal | int) -> Decimal:
    # Un float traería su error binario al redondeo de la banda: 0,45 sería 0,4500000000000000111.
    if isinstance(valor, bool) or not isinstance(valor, Decimal | int):
        raise TypeError(f"las rentabilidades van en Decimal, no en {type(valor).__name__}")
    return Decimal(valor)
