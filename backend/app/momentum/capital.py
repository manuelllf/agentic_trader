"""Capital de Sala Real X (momentum) -- SOLO lectura. Sin slots, sin tamaño sugerido: aquí
solo se responde "¿hay dinero disponible?" y "¿cuánto llevo desplegado ya?"; el reparto por
posición lo decide Manuel a mano en cada alerta (ver docs/momentum-sala-real-x.md §4).

Caja: se lee DIRECTO de IBKR (`raw_cash`), la MISMA cuenta física que el ranker y lo personal
-- a propósito, porque esta sala nunca ejecuta sola, así que no tiene (ni necesita) su propio
libro/ledger virtual como el ranker. Desplegado: suma de `momentum_ejecuciones` de compra sin
venta emparejada, reportadas a mano desde la sala.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.brokers import ibkr_web
from app.config import settings
from app.ledger.money import D

ZERO = Decimal("0")


def cash_disponible() -> dict[str, str] | None:
    """Caja bruta de la cuenta por divisa, o None si no hay credenciales IBKR (dry-run)."""
    if not ibkr_web.credentials_present():
        return None
    broker = ibkr_web.IbkrWebBroker()
    return {k: str(v) for k, v in broker.raw_cash().items()}


def capital_desplegado(db: Session) -> Decimal:
    """Posiciones de momentum abiertas de verdad (compra reportada sin su venta): coste total
    a precio de ejecución, comisión incluida."""
    row = db.execute(text("""
        select coalesce(sum(e.acciones * e.precio + e.comision), 0) as total
        from momentum_ejecuciones e
        where e.accion = 'compra'
          and not exists (
            select 1 from momentum_ejecuciones v
            where v.senal_id = e.senal_id and v.accion = 'venta'
          )
    """)).scalar()
    return D(str(row or 0))


def resumen(db: Session) -> dict:
    """Todo lo que necesita la sección "Cuenta" de Sala Real X."""
    desplegado = capital_desplegado(db)
    tope = D(str(settings.momentum_capital_tope_usd))
    return {
        "cash": cash_disponible(),
        "desplegado_usd": str(desplegado),
        "tope_usd": str(tope),
        "libre_usd": str(max(ZERO, tope - desplegado)),
    }
