"""Modelos ORM.

Estado del agente en 4 capas:
- Ledger (Allocation/Trade/Position): lo que POSEE (dinero exacto, Decimal). Cada fila lleva
  `book`: 'shadow' (cartera virtual de seguimiento) o 'real' (cuenta IBKR del usuario).
- Watchlist: memoria de scores altos entre escaneos (lo que VIGILA).
- Score/Proposal: salida de cada escaneo (informe + score por nombre, y la cartera objetivo).
- Approval/PushSubscription: modo real — el agente PROPONE, el usuario aprueba (Sí/No) vía push.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.ledger.money import DecimalStr

BOOK_SHADOW = "shadow"
BOOK_REAL = "real"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def utc_iso(dt: datetime | None) -> str | None:
    """`.isoformat()` que SIEMPRE lleva el offset UTC explícito.

    SQLite (motor en producción, ver `settings.database_url`) no tiene un tipo de columna con
    zona horaria real: `DateTime(timezone=True)` escribe con `_utcnow()` (aware), pero SQLite lo
    guarda como TEXTO plano y lo devuelve NAIVE al leerlo — el dato sigue siendo UTC, pierde solo
    la etiqueta. `.isoformat()` sobre ese valor naive no lleva "+00:00", y `new Date(...)` en el
    navegador interpreta un ISO SIN offset como hora LOCAL, no UTC: una fila de las 15:47 UTC
    salía en pantalla como "15:47" en vez de convertirse a las 17:47 de España (CEST) — medido en
    `/scan/full`, que serializaba `row.scan_at.isoformat()` a pelo. Repone la etiqueta que SQLite
    se comió; con Postgres (o cualquier motor con tz real) sería un no-op."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).isoformat()


