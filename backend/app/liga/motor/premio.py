"""El premio anual, puro y sin base de datos: lo que rinde cada cuenta en la temporada, cuántas
cuentas hacen falta para activarlo y cómo se reparte, empates incluidos.

Cada cuenta compite con la estrategia que optaba en cada jornada. Los meses sin jugar valen 0 %.
Los premios son fijos por escalón y nunca dependen de lo que paga nadie."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

MIN_JORNADAS = 10          # jornadas jugadas para ser elegible
UMBRAL_BASICO = 100        # cuentas elegibles que activan el primer escalón
UMBRAL_COMPLETO = 250      # y el segundo
IMPORTES = {
    1: (Decimal(150), Decimal(75), Decimal(25)),
    2: (Decimal(300), Decimal(150), Decimal(50)),
}
_CENTIMO = Decimal("0.01")


@dataclass(frozen=True)
class Cuenta:
    id: str
    jornadas: int            # jornadas jugadas de la temporada
    rentabilidad: Decimal    # acumulada, en %


@dataclass(frozen=True)
class Premio:
    cuenta: str
    puesto: int              # el de su grupo: dos empatadas en el 1.º son las dos «1»
    importe: Decimal


def acumulada(rentabilidades: Iterable[Decimal | None]) -> Decimal:
    """Rentabilidad compuesta, en %, de las jornadas de la temporada; `None` es una no jugada."""
    factor = Decimal(1)
    for r in rentabilidades:
        factor *= 1 + (r or Decimal(0)) / 100
    return (factor - 1) * 100


def escalon(elegibles: int, umbral_basico: int = UMBRAL_BASICO,
            umbral_completo: int = UMBRAL_COMPLETO) -> int:
    """0: no se activa; 1: premio reducido; 2: premio completo. Un umbral completo por debajo del
    básico (un ajuste mal puesto) se queda en el básico."""
    if elegibles >= max(umbral_completo, umbral_basico):
        return 2
    return 1 if elegibles >= umbral_basico else 0


def _clave(rentabilidad: Decimal) -> Decimal:
    """Con lo que se compara para el empate: la rentabilidad con los decimales que se enseñan."""
    return rentabilidad.quantize(_CENTIMO, rounding=ROUND_HALF_UP)


def repartir(cuentas: Sequence[Cuenta], importes: Sequence[Decimal]) -> list[Premio]:
    """Empatadas comparten: suman los premios de los puestos que ocupan y los dividen a partes
    iguales, al céntimo hacia abajo. Dos en el 1.º con 300, 150 y 50: 225 cada una y 50 a la
    siguiente; tres en el 1.º: 500 entre tres."""
    ordenadas = sorted(cuentas, key=lambda c: (-_clave(c.rentabilidad), c.id))
    premios: list[Premio] = []
    i = 0
    while i < len(ordenadas) and i < len(importes):
        clave = _clave(ordenadas[i].rentabilidad)
        grupo = [c for c in ordenadas[i:] if _clave(c.rentabilidad) == clave]
        cada = (sum(importes[i:i + len(grupo)], Decimal(0)) / len(grupo)).quantize(
            _CENTIMO, rounding=ROUND_DOWN)
        if cada > 0:
            premios += [Premio(c.id, i + 1, cada) for c in grupo]
        i += len(grupo)
    return premios
