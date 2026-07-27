"""Comisión SIMULADA de corretaje (solo para libros simulados).

Por qué existe: el libro sombra nunca recibe un fill real, así que si nadie pone la comisión
se queda en cero para siempre — y su curva, que es la que se publica, mediría una rentabilidad
que no existe. Con ~$2.000 y una decena de operaciones por rebalanceo, el mínimo por orden se
come del orden del 0,5% mensual: no es ruido de redondeo.

Modelo = plan **FIXED** de IBKR para acciones US, verificado en su tarifario: $0,005 por
acción, **mínimo $1 por orden** y **máximo 1% del importe** (el techo manda sobre el suelo —
comprar 10 acciones de $0,20 cuesta $0,02, no $1). Las tasas regulatorias de venta (SEC/FINRA)
son de céntimos y NO se modelan: inventar precisión de más sería tan falso como no cobrar nada.

**Solo lo cobra el libro SOMBRA**, que es simulado de principio a fin y cuya curva se publica.
El libro REAL NO lleva comisión simulada ni siquiera en dry-run: esa cuenta está en plan
**TIERED**, cuyo coste es otro (por acción más bajo, pero con tasas de mercado y regulatorias
por separado), y ponerle la tarifa fija sería apuntar un número que esa cuenta nunca pagará.
Cuando se implemente el tiered, su sitio es `BrokerResult.fees`, que ya viaja hasta el libro.

Poner `commission_per_share` y `commission_min` a 0 desactiva el modelo entero.
"""

from __future__ import annotations

from decimal import ROUND_DOWN, Decimal

from app.config import settings
from app.ledger.money import D, to_cents
from app.models import BOOK_SHADOW

ZERO = Decimal("0")


def commission(quantity, price, book: str = BOOK_SHADOW) -> Decimal:  # noqa: ANN001
    """Comisión de UNA orden: `per_share` × acciones, con suelo y techo (% del importe).

    Devuelve 0 para cualquier libro que no sea el SOMBRA — ver la cabecera del módulo: la
    cuenta real va en plan tiered y su coste lo pondrá el bróker, no este modelo.
    """
    if book != BOOK_SHADOW:
        return ZERO
    qty, px = abs(D(quantity)), abs(D(price))
    if qty <= ZERO or px <= ZERO:
        return ZERO
    per_share = D(str(settings.commission_per_share))
    minimo = D(str(settings.commission_min))
    if per_share <= ZERO and minimo <= ZERO:
        return ZERO                                  # modelo desactivado por configuración
    bruto = qty * px
    techo = bruto * D(str(settings.commission_max_pct)) / 100
    fee = max(per_share * qty, minimo)
    return to_cents(min(fee, techo) if techo > ZERO else fee)


def afford_quantity(spendable, price, step: Decimal,  # noqa: ANN001
                    book: str = BOOK_SHADOW) -> Decimal:
    """Acciones que caben en `spendable` DEJANDO SITIO a su comisión, redondeando a `step`.

    Hace falta porque la comisión depende de la cantidad y la cantidad de la caja libre: sin
    esto, dimensionar a la caja exacta y luego cobrar comisión hace fallar la compra entera
    por céntimos. Dos pasadas bastan y son exactas por abajo: con la cantidad de la primera se
    calcula una comisión que solo puede BAJAR al bajar la cantidad, así que el coste final
    (importe + comisión) nunca supera `spendable`.
    """
    caja, px = D(spendable), D(price)
    if caja <= ZERO or px <= ZERO:
        return ZERO
    qty = (caja / px).quantize(step, rounding=ROUND_DOWN)
    for _ in range(2):
        fee = commission(qty, px, book)
        qty = ((caja - fee) / px).quantize(step, rounding=ROUND_DOWN)
        if qty <= ZERO:
            return ZERO
    return qty