class Watchlist(Base):
    """Nombres de score alto que se re-analizan SIEMPRE y aportan continuidad entre escaneos."""

    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    score: Mapped[float] = mapped_column(Float)              # último score profundo (1,00-100,00)
    thesis: Mapped[str] = mapped_column(String, default="")  # tesis de una línea
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_high: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FundamentalsCache(Base):
    """Caché de `screener.fundamentals.gather()` — TTL 12h (ver `_FUND_CACHE_TTL_H`).

    Motivo: dos escaneos completos del universo en la misma noche dispararon un 401
    "Invalid Crumb" masivo de Yahoo (bloqueo de autenticación bajo carga, no rate-limit
    clásico) — 2.400-2.500 de 3.000 nombres sin datos de golpe. Repetir tests el mismo día
    multiplica la exposición. Con la caché, un segundo test dentro de las 12h reutiliza los
    datos del primero en vez de volver a pedirle 9.000 peticiones a Yahoo (3 por ticker:
    `.info`+`.history`+`.news`). No arregla la causa raíz, reduce cuánto se dispara."""

    __tablename__ = "fundamentals_cache"

    ticker: Mapped[str] = mapped_column(String(16), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    data: Mapped[dict] = mapped_column(JSON)   # dataclasses.asdict(NameData), reconstruible


class Score(Base):
    """Score de un nombre en un escaneo (para el leaderboard + drill-down del informe)."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    sector: Mapped[str] = mapped_column(String(48), default="")
    # Float y no Integer: la nota del scorer lleva dos decimales. Con nota entera,
    # el desempate por market cap (fiel al paper, pensado como caso raro) repartía la mitad del
    # top-10 —diez nombres empatados a 78 para cinco plazas— y se lo llevaban siempre los cinco
    # mayores. El decimal es lo que hace que decida el análisis y no el tamaño.
    score: Mapped[float] = mapped_column(Float, index=True)   # 1,00-100,00
    headline: Mapped[str] = mapped_column(String, default="")  # tesis de una línea
    report: Mapped[str] = mapped_column(String, default="")    # Investment Report completo
    price: Mapped[float | None] = mapped_column(Float)         # precio al escanear
    market_cap: Mapped[float | None] = mapped_column(Float)    # para desempate por market cap (paper)
    target_price: Mapped[float | None] = mapped_column(Float)  # objetivo 3m del LLM
    held: Mapped[bool] = mapped_column(default=False)          # ¿está en cartera?
    on_watchlist: Mapped[bool] = mapped_column(default=False)
    # copia CONGELADA de los titulares que entraron al prompt: las noticias son un endpoint en
    # vivo, al día siguiente ya no se pueden reconstruir. Telemetría: nunca vuelve a un prompt.
    news_used: Mapped[list | None] = mapped_column(JSON, default=None)
    # target_raw/target_flagged: el objetivo TAL CUAL lo dijo el modelo cuando un guardarrail
    # lo corrige después. Telemetría para auditar el guardarrail, nunca vuelve a un prompt.
    target_raw: Mapped[float | None] = mapped_column(Float)
    target_flagged: Mapped[bool] = mapped_column(default=False)
    # target_consensus_mean/target_echoed_consensus: guardarraíl de ECO de consenso (ver
    # `_flag_consensus_echo` en scan_service.py) — distinto del guardarraíl de arriba (oferta
    # corporativa) y en columna propia porque no comparten motivo. A diferencia del de arriba,
    # este NO corrige target_price: solo anota cuándo coincidió (<0,5%) con el consenso MEDIO de
    # analistas (horizonte 12-18m) pese a pedirse a un mes, indicio de que lo copió en vez de
    # razonar el horizonte corto. Telemetría, nunca vuelve a un prompt.
    target_consensus_mean: Mapped[float | None] = mapped_column(Float)
    target_echoed_consensus: Mapped[bool] = mapped_column(default=False)
    # ¿el informe declara que ESTA empresa está siendo comprada? Aparta de la selección (no del
    # ranking). NULL = el modelo no contestó al campo, que NO es lo mismo que un "no" — por eso
    # es nullable y no un booleano con default False.
    under_acquisition: Mapped[bool | None] = mapped_column(Boolean, default=None)


class Proposal(Base):
    """Cartera objetivo + trades que propone el constructor en un escaneo (5 posiciones fijas)."""

    __tablename__ = "proposals"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    cash_target_pct: Mapped[float] = mapped_column(Float, default=0.0)
    macro_summary: Mapped[str] = mapped_column(String, default="")
    # items: [{ticker, action, target_weight_pct, shares, est_value, thesis, edge, risk, score}]
    items: Mapped[list] = mapped_column(JSON, default=list)
    # omitted: [{ticker, reason}] — los seleccionados que el constructor NO fondeó. Fondear 5 de
    # 10 obliga a dejar 5 fuera; guardar el motivo permite distinguir después criterio de
    # pattern-matching. Telemetría: no vuelve a entrar a ningún prompt.
    omitted: Mapped[list] = mapped_column(JSON, default=list)


class ScanAudit(Base):
    """Traza HISTÓRICA del embudo de cada escaneo (diagnóstico, sin dinero). Una fila por ticker
    con hasta dónde llegó: pre-score → finalista (profundo) → seleccionado → en cartera, su peso
    y el precio del día.

    Es histórico: `scan_at` (idéntico en todas las filas de un escaneo) hace de identificador de
    escaneo, y se poda lo que pasa de 90 días. Telemetría para evaluación OFFLINE — nunca se
    inyecta al LLM. Ver `app/scan_audit.py` y `scripts/scan_funnel.py`.
    """

    __tablename__ = "scan_audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    scan_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    sector: Mapped[str] = mapped_column(String(48), default="")
    prescore: Mapped[float | None] = mapped_column(Float)     # None si no se llegó a pre-scorear
    price: Mapped[float | None] = mapped_column(Float)        # precio del día (sin él no se puede
    # medir DESPUÉS si las descartadas lo hicieron mejor que las compradas)
    reached_deep: Mapped[bool] = mapped_column(default=False)  # ¿pasó el corte al profundo?
    deep_score: Mapped[float | None] = mapped_column(Float)   # dos decimales, como `Score.score`
    selected: Mapped[bool] = mapped_column(default=False)      # ¿top-10 al constructor?
    funded: Mapped[bool] = mapped_column(default=False)        # ¿acabó en la cartera?
    # ¿El escaneo DECIDÍA cartera? La construcción se calcula (y se registra) también en los
    # observatorios, así que sin este flag "funded" parece libro real cuando solo es la cartera
    # HIPOTÉTICA de ese martes. NULL = fila anterior a la columna (todas eran observatorios).
    decide: Mapped[bool | None] = mapped_column(default=None)
    weight_pct: Mapped[float | None] = mapped_column(Float)
    stage: Mapped[str] = mapped_column(String(16), default="")  # etapa alcanzada (datos…cartera)
    # ¿por qué CARRIL entró este finalista al profundo (posición/watchlist/caps/sector/global)?
    # Sin saberlo no se puede evaluar si un carril aporta valor o solo ocupa hueco de otro mejor.
    # NULL = fila anterior a la columna.
    entry_lane: Mapped[str | None] = mapped_column(String(12), default=None)
    # `had_prior_thesis` retirada: se alimentaba de la tesis de la watchlist, que ya no se usa
    # ni se alimenta — quedaba siempre en False. La columna sigue en las DB viejas, sin escribir.


class ScanRun(Base):
    """Una fila por escaneo, que NUNCA se sobrescribe.

    Hoy el informe macro vive en `Meta.last_scan_report` y cada escaneo pisa al anterior, así
    que la tesis macro de los escaneos previos se pierde sin dejar rastro. Aquí queda fijada:
    `favored_sectors`/`avoided_sectors` es la INCLINACIÓN SECTORIAL que el macro emitió ese día
    y que hasta ahora se calculaba, movía el escaneo entero y se tiraba — así era imposible
    comprobar después si esa inclinación acertó.
    """

    __tablename__ = "scan_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    scan_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    cadence: Mapped[str] = mapped_column(String(16), default="")
    decide: Mapped[bool] = mapped_column(default=False)
    regime: Mapped[str] = mapped_column(String(16), default="")
    vix: Mapped[float | None] = mapped_column(Float)
    favored_sectors: Mapped[list] = mapped_column(JSON, default=list)
    avoided_sectors: Mapped[list] = mapped_column(JSON, default=list)
    outlook: Mapped[str] = mapped_column(String, default="")
    universe: Mapped[dict] = mapped_column(JSON, default=dict)
    counters: Mapped[dict] = mapped_column(JSON, default=dict)
    cost: Mapped[dict] = mapped_column(JSON, default=dict)
    # Duración de cada fase en segundos ({"macro": 12.3, "gather": 145.2, ...} + "total"). Fase
    # ausente = no corrió ese escaneo (ej. "mid" sin capa media), no que tardó 0s. Filas de antes
    # de esta columna quedan con `{}` — no hay forma de reconstruir tiempos que no se midieron.
    timings: Mapped[dict] = mapped_column(JSON, default=dict)
    issues: Mapped[list] = mapped_column(JSON, default=list)
    # Forense de los fallos del LLM: [{ticker, etapa, error, raw}]. `issues` es el texto que se
    # lee en el panel y tiene que caber; esto es el detalle para saber DESPUÉS por qué falló un
    # nombre — los logs de Railway caducan y el fallo se descubre al leer el informe, más tarde.
    failures: Mapped[list] = mapped_column(JSON, default=list)
    # Recuperación completa del escaneo (mensual decidido U observatorio semanal): sin esto, la
    # cartera hipotética de un observatorio —y su tesis— se perdía en cuanto terminaba el proceso,
    # porque `Proposal` solo se escribe cuando `decide=True`. `finalists` = snapshot por ticker de
    # los que llegaron al profundo (score, target, sector, precio, si se seleccionó/fondeó, su
    # peso); `construction` = {cash_pct, summary, items, omitted} tal cual lo escribió el
    # constructor. Mismo shape que `Proposal.items`/`omitted`, pero aquí vive SIEMPRE, no solo
    # cuando se decide.
    finalists: Mapped[list] = mapped_column(JSON, default=list)
    construction: Mapped[dict] = mapped_column(JSON, default=dict)


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
    score: Mapped[float | None] = mapped_column(Float)                  # dos decimales
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


class EquitySnapshot(Base):
    """Cierre diario del patrimonio de un libro + cierre del SPY (la curva histórica).

    Una fila por (día de mercado, libro). El job diario upserta el día en curso y RELLENA los
    huecos reproduciendo el log inmutable (asignaciones + trades) con cierres históricos de
    yfinance — un backend caído un día no agujerea la curva. Ver `app/history.py`.
    """

    __tablename__ = "equity_snapshots"
    __table_args__ = (UniqueConstraint("day", "book", name="uq_snapshot_day_book"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    book: Mapped[str] = mapped_column(String(8), index=True)
    equity: Mapped[Decimal] = mapped_column(DecimalStr(32))   # caja + posiciones al cierre
    spy_close: Mapped[float | None] = mapped_column(Float)    # benchmark del mismo día


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
