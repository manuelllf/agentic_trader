"""Modelos ORM.

Estado del agente en 4 capas:
- Ledger (Allocation/Trade/Position): lo que POSEE (dinero exacto, Decimal). Cada fila lleva
  `book`: 'shadow' (cartera virtual de seguimiento) o 'real' (cuenta IBKR del usuario).
- Watchlist: memoria de scores altos entre escaneos (lo que VIGILA).
- Score/Proposal: salida de cada escaneo (informe + score por nombre, y la cartera objetivo).
- Approval/PushSubscription: modo real — el agente PROPONE, el usuario aprueba (Sí/No) vía push.
"""

from __future__ import annotations

from datetime import UTC, datetime

from decimal import Decimal

from sqlalchemy import JSON, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ledger.money import DecimalStr

BOOK_SHADOW = "shadow"
BOOK_REAL = "real"


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Watchlist(Base):
    """Nombres de score alto que se re-analizan SIEMPRE y aportan continuidad entre escaneos."""

    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    score: Mapped[int] = mapped_column(Integer)              # último score (1-100)
    thesis: Mapped[str] = mapped_column(String, default="")  # tesis de una línea
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_high: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Score(Base):
    """Score de un nombre en un escaneo (para el leaderboard + drill-down del informe)."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    sector: Mapped[str] = mapped_column(String(48), default="")
    score: Mapped[int] = mapped_column(Integer, index=True)   # 1-100
    headline: Mapped[str] = mapped_column(String, default="")  # tesis de una línea
    report: Mapped[str] = mapped_column(String, default="")    # Investment Report completo
    price: Mapped[float | None] = mapped_column(Float)         # precio al escanear
    market_cap: Mapped[float | None] = mapped_column(Float)    # para desempate por market cap (paper)
    target_price: Mapped[float | None] = mapped_column(Float)  # objetivo 3m del LLM
    held: Mapped[bool] = mapped_column(default=False)          # ¿está en cartera?
    on_watchlist: Mapped[bool] = mapped_column(default=False)


class Proposal(Base):
    """Cartera objetivo + trades que propone el constructor en un escaneo (3-5 posiciones)."""

    __tablename__ = "proposals"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    cash_target_pct: Mapped[float] = mapped_column(Float, default=0.0)
    macro_summary: Mapped[str] = mapped_column(String, default="")
    # items: [{ticker, action, target_weight_pct, shares, est_value, thesis, edge, risk, score}]
    items: Mapped[list] = mapped_column(JSON, default=list)


# ---------------------------------------------------------------------------
# Libro de capital (Capa 5) — todo el dinero en Decimal (DecimalStr), nunca float.
# ---------------------------------------------------------------------------


class Allocation(Base):
    """Movimiento de capital del usuario al sleeve del agente (+ ingreso / − retiro)."""

    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    amount: Mapped[Decimal] = mapped_column(DecimalStr(32))  # firmado: + ingreso, − retiro
    note: Mapped[str] = mapped_column(String, default="")
    book: Mapped[str] = mapped_column(String(8), default=BOOK_SHADOW, index=True)


class Trade(Base):
    """Ejecución inmutable atribuida al agente (por `order_ref`). No se edita nunca."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    quantity: Mapped[Decimal] = mapped_column(DecimalStr(32))
    price: Mapped[Decimal] = mapped_column(DecimalStr(32))
    fees: Mapped[Decimal] = mapped_column(DecimalStr(32), default=Decimal("0"))
    order_ref: Mapped[str] = mapped_column(String(48), index=True)  # etiqueta AGENT-<uuid>
    realized_pnl: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # solo en ventas
    book: Mapped[str] = mapped_column(String(8), default=BOOK_SHADOW, index=True)


