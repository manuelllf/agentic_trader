"""Cifras para los textos del motor (DESIGN.md §10), en castellano o en inglés de EE. UU.

En castellano: coma decimal, punto de miles, menos tipográfico (U+2212) y espacio duro antes de
% y M$. Sin ceros de sobra a la derecha, como la maqueta: «2,5», «3», «1.900».

Una cifra que se compara con un umbral gana decimales si al redondear se confundiría con él:
«vale 1.999,6 M$ y pides más de 2.000 M$», nunca «vale 2.000 M$ y pides más de 2.000 M$».
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction

NBSP = " "
MENOS = "−"

Numero = Decimal | Fraction | float | int

# Tope de decimales añadidos para separar una cifra de su umbral.
_DECIMALES_EXTRA = 4


def a_decimal(valor: Numero | None) -> Decimal | None:
    """Cualquier número del motor a `Decimal`; `None`, NaN e infinitos son «sin dato».

    Un `float` entra por su representación más corta (2.5 → 2,5, no 2,4999…): es la cifra que se
    ve al leer el dato, y así los umbrales se comparan con lo que enseñamos."""
    if valor is None:
        return None
    if isinstance(valor, bool):
        raise TypeError("un booleano no es una cifra")
    if isinstance(valor, Decimal):
        return valor if valor.is_finite() else None
    if isinstance(valor, float):
        return Decimal(repr(valor)) if math.isfinite(valor) else None
    if isinstance(valor, int):
        return Decimal(valor)
    if isinstance(valor, Fraction):
        with localcontext() as ctx:
            ctx.prec = 50
            return Decimal(valor.numerator) / Decimal(valor.denominator)
    raise TypeError(f"no es un número: {valor!r}")


def redondear(valor: Numero, decimales: int = 1) -> Decimal:
    """Redondeo comercial, la mitad hacia fuera: 0,55 → 0,6 y −0,55 → −0,6."""
    d = a_decimal(valor)
    if d is None:
        raise ValueError("no se puede redondear un dato que falta")
    return d.quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)


def cifra(valor: Numero, decimales: int = 1, frente_a: Iterable[Numero] = (),
          locale: str = "es") -> str:
    """«2.987», «2,5», «−0,3» (en inglés «2,987», «2.5»). `frente_a`: umbrales con los que no se
    debe confundir."""
    d = a_decimal(valor)
    if d is None:
        raise ValueError("no hay cifra que escribir")
    umbrales = [u for u in (a_decimal(x) for x in frente_a) if u is not None]
    q = redondear(d, decimales)
    extra = 0
    while extra < _DECIMALES_EXTRA and q in umbrales and d not in umbrales:
        extra += 1
        q = redondear(d, decimales + extra)
    return _escribir(q, locale)


def porcentaje(valor: Numero, decimales: int = 1, frente_a: Iterable[Numero] = (),
               locale: str = "es") -> str:
    """«2,5 %», con espacio duro (en inglés «2.5%»)."""
    junto = "%" if locale == "en" else f"{NBSP}%"
    return f"{cifra(valor, decimales, frente_a, locale)}{junto}"


def millones_usd(millones: Numero, frente_a: Iterable[Numero] = (), locale: str = "es") -> str:
    """Capitalización en millones de dólares: «1.900 M$»; desde el billón, «3,4 billones de $»
    (en inglés «$1,900M» y «$3.4 trillion»: el billón español es el trillion de EE. UU.)."""
    m = a_decimal(millones)
    if m is None:
        raise ValueError("no hay capitalización que escribir")
    if locale == "en":
        if abs(m) >= 1_000_000:
            return f"${cifra(m / 1_000_000, 1, (), locale)} trillion"
        return f"${cifra(m, 0, frente_a, locale)}M"
    if abs(m) >= 1_000_000:
        b = cifra(m / 1_000_000, 1)
        return f"{b}{NBSP}{'billón' if b == '1' else 'billones'} de $"
    return f"{cifra(m, 0, frente_a)}{NBSP}M$"


def _escribir(q: Decimal, locale: str = "es") -> str:
    signo = MENOS if q < 0 else ""
    entero, _, fraccion = f"{abs(q):f}".partition(".")
    fraccion = fraccion.rstrip("0")
    en = locale == "en"
    miles = f"{int(entero):,}" if en else f"{int(entero):,}".replace(",", ".")
    return signo + miles + (f"{'.' if en else ','}{fraccion}" if fraccion else "")
