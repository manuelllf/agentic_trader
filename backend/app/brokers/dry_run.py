"""Broker simulado (DRY_RUN) — el modo por defecto de la Sala Real.

Simula el fill al precio vivo de yfinance (retrasado ~15 min). No toca ninguna cuenta.
Permite ejercitar el flujo completo de aprobaciones (push → Sí/No → libro real) sin
riesgo, hasta que el usuario active las credenciales OAuth de IBKR.
"""

from __future__ import annotations

from decimal import Decimal

from app.brokers.base import BrokerResult, marketable_limit
from app.config import settings
from app.ledger.money import D, to_cents


class DryRunBroker:
    name = "dry-run"
    is_live = False

    def place_order(
        self, ticker: str, side: str, quantity: Decimal, order_ref: str = ""
    ) -> BrokerResult:
        from app import tracking

        prices = tracking.live_prices([ticker])
        if ticker not in prices:
            return BrokerResult(
                ok=False, fill_price=None, simulated=True,
                message=f"Sin precio vivo para {ticker} — orden simulada no ejecutada.",
            )
        px = to_cents(D(prices[ticker]))
        limit = marketable_limit(px, side, settings.limit_buffer_pct)
        # En simulación el fill es instantáneo y completo al precio de referencia (~el toque).
        return BrokerResult(
            ok=True, fill_price=px, simulated=True, status="filled",
            filled_quantity=D(quantity),
            message=f"SIMULADO: {side} {quantity} {ticker} LÍMITE ${limit} "
                    f"(ref ${px}, dry-run, sin orden real).",
        )

    def poll_order(self, order_id: str) -> BrokerResult:
        # En dry-run nunca hay órdenes 'working' que reconciliar.
        return BrokerResult(ok=True, fill_price=None, simulated=True, status="filled",
                            message="dry-run: sin orden real que reconciliar.")

    def convert_currency(self, eur: Decimal) -> BrokerResult:
        """Conversión EUR→USD simulada al cambio indicativo (sin comisiones inventadas)."""
        from app import tracking

        rate = tracking.live_prices(["EURUSD=X"]).get("EURUSD=X")
        if not rate:
            return BrokerResult(ok=False, fill_price=None, simulated=True, status="rejected",
                                message="Sin cambio EUR/USD ahora mismo — conversión no ejecutada.")
        px = D(str(rate))                              # el cambio conserva sus decimales (no céntimos)
        usd = to_cents(D(str(eur)) * px)
        return BrokerResult(
            ok=True, fill_price=px, simulated=True, status="filled",
            filled_quantity=D(str(eur)),
            message=f"SIMULADO: {eur} EUR → ${usd} @ {px} (dry-run, sin conversión real).",
        )

    def status(self) -> dict:
        return {
            "mode": "dry-run",
            "live": False,
            "detail": "Simulación: las aprobaciones se registran en el libro real "
                      "pero NO se envían órdenes a IBKR (órdenes a límite cuando se active).",
        }