class Position(Base):
    """Posición ABIERTA del agente (su parte, aunque la cuenta IBKR esté mezclada).

    Único por (ticker, book): el mismo nombre puede vivir a la vez en sombra y en real.
    """

    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("ticker", "book", name="uq_position_ticker_book"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    quantity: Mapped[Decimal] = mapped_column(DecimalStr(32))
    avg_cost: Mapped[Decimal] = mapped_column(DecimalStr(32))  # coste medio por acción
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    order_ref: Mapped[str] = mapped_column(String(48), default="")
    book: Mapped[str] = mapped_column(String(8), default=BOOK_SHADOW, index=True)


# ---------------------------------------------------------------------------
# Modo real — el agente propone, el usuario decide (Sí ejecuta / No descarta).
# ---------------------------------------------------------------------------


class Approval(Base):
    """Operación propuesta para la cuenta REAL, pendiente del Sí/No del usuario.

    Lleva TODA la información para decidir a conciencia. Nada se ejecuta sin `approve`.
    Estados: pending → executed | working | rejected | failed | expired.
    ('working' = orden límite enviada a IBKR y aún sin ejecutar del todo; se reconcilia luego.)
    """

    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)

    ticker: Mapped[str] = mapped_column(String(16), index=True)
    sector: Mapped[str] = mapped_column(String(48), default="")
    action: Mapped[str] = mapped_column(String(10))            # comprar|ampliar|recortar|vender
    target_weight_pct: Mapped[float] = mapped_column(Float, default=0.0)
    score: Mapped[int | None] = mapped_column(Integer)
    est_price: Mapped[Decimal | None] = mapped_column(DecimalStr(32))   # precio al proponer
    target_price: Mapped[float | None] = mapped_column(Float)           # objetivo 3m del LLM
    upside_pct: Mapped[float | None] = mapped_column(Float)
    thesis: Mapped[str] = mapped_column(String, default="")
    edge: Mapped[str] = mapped_column(String, default="")
    risk: Mapped[str] = mapped_column(String, default="")
    macro_summary: Mapped[str] = mapped_column(String, default="")

    # Resultado de la ejecución (solo si status=executed/working/failed).
    order_ref: Mapped[str] = mapped_column(String(48), default="")      # coid propio (idempotencia)
    broker_order_id: Mapped[str | None] = mapped_column(String(48))     # id de orden en IBKR (reconciliar)
    requested_quantity: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # acciones PEDIDAS
    quantity: Mapped[Decimal | None] = mapped_column(DecimalStr(32))    # acciones YA ejecutadas (acumulado)
    fill_price: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # precio medio de ejecución
    result_msg: Mapped[str] = mapped_column(String, default="")


class Meta(Base):
    """Clave→valor persistente para referencias que deben quedar CLAVADAS en el tiempo.

    Caso de uso: el precio del SPY en el minuto de la primera compra de un libro (benchmark).
    Reconstruirlo después es imposible (yfinance solo guarda ~7 días de velas de 1 minuto),
    así que se captura una vez y se persiste."""

    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String)


class PersonalPosition(Base):
    """Snapshot de la cartera PERSONAL del usuario en IBKR — INTOCABLE para el agente.

    Existe para separar sin ambigüedad: en la cuenta IBKR conviven las posiciones personales
    del usuario y las del agente (libro 'real'). El agente NUNCA lee esta tabla para dimensionar
    ni vender (su libro es la única fuente); esto es el recibo visible de "esto es tuyo" y
    alimenta el mini-tracker de la Sala Real. Se refresca con /personal/sync (read-only a IBKR).
    """

    __tablename__ = "personal_positions"

    id: Mapped[int] = mapped_column(primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(48), index=True)     # símbolo o descripción corta
    description: Mapped[str] = mapped_column(String, default="")    # contractDesc completo (opciones)
    asset_class: Mapped[str] = mapped_column(String(8), default="STK")  # STK | OPT | ...
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    quantity: Mapped[Decimal] = mapped_column(DecimalStr(32))
    avg_cost: Mapped[Decimal | None] = mapped_column(DecimalStr(32))
    # Valores de IBKR en el momento del sync (para opciones, que no cotizan en yfinance fácil).
    mkt_price: Mapped[Decimal | None] = mapped_column(DecimalStr(32))
    mkt_value: Mapped[Decimal | None] = mapped_column(DecimalStr(32))
    unrealized_pnl: Mapped[Decimal | None] = mapped_column(DecimalStr(32))


class PushSubscription(Base):
    """Suscripción Web Push del navegador del usuario (VAPID, gratis, sin terceros)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    endpoint: Mapped[str] = mapped_column(String, unique=True, index=True)
    p256dh: Mapped[str] = mapped_column(String)
    auth: Mapped[str] = mapped_column(String)
