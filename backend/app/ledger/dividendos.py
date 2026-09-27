"""Dividendos cobrados por un libro. Se derivan de sus trades y de `precio_cierre`; no se guardan
en ningún sitio (serían una copia).

Cobra quien tenía la acción al cierre del día anterior a la fecha ex: una compra el mismo día ex
ya no cobra y una venta ese día todavía sí. El libro real es dinero de verdad y cobra neto de la
retención de EE. UU.; el sombra, bruto.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.ledger.money import D, to_cents
from app.models import BOOK_REAL, PrecioCierre, Trade
from app.precios import fecha_mercado

ZERO = Decimal("0")


@dataclass(frozen=True)
class Cobro:
    ticker: str
    dia: date            # fecha ex
    acciones: Decimal
    importe: Decimal     # céntimos, ya neto si el libro es real


def parte_cobrada(book: str) -> Decimal:
    return D(1) - D(str(settings.retencion_dividendos)) if book == BOOK_REAL else D(1)


def cobros(db: Session, book: str, trades: list[Trade] | None = None,
           hasta: date | None = None) -> list[Cobro]:
    """Cada dividendo que cobró el libro, en orden de fecha ex (hasta `hasta` incluida)."""
    if trades is None:
        trades = list(db.scalars(select(Trade).where(Trade.book == book)))
    if not trades:
        return []
    por_ticker: dict[str, list[tuple[date, Decimal]]] = {}
    for t in trades:
        signo = t.quantity if t.side == "buy" else -t.quantity
        por_ticker.setdefault(t.ticker, []).append((fecha_mercado(t.created_at), signo))
    q = select(PrecioCierre.ticker, PrecioCierre.dia, PrecioCierre.dividendo).where(
        PrecioCierre.ticker.in_(sorted(por_ticker)), PrecioCierre.dividendo > 0)
    if hasta is not None:
        q = q.where(PrecioCierre.dia <= hasta)
    parte = parte_cobrada(book)
    out: list[Cobro] = []
    for ticker, dia, dividendo in sorted(db.execute(q).all(), key=lambda e: (e[1], e[0])):
        acciones = sum((n for d, n in por_ticker[ticker] if d < dia), ZERO)
        if acciones > ZERO:
            out.append(Cobro(ticker, dia, acciones, to_cents(acciones * D(dividendo) * parte)))
    return out


def total(db: Session, book: str, trades: list[Trade] | None = None,
          hasta: date | None = None) -> Decimal:
    return sum((c.importe for c in cobros(db, book, trades, hasta)), ZERO)


@dataclass(frozen=True)
class CobroOmega:
    senal_id: int
    ticker: str
    dia: date
    importe: Decimal     # céntimos, neto: las posiciones de Omega son dinero de verdad


def cobros_omega(db: Session) -> list[CobroOmega]:
    """Dividendos cobrados por las posiciones ejecutadas de Omega, señal a señal."""
    from app.models import MomentumEjecucion, MomentumSenal

    filas = db.execute(
        select(MomentumEjecucion.senal_id, MomentumSenal.ticker, MomentumEjecucion.accion,
               MomentumEjecucion.acciones, MomentumEjecucion.ejecutada_at)
        .join(MomentumSenal, MomentumSenal.id == MomentumEjecucion.senal_id)).all()
    movimientos: dict[tuple[int, str], list[tuple[date, Decimal]]] = {}
    for senal_id, ticker, accion, acciones, at in filas:
        n = D(acciones) if accion == "compra" else -D(acciones)
        movimientos.setdefault((senal_id, ticker), []).append((fecha_mercado(at), n))
    if not movimientos:
        return []
    eventos = db.execute(
        select(PrecioCierre.ticker, PrecioCierre.dia, PrecioCierre.dividendo).where(
            PrecioCierre.ticker.in_(sorted({t for _s, t in movimientos})),
            PrecioCierre.dividendo > 0)).all()
    parte = parte_cobrada(BOOK_REAL)
    out: list[CobroOmega] = []
    for (senal_id, ticker), movs in movimientos.items():
        for t, dia, dividendo in eventos:
            if t != ticker:
                continue
            acciones = sum((n for d, n in movs if d < dia), ZERO)
            if acciones > ZERO:
                out.append(CobroOmega(senal_id, ticker, dia,
                                      to_cents(acciones * D(dividendo) * parte)))
    return sorted(out, key=lambda c: (c.dia, c.senal_id))


def por_senal(cobros_omega_: list[CobroOmega]) -> dict[int, Decimal]:
    out: dict[int, Decimal] = {}
    for c in cobros_omega_:
        out[c.senal_id] = out.get(c.senal_id, ZERO) + c.importe
    return out
