"""Interfaz de broker (ejecución en la cuenta REAL).

Toda ejecución pasa por aquí, y SIEMPRE detrás de una aprobación explícita del usuario
(Sí/No). El broker no decide nada: recibe una orden ya aprobada y la ejecuta (o simula).

Implementaciones:
- `DryRunBroker`   → simula el fill al precio vivo. Por defecto (DRY_RUN=true).
- `IbkrWebBroker`  → IBKR Web API OAuth 1.0a headless vía ibind (cuenta individual Pro).

El dinero es `Decimal` de punta a punta; el broker devuelve el precio de fill como Decimal,
nunca float aritmético.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from app.ledger.money import to_cents


@dataclass(frozen=True)
class BrokerResult:
    """Resultado de una orden: `ok` + estado + fill (precio y cantidad) + detalle legible.

    `status` refleja el ciclo de vida real de una orden LÍMITE:
    - 'filled'    → ejecutada del todo (fill_price = precio medio, filled_quantity = cantidad).
    - 'partial'   → ejecutada en parte (filled_quantity < solicitada); el resto sigue viva.
    - 'working'   → enviada y aceptada, aún sin ejecutar (el mercado no ha tocado el límite).
    - 'rejected'  → IBKR la rechazó/canceló; no se ejecutó nada.
    En dry-run siempre es 'filled' (fill simulado al precio de referencia).
    """

    ok: bool
    fill_price: Decimal | None   # precio (medio) al que se ejecutó (o simuló); None si nada aún
    message: str                 # detalle para el usuario
    simulated: bool              # True si no tocó la cuenta real
    status: str = "filled"       # filled | partial | working | rejected
    order_id: str | None = None  # id de la orden en IBKR (para reconciliar después)
    filled_quantity: Decimal | None = None  # cantidad realmente ejecutada (acumulada)


def marketable_limit(reference: Decimal, side: str, buffer_pct: float) -> Decimal:
    """Precio LÍMITE ejecutable = referencia ± colchón (buy sube, sell baja), a céntimos.

    Un límite estricto al precio exacto suele no ejecutar (el mercado tiene que venir a ti);
    con un colchón pequeño entra ya al precio actual pero NUNCA peor que ref±buffer. Con
    buffer 0 es un límite estricto al precio de referencia.
    """
    factor = Decimal(str(buffer_pct)) / 100          # p.ej. 0.5% → 0.005 (sin redondear)
    mult = (Decimal(1) + factor) if side.lower() == "buy" else (Decimal(1) - factor)
    return to_cents(reference * mult)                # solo el PRECIO final se cuadra a céntimos


class Broker(Protocol):
    name: str
    is_live: bool  # True = las órdenes van a la cuenta real de verdad

    def place_order(
        self, ticker: str, side: str, quantity: Decimal, order_ref: str = ""
    ) -> BrokerResult:
        """Envía una orden LÍMITE ya APROBADA (nunca a mercado). side: 'buy' | 'sell'.

        El límite lo fija el broker a partir de su precio de referencia (± `limit_buffer_pct`).
        `order_ref` se usa como client order id (coid) para atribución/reconciliación.
        """
        ...

    def poll_order(self, order_id: str) -> BrokerResult:
        """Estado ACTUAL de una orden ya enviada (para reconciliar fills de órdenes 'working')."""
        ...

    def convert_currency(self, eur: Decimal) -> BrokerResult:
        """Convierte EUR→USD en la cuenta (venta del par EUR.USD a LÍMITE ejecutable, ±buffer).

        SOLO la inicia el usuario al aportar (su click es la aprobación). La imagen final la
        pone el broker — aquí NO se estima ninguna comisión: `fill_price` = cambio real del
        fill y `filled_quantity` = EUR convertidos; USD resultantes = cantidad × cambio.
        Si no ejecuta (p. ej. FX cerrado), el llamador NO debe apuntar nada en el libro.
        """
        ...

    def status(self) -> dict:
        """Estado de la conexión para el panel (modo, cuenta, detalle)."""
        ...
