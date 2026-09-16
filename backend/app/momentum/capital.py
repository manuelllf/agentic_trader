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


def posiciones_abiertas(db: Session) -> dict[int, dict]:
    """Acciones netas (compras - ventas) y coste medio de compra por señal -- SOLO señales con
    neto > 0. Clave: senal_id. Reutilizable desde `routes.py` (la sala necesita saber cuántas
    acciones quedan abiertas para poder cerrar una posición, total o en parte)."""
    rows = db.execute(text("""
        select e.senal_id, s.ticker, s.entry_price, s.ret,
               sum(case when e.accion = 'compra' then e.acciones else 0 end) as compradas,
               sum(case when e.accion = 'compra' then e.acciones * e.precio + e.comision else 0 end) as coste_compras,
               sum(case when e.accion = 'venta' then e.acciones else 0 end) as vendidas
        from momentum_ejecuciones e
        join momentum_senales s on s.id = e.senal_id
        group by e.senal_id, s.ticker, s.entry_price, s.ret
    """)).mappings().all()
    out: dict[int, dict] = {}
    for r in rows:
        compradas = D(str(r["compradas"] or 0))
        if compradas <= 0:
            continue
        neto = compradas - D(str(r["vendidas"] or 0))
        if neto <= 0:
            continue
        out[r["senal_id"]] = {
            "ticker": r["ticker"], "neto": neto, "coste_medio": D(str(r["coste_compras"])) / compradas,
            "entry_price": D(str(r["entry_price"])), "ret": D(str(r["ret"] or 0)),
        }
    return out


def capital_desplegado(db: Session) -> Decimal:
    """Coste real de las acciones NETAS abiertas (compras - ventas), a precio medio de compra
    -- antes bastaba con que existiera CUALQUIER venta para que la posición desapareciera del
    cómputo entero, aunque quedaran acciones sin vender."""
    return sum((p["neto"] * p["coste_medio"] for p in posiciones_abiertas(db).values()), ZERO)


def pnl_abierto(db: Session) -> tuple[Decimal, Decimal]:
    """($ , %) de lo abierto de verdad: valor a precio EN VIVO (mismo `precio_vivo` que ya usa
    la sala en cada tarjeta) menos lo invertido -- antes usaba el `ret` del job diario por
    lotes, que durante el día no coincidía con el retorno en vivo que se ve en pantalla."""
    from app.momentum import signals
    invertido = ZERO
    valor_hoy = ZERO
    for p in posiciones_abiertas(db).values():
        invertido += p["neto"] * p["coste_medio"]
        precio_hoy = signals.precio_vivo(p["ticker"])
        if precio_hoy is None:
            precio_hoy = float(p["entry_price"]) * (1 + float(p["ret"]) / 100)
        valor_hoy += p["neto"] * D(str(precio_hoy))
    pnl = valor_hoy - invertido
    pct = (pnl / invertido * 100) if invertido else ZERO
    return pnl, pct


def pnl_realizado(db: Session) -> tuple[Decimal, Decimal]:
    """($ , %) de lo YA vendido: proceeds reales menos el coste medio ponderado de compra de
    esas acciones concretas -- antes emparejaba el coste de TODAS las compras (también las
    acciones que seguían abiertas) contra los proceeds de una venta parcial."""
    rows = db.execute(text("""
        select senal_id,
               sum(case when accion = 'compra' then acciones else 0 end) as compradas,
               sum(case when accion = 'compra' then acciones * precio + comision else 0 end) as coste_compras,
               sum(case when accion = 'venta' then acciones else 0 end) as vendidas,
               sum(case when accion = 'venta' then acciones * precio - comision else 0 end) as proceeds
        from momentum_ejecuciones
        group by senal_id
        having sum(case when accion = 'venta' then 1 else 0 end) > 0
    """)).mappings().all()
    coste_total = ZERO
    pnl_total = ZERO
    for r in rows:
        compradas = D(str(r["compradas"] or 0))
        if compradas <= 0:
            continue
        coste_medio = D(str(r["coste_compras"])) / compradas
        coste_vendido = D(str(r["vendidas"] or 0)) * coste_medio
        coste_total += coste_vendido
        pnl_total += D(str(r["proceeds"] or 0)) - coste_vendido
    pct = (pnl_total / coste_total * 100) if coste_total else ZERO
    return pnl_total, pct


def retorno_combinado(db: Session) -> Decimal | None:
    """(%) retorno money-weighted sobre el capital EXTERNO que de verdad has puesto en Omega --
    no sobre el coste bruto de cada compra. Si reinviertes lo ganado en una venta en la
    siguiente compra, ese dinero reciclado no cuenta como aportación nueva (sumar los costes
    brutos de compra diluye el % de mentira: 17-sep-2026, verificado con el caso real
    HQ->QBTS -- $250 de beneficio reinvertidos enteros no deben contar dos veces).

    Simulación cronológica de una "caja" con TODAS las ejecuciones (cualquier ticker, orden
    real): cada compra tira primero de lo ya recuperado en ventas anteriores; solo lo que la
    caja no cubre es aportación tuya de verdad. None si nunca se ha aportado nada."""
    from app.momentum import signals

    filas = db.execute(text("""
        select accion, acciones, precio, comision from momentum_ejecuciones order by ejecutada_at
    """)).mappings().all()
    caja = ZERO
    aportado = ZERO
    for f in filas:
        importe = D(str(f["acciones"])) * D(str(f["precio"]))
        comision = D(str(f["comision"]))
        if f["accion"] == "compra":
            coste = importe + comision
            if caja >= coste:
                caja -= coste
            else:
                aportado += coste - caja
                caja = ZERO
        else:
            caja += importe - comision
    if aportado <= 0:
        return None

    valor_abierto = ZERO
    for p in posiciones_abiertas(db).values():
        precio_hoy = signals.precio_vivo(p["ticker"])
        if precio_hoy is None:
            precio_hoy = float(p["entry_price"]) * (1 + float(p["ret"]) / 100)
        valor_abierto += p["neto"] * D(str(precio_hoy))

    valor_total_hoy = valor_abierto + caja
    return (valor_total_hoy - aportado) / aportado * 100


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
