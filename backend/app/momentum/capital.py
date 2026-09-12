"""Capital de Omega (momentum) -- SOLO lectura. Sin slots, sin tamaño sugerido: aquí
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


def pnl_abierto(db: Session) -> tuple[Decimal, Decimal]:
    """($ , %) de las posiciones abiertas de verdad (compradas, sin venta reportada): valor a
    precio de HOY (entry_price * (1 + ret/100), el mismo mark-to-market que ya usa la sala)
    menos lo realmente invertido -- coste y comisión de compra incluidos."""
    rows = db.execute(text("""
        select s.entry_price, s.ret, e.acciones, e.precio, e.comision
        from momentum_senales s
        join momentum_ejecuciones e on e.senal_id = s.id and e.accion = 'compra'
        where s.estado = 'ejecutada'
          and not exists (
            select 1 from momentum_ejecuciones v where v.senal_id = s.id and v.accion = 'venta'
          )
    """)).mappings().all()
    invertido = ZERO
    valor_hoy = ZERO
    for r in rows:
        acciones = D(str(r["acciones"]))
        invertido += acciones * D(str(r["precio"])) + D(str(r["comision"]))
        precio_hoy = D(str(r["entry_price"])) * (1 + D(str(r["ret"] or 0)) / 100)
        valor_hoy += acciones * precio_hoy
    pnl = valor_hoy - invertido
    pct = (pnl / invertido * 100) if invertido else ZERO
    return pnl, pct


def pnl_realizado(db: Session) -> tuple[Decimal, Decimal]:
    """($ , %) de las posiciones ya vendidas: proceeds de venta menos coste de compra, ambos
    con la comisión real que Manuel reportó en cada ejecución."""
    rows = db.execute(text("""
        select
          sum(case when accion = 'compra' then acciones * precio + comision else 0 end) as coste,
          sum(case when accion = 'venta' then acciones * precio - comision else 0 end) as proceeds
        from momentum_ejecuciones
        group by senal_id
        having sum(case when accion = 'venta' then 1 else 0 end) > 0
    """)).mappings().all()
    coste_total = ZERO
    pnl_total = ZERO
    for r in rows:
        coste = D(str(r["coste"] or 0))
        coste_total += coste
        pnl_total += D(str(r["proceeds"] or 0)) - coste
    pct = (pnl_total / coste_total * 100) if coste_total else ZERO
    return pnl_total, pct


def resumen(db: Session) -> dict:
    """Todo lo que necesita la sección "Cuenta" de Omega."""
    desplegado = capital_desplegado(db)
    tope = D(str(settings.momentum_capital_tope_usd))
    pnl_ab, pnl_ab_pct = pnl_abierto(db)
    pnl_re, pnl_re_pct = pnl_realizado(db)
    return {
        "cash": cash_disponible(),
        "desplegado_usd": str(desplegado),
        "tope_usd": str(tope),
        "libre_usd": str(max(ZERO, tope - desplegado)),
        "pnl_abierto_usd": str(pnl_ab),
        "pnl_abierto_pct": str(pnl_ab_pct),
        "pnl_realizado_usd": str(pnl_re),
        "pnl_realizado_pct": str(pnl_re_pct),
    }
