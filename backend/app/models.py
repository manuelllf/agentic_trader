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
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import REAL as PG_REAL
from sqlalchemy.orm import Mapped, mapped_column, object_session

from app.db import Base
from app.ledger.money import DecimalStr

# JSON en Postgres tiene dos formas: JSON (texto, sin indexar) y JSONB (binario, indexable).
# El SQL de la migración usa JSONB en todas las columnas de este tipo; esta variante hace que
# SQLAlchemy pida lo mismo en Postgres y siga usando JSON normal en SQLite (que no tiene JSONB).
JSON_PG = JSON().with_variant(JSONB(), "postgresql")

# BIGINT en Postgres (el SQL de la migración usa `bigint generated always as identity`), pero
# en SQLite tiene que seguir siendo exactamente INTEGER: es la única forma en que SQLite trata
# la columna como alias del rowid y autorrellena el id. Con BigInteger fijo, cada INSERT sin id
# explícito falla por NOT NULL en SQLite — medido al correr los tests tras el cambio.
PK_ID = BigInteger().with_variant(Integer(), "sqlite")

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

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    score: Mapped[float] = mapped_column(Float)              # último score profundo (1,00-100,00)
    thesis: Mapped[str] = mapped_column(Text, default="")  # tesis de una línea
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_high: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class FundamentalsSnapshot(Base):
    """Foto versionada de `screener.fundamentals.gather()`, append-only. Sustituye al cache.

    El cache (TTL 12h, overwrite) no podía ser a la vez cache operativo y fuente histórica: cada
    refresco borraba lo que el LLM había visto el escaneo anterior. Aquí cada captura es una fila
    nueva, y la reutilización dentro de la ventana es "la última foto de este ticker" — misma
    protección frente al 401 masivo de Yahoo, sin perder el histórico.
    """

    __tablename__ = "fundamentals_snapshot"
    __table_args__ = (
        Index("ix_fundamentals_snapshot_ticker_captured", "ticker", "captured_at"),
        Index("ix_fundamentals_snapshot_captured_at", "captured_at"),
    )

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # Todo `NameData` como columnas propias, nunca como JSON — un solo campo corrupto (visto en
    # producción: `pe_trailing=Infinity` de yfinance) tumbaba antes la fila ENTERA al reventar
    # el INSERT del blob; con columnas sueltas, un campo malo solo afecta a ese campo.
    sector: Mapped[str | None] = mapped_column(String(48))
    industry: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(128))
    price: Mapped[float | None] = mapped_column(Float)
    market_cap: Mapped[float | None] = mapped_column(Float)
    target_high: Mapped[float | None] = mapped_column(Float)
    target_mean: Mapped[float | None] = mapped_column(Float)
    pe_trailing: Mapped[float | None] = mapped_column(Float)
    pe_forward: Mapped[float | None] = mapped_column(Float)
    high_52w: Mapped[float | None] = mapped_column(Float)
    low_52w: Mapped[float | None] = mapped_column(Float)
    # `fundamentals_text` (el prompt YA MONTADO) NO se persiste: era texto formateado con los
    # ~85 campos de abajo mezclados dentro de una cadena — la propia definición de "chapuza"
    # que motivó este cambio. Se reconstruye al leer con la MISMA función que lo genera en vivo
    # (`_fundamentals_text`), aplicada a las filas de `FundamentalsSnapshotMetric` — nunca se
    # reimplementa el formateo, así que el prompt reconstruido es idéntico al que se mandó.
    technical_text: Mapped[str | None] = mapped_column(Text)
    earnings_text: Mapped[str | None] = mapped_column(Text)
    # True = esta captura vino del universo global (HuggingFace, `alcance=global`); False = del
    # universo de escaneo (NASDAQ). Mismo ticker puede tener filas de los dos orígenes si
    # coincide en ambos catálogos (ej. AAPL) -- esto no las funde, cada captura es su propia fila
    # con su propio origen, igual que ya pasa con capturas repetidas del mismo alcance.
    es_dataset: Mapped[bool] = mapped_column(Boolean, default=False)
    # Divisa nativa (yfinance "currency") -- antes se descartaba tras montar el prompt, hace
    # falta para saber qué tasa de `FxRate` aplicarle a `market_cap`.
    currency: Mapped[str | None] = mapped_column(String(8))
    # `market_cap` en USD -- se rellena en el gather y se recalcula cada noche (ver
    # `scheduler._fx_job`) para que un movimiento de divisa se note sin re-capturar fundamentales.
    market_cap_usd: Mapped[float | None] = mapped_column(Float)


class FundamentalsSnapshotNews(Base):
    """Titulares de una foto, uno por fila — hermanas de `FundamentalsSnapshot` por FK, nunca
    una lista serializada. `NameData.news` es `list[str]`; `posicion` conserva el orden original
    (más reciente primero, tal como lo entrega la fuente)."""

    __tablename__ = "fundamentals_snapshot_news"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    fundamentals_snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("fundamentals_snapshot.id", ondelete="CASCADE"), index=True)
    posicion: Mapped[int] = mapped_column(SmallInteger)
    texto: Mapped[str] = mapped_column(Text)


class FundamentalsSnapshotMetric(Base):
    """Los ~85 campos crudos de `.info` (Exhibit 2B del paper) que antes vivían formateados
    DENTRO de `fundamentals_text` — uno por fila, nunca texto ni JSON. `clave` es el nombre de
    campo de yfinance (`trailingPE`, `beta`...); solo uno de `valor_num`/`valor_texto` va
    relleno (3 de los ~85 son texto: `currency`, `financialCurrency`, `lastSplitFactor`)."""

    __tablename__ = "fundamentals_snapshot_metric"
    __table_args__ = (
        Index("ix_fundamentals_snapshot_metric_snapshot_id", "fundamentals_snapshot_id"),
    )

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    fundamentals_snapshot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("fundamentals_snapshot.id", ondelete="CASCADE"))
    clave: Mapped[str] = mapped_column(String(48))
    valor_num: Mapped[float | None] = mapped_column(Float)
    valor_texto: Mapped[str | None] = mapped_column(String(32))


class UniverseTicker(Base):
    """Universo completo de tickers (HuggingFace `adanosorg/free-global-stock-ticker-database`,
    licencia MIT). Append-only por versión de sync: cada sincronización mensual mete su tanda
    con su `synced_at` y no pisa la anterior, así se ve qué entra y qué sale del mercado.

    Es para la FOTO, no para el escaneo: el escaneo sigue tirando de las ~3.000 de NASDAQ.
    """

    __tablename__ = "universe_ticker"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source: Mapped[str] = mapped_column(String(64))
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    # Símbolo CON sufijo de mercado para Yahoo (`000001.SZ`) -- solo mercados no-US lo necesitan,
    # resuelto por ISIN al sincronizar (ver `universe_global.py`). NULL = usar `ticker` tal cual
    # (venue US) o "no se pudo resolver todavía / Yahoo no cubre este mercado".
    yahoo_symbol: Mapped[str | None] = mapped_column(String(32))
    exchange: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(Text)
    asset_type: Mapped[str | None] = mapped_column(String(16))   # Stock | ETF | ...
    sector: Mapped[str | None] = mapped_column(String(64))
    country: Mapped[str | None] = mapped_column(String(64))
    country_code: Mapped[str | None] = mapped_column(String(8))
    isin: Mapped[str | None] = mapped_column(String(16))


class NasdaqSnapshotTicker(Base):
    """Universo NASDAQ elegible (screener público, gratis) -- para el ESCANEO, no la foto (esa
    es `UniverseTicker`). Antes vivía como un JSON en `Meta["universe_snapshot"]`, una fila que
    se pisaba cada día sin dejar rastro de qué entraba o salía; ahora es append-only por
    `snapshot_at`, mismo patrón que `UniverseTicker` (conserva las últimas tandas, ver
    `universe.py::_podar`).

    Guarda precio, volumen, market cap y nombre del cierre; los filtros de riesgo (precio, cap,
    tipo de instrumento) se aplican a LECTURA en `universe.py`, no aquí -- nada se descarta al capturar.
    """

    __tablename__ = "nasdaq_snapshot_ticker"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    price: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)


class IbkrExchange(Base):
    """Allow-list de mercados operables en IBKR (`universe_ticker.exchange`), verificada a mano
    contra `search_contracts` -- sin esto, un scan "top market cap global" mezclaría mercados
    que ni siquiera se pueden operar en la cuenta real."""

    __tablename__ = "ibkr_exchange"

    exchange: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))


class FxRate(Base):
    """Tasa de cambio a USD por divisa, una tanda por día (append-only). Job de las 5:00
    Europa/Madrid (ver `scheduler._fx_job`) -- solo las divisas que aparecen de verdad en
    `fundamentals_snapshot.currency`, no un catálogo mundial completo."""

    __tablename__ = "fx_rate"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    currency_code: Mapped[str] = mapped_column(String(8))
    usd_per_unit: Mapped[float] = mapped_column(Float)


class Score(Base):
    """Score de un nombre en un escaneo (para el leaderboard + drill-down del informe)."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    sector: Mapped[str] = mapped_column(String(48), default="")
    # Float y no Integer: la nota del scorer lleva dos decimales. Con nota entera,
    # el desempate por market cap (fiel al paper, pensado como caso raro) repartía la mitad del
    # top-10 —diez nombres empatados a 78 para cinco plazas— y se lo llevaban siempre los cinco
    # mayores. El decimal es lo que hace que decida el análisis y no el tamaño.
    score: Mapped[float] = mapped_column(Float, index=True)   # 1,00-100,00
    headline: Mapped[str] = mapped_column(Text, default="")  # tesis de una línea
    report: Mapped[str] = mapped_column(Text, default="")    # Investment Report completo
    price: Mapped[float | None] = mapped_column(Float)         # precio al escanear
    market_cap: Mapped[float | None] = mapped_column(Float)    # para desempate por market cap (paper)
    target_price: Mapped[float | None] = mapped_column(Float)  # objetivo 3m del LLM
    held: Mapped[bool] = mapped_column(default=False)          # ¿está en cartera?
    on_watchlist: Mapped[bool] = mapped_column(default=False)
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

    @property
    def news_used(self) -> list[str]:
        """Reconstruido desde `ScoreNews` (hermanas, orden `posicion`), nunca guardado como JSON.
        `[]` cubre tanto "no había noticias" como "no se llegó a congelar nada" — ninguna lectura
        distinguía los dos casos, así que ya no hace falta el `None` que llevaba la columna JSON."""
        db = object_session(self)
        if db is None:
            return []
        rows = (db.query(ScoreNews).filter_by(score_id=self.id)
                .order_by(ScoreNews.posicion).all())
        return [r.texto for r in rows]


class ScoreNews(Base):
    """Titulares que entraron al prompt de un `Score`, uno por fila — hermanas por FK, nunca una
    lista serializada. Copia CONGELADA: las noticias son un endpoint en vivo, al día siguiente ya
    no se pueden reconstruir. Telemetría: nunca vuelve a un prompt."""

    __tablename__ = "score_news"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    score_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scores.id", ondelete="CASCADE"), index=True)
    posicion: Mapped[int] = mapped_column(SmallInteger)
    texto: Mapped[str] = mapped_column(Text)


class _TradeItemColumns:
    """Columnas compartidas por `ProposalItem` y `ScanRunConstructionItem` — mismo shape (salida
    de `portfolio_service.build_trades`), dos tablas porque un observatorio nunca crea
    `Proposal` pero sí necesita guardar su cartera hipotética (ver `ScanRun.construction`)."""

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    posicion: Mapped[int] = mapped_column(SmallInteger)   # orden de `build_trades`, conservado
    ticker: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(16))
    score: Mapped[float | None] = mapped_column(Float)
    target_weight_pct: Mapped[float] = mapped_column(Float)
    price: Mapped[str | None] = mapped_column(String(32))   # Decimal-as-str, como ya viaja hoy
    target_price: Mapped[float | None] = mapped_column(Float)
    upside_pct: Mapped[float | None] = mapped_column(Float)
    target_value: Mapped[str] = mapped_column(String(32))
    target_shares: Mapped[float] = mapped_column(Float)
    delta_shares: Mapped[float] = mapped_column(Float)
    thesis: Mapped[str] = mapped_column(Text, default="")
    edge: Mapped[str] = mapped_column(Text, default="")
    risk: Mapped[str] = mapped_column(Text, default="")


def _trade_item_dict(r) -> dict:  # noqa: ANN001 — fila de ProposalItem o ScanRunConstructionItem
    return {
        "ticker": r.ticker, "action": r.action, "score": r.score,
        "target_weight_pct": r.target_weight_pct, "price": r.price,
        "target_price": r.target_price, "upside_pct": r.upside_pct,
        "target_value": r.target_value, "target_shares": r.target_shares,
        "delta_shares": r.delta_shares, "thesis": r.thesis, "edge": r.edge, "risk": r.risk,
    }


class Proposal(Base):
    """Cartera objetivo + trades que propone el constructor en un escaneo (5 posiciones fijas)."""

    __tablename__ = "proposals"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    cash_target_pct: Mapped[float] = mapped_column(Float, default=0.0)
    macro_summary: Mapped[str] = mapped_column(Text, default="")

    @property
    def items(self) -> list[dict]:
        """[{ticker, action, target_weight_pct, shares, est_value, thesis, edge, risk, score}],
        reconstruido desde `ProposalItem` (hermanas, orden `posicion`) — nunca guardado como JSON."""
        db = object_session(self)
        if db is None:
            return []
        rows = (db.query(ProposalItem).filter_by(proposal_id=self.id)
                .order_by(ProposalItem.posicion).all())
        return [_trade_item_dict(r) for r in rows]

    @property
    def omitted(self) -> list[dict]:
        """[{ticker, reason}] — los seleccionados que el constructor NO fondeó. Fondear 5 de 10
        obliga a dejar 5 fuera; guardar el motivo permite distinguir después criterio de
        pattern-matching. Telemetría: no vuelve a entrar a ningún prompt."""
        db = object_session(self)
        if db is None:
            return []
        rows = db.query(ProposalOmitted).filter_by(proposal_id=self.id).order_by(
            ProposalOmitted.id).all()
        return [{"ticker": r.ticker, "reason": r.reason} for r in rows]


class ProposalItem(_TradeItemColumns, Base):
    __tablename__ = "proposal_item"
    __table_args__ = (Index("ix_proposal_item_proposal_id", "proposal_id"),)

    proposal_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("proposals.id", ondelete="CASCADE"))


class ProposalOmitted(Base):
    __tablename__ = "proposal_omitted"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    proposal_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("proposals.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text, default="")


class ScanAudit(Base):
    """Traza HISTÓRICA del embudo de cada escaneo (diagnóstico, sin dinero). Una fila por ticker
    con hasta dónde llegó: pre-score → finalista (profundo) → seleccionado → en cartera, su peso
    y el precio del día.

    Es histórico: `scan_at` (idéntico en todas las filas de un escaneo) hace de identificador de
    escaneo, y se poda lo que pasa de 90 días. Telemetría para evaluación OFFLINE — nunca se
    inyecta al LLM. Ver `app/scan_audit.py` y `scripts/scan_funnel.py`.
    """

    __tablename__ = "scan_audit"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
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

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    cadence: Mapped[str] = mapped_column(String(32), default="")
    decide: Mapped[bool] = mapped_column(default=False)
    regime: Mapped[str] = mapped_column(String(16), default="")
    vix: Mapped[float | None] = mapped_column(Float)
    outlook: Mapped[str] = mapped_column(Text, default="")
    # `universe_for_scan()` (app/screener/universe.py) — dict de forma fija, aplanado a columnas:
    # no es una lista y sus 5 claves no cambian nunca, partirlo en filas no ganaba nada.
    universe_fuente: Mapped[str] = mapped_column(String(16), default="")
    universe_at: Mapped[str | None] = mapped_column(String(32))
    universe_dias: Mapped[int | None] = mapped_column(Integer)
    universe_size: Mapped[int] = mapped_column(Integer, default=0)
    universe_sobre_suelo: Mapped[int | None] = mapped_column(Integer)
    # Recuento del embudo — igual que `universe_*`, dict de forma fija aplanado.
    counter_scanned: Mapped[int] = mapped_column(Integer, default=0)
    counter_prescored: Mapped[int] = mapped_column(Integer, default=0)
    counter_deep: Mapped[int] = mapped_column(Integer, default=0)
    counter_selected: Mapped[int] = mapped_column(Integer, default=0)
    counter_positions: Mapped[int] = mapped_column(Integer, default=0)
    # Totales de coste (ver `_llm_usage` en scan_service.py); el desglose por modelo/etapa vive en
    # `ScanRunCostBreakdown`, que sí es una lista de tamaño variable.
    cost_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_cache_hit_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_cache_miss_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_peak_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cost_cache_hit_ratio: Mapped[float | None] = mapped_column(Float)
    # Saldo ANTES del escaneo (no se relee al terminar: DeepSeek liquida con retraso, ver
    # `_llm_usage`/`run_scan_and_store`). No es parte de `_llm_usage`, se añade aparte.
    saldo_antes_usd: Mapped[float | None] = mapped_column(Float)
    # {cash_pct, summary} de lo que escribió el constructor; `items`/`omitted` en las tablas
    # hermanas de abajo — mismo shape que `Proposal`, pero aquí vive SIEMPRE (observatorio
    # incluido), no solo cuando `decide=True`.
    construction_cash_pct: Mapped[float] = mapped_column(Float, default=0.0)
    construction_summary: Mapped[str] = mapped_column(Text, default="")

    @property
    def favored_sectors(self) -> list[str]:
        return self._sectores("favored")

    @property
    def avoided_sectors(self) -> list[str]:
        return self._sectores("avoided")

    def _sectores(self, stance: str) -> list[str]:
        db = object_session(self)
        if db is None:
            return []
        rows = (db.query(ScanRunSector).filter_by(scan_run_id=self.id, stance=stance)
                .order_by(ScanRunSector.id).all())
        return [r.sector for r in rows]

    @property
    def universe(self) -> dict:
        return {"fuente": self.universe_fuente, "at": self.universe_at,
                "dias": self.universe_dias, "size": self.universe_size,
                "sobre_suelo": self.universe_sobre_suelo}

    @property
    def counters(self) -> dict:
        return {"scanned": self.counter_scanned, "prescored": self.counter_prescored,
                "deep": self.counter_deep, "selected": self.counter_selected,
                "positions": self.counter_positions}

    @property
    def cost(self) -> dict:
        db = object_session(self)
        rows = (db.query(ScanRunCostBreakdown).filter_by(scan_run_id=self.id).all()
                if db is not None else [])
        by_model, by_stage = {}, {}
        campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
                  "cache_miss_tokens", "peak_calls", "cost_usd")
        for r in rows:
            destino = by_model if r.dimension == "model" else by_stage
            destino[r.clave] = {k: getattr(r, k) for k in campos}
        return {
            "calls": self.cost_calls, "prompt_tokens": self.cost_prompt_tokens,
            "completion_tokens": self.cost_completion_tokens,
            "cache_hit_tokens": self.cost_cache_hit_tokens,
            "cache_miss_tokens": self.cost_cache_miss_tokens,
            "peak_calls": self.cost_peak_calls, "cost_usd": self.cost_usd,
            "by_model": by_model, "by_stage": by_stage,
            "cache_hit_ratio": self.cost_cache_hit_ratio,
            "saldo_antes_usd": self.saldo_antes_usd,
        }

    @property
    def timings(self) -> dict:
        """{fase: segundos, ..., "total": segundos}. Fase ausente = no corrió ese escaneo (ej.
        "mid" sin capa media), no que tardó 0s — reconstruido solo con las filas que existen."""
        db = object_session(self)
        if db is None:
            return {}
        rows = db.query(ScanRunTiming).filter_by(scan_run_id=self.id).all()
        return {r.fase: r.segundos for r in rows}

    @property
    def issues(self) -> list[str]:
        db = object_session(self)
        if db is None:
            return []
        rows = (db.query(ScanRunIssue).filter_by(scan_run_id=self.id)
                .order_by(ScanRunIssue.posicion).all())
        return [r.texto for r in rows]

    @property
    def failures(self) -> list[dict]:
        """Forense de los fallos del LLM: [{ticker, etapa, error, raw}]. `issues` es el texto que
        se lee en el panel y tiene que caber; esto es el detalle para saber DESPUÉS por qué falló
        un nombre — los logs de Railway caducan y el fallo se descubre al leer el informe, más
        tarde."""
        db = object_session(self)
        if db is None:
            return []
        rows = db.query(ScanRunFailure).filter_by(scan_run_id=self.id).order_by(
            ScanRunFailure.id).all()
        return [{"ticker": r.ticker, "etapa": r.etapa, "error": r.error, "raw": r.raw}
                for r in rows]

    @property
    def finalists(self) -> list[dict]:
        """Snapshot por ticker de los que llegaron al profundo (score, target, sector, precio, si
        se seleccionó/fondeó, su peso) — recuperación completa del escaneo (decida o no), porque
        `Proposal` solo se escribe cuando `decide=True`."""
        db = object_session(self)
        if db is None:
            return []
        rows = (db.query(ScanRunFinalist).filter_by(scan_run_id=self.id)
                .order_by(ScanRunFinalist.posicion).all())
        return [{
            "ticker": r.ticker, "sector": r.sector, "prescore": r.prescore, "price": r.price,
            "market_cap": r.market_cap, "deep_score": r.deep_score, "headline": r.headline,
            "target_price": r.target_price, "selected": r.selected, "funded": r.funded,
            "weight_pct": r.weight_pct, "error": r.error,
        } for r in rows]

    @property
    def construction(self) -> dict:
        db = object_session(self)
        if db is None:
            return {"cash_pct": self.construction_cash_pct, "summary": self.construction_summary,
                    "items": [], "omitted": []}
        items = (db.query(ScanRunConstructionItem).filter_by(scan_run_id=self.id)
                 .order_by(ScanRunConstructionItem.posicion).all())
        omitted = (db.query(ScanRunConstructionOmitted).filter_by(scan_run_id=self.id)
                   .order_by(ScanRunConstructionOmitted.id).all())
        return {
            "cash_pct": self.construction_cash_pct, "summary": self.construction_summary,
            "items": [_trade_item_dict(r) for r in items],
            "omitted": [{"ticker": r.ticker, "reason": r.reason} for r in omitted],
        }


class ScanRunSector(Base):
    """Inclinación sectorial que el macro emitió ese día — `stance` es 'favored'/'avoided'. Antes
    dos listas JSON; una tabla con `stance` en vez de dos evita duplicar 8 columnas idénticas."""

    __tablename__ = "scan_run_sector"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    stance: Mapped[str] = mapped_column(String(8))
    sector: Mapped[str] = mapped_column(String(48))


class ScanRunCostBreakdown(Base):
    """Desglose de `_llm_usage()` por modelo o por etapa — `dimension` es 'model'/'stage',
    `clave` el nombre del modelo o de la etapa. Necesario aparte porque macro/profundo/constructor
    comparten modelo desde que se dejó OpenRouter: sin `by_stage`, el desglose por modelo
    mezclaría las tres y dejaría de decir en qué paso se fue el dinero."""

    __tablename__ = "scan_run_cost_breakdown"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    dimension: Mapped[str] = mapped_column(String(8))
    clave: Mapped[str] = mapped_column(String(32))
    calls: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_hit_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_miss_tokens: Mapped[int] = mapped_column(Integer, default=0)
    peak_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)


class ScanRunTiming(Base):
    __tablename__ = "scan_run_timing"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    fase: Mapped[str] = mapped_column(String(16))
    segundos: Mapped[float] = mapped_column(Float)


class ScanRunIssue(Base):
    __tablename__ = "scan_run_issue"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    posicion: Mapped[int] = mapped_column(SmallInteger)
    texto: Mapped[str] = mapped_column(Text)


class ScanRunFailure(Base):
    __tablename__ = "scan_run_failure"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(16))
    etapa: Mapped[str] = mapped_column(String(16))
    error: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[str | None] = mapped_column(Text)


class ScanRunFinalist(Base):
    __tablename__ = "scan_run_finalist"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    posicion: Mapped[int] = mapped_column(SmallInteger)
    ticker: Mapped[str] = mapped_column(String(16))
    sector: Mapped[str | None] = mapped_column(String(48))
    prescore: Mapped[float | None] = mapped_column(Float)
    price: Mapped[float | None] = mapped_column(Float)
    market_cap: Mapped[float | None] = mapped_column(Float)
    deep_score: Mapped[float | None] = mapped_column(Float)
    headline: Mapped[str | None] = mapped_column(Text)
    target_price: Mapped[float | None] = mapped_column(Float)
    selected: Mapped[bool] = mapped_column(default=False)
    funded: Mapped[bool] = mapped_column(default=False)
    weight_pct: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)


class ScanRunConstructionItem(_TradeItemColumns, Base):
    __tablename__ = "scan_run_construction_item"
    __table_args__ = (Index("ix_scan_run_construction_item_scan_run_id", "scan_run_id"),)

    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"))


class ScanRunConstructionOmitted(Base):
    __tablename__ = "scan_run_construction_omitted"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    scan_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text, default="")


class LLMCall(Base):
    """Una fila por llamada al LLM, append-only. Ver `app/llm/trace.py`.

    Guarda lo que hasta ahora se generaba, se pagaba y se tiraba: el `reasoning_content` (que ya
    se factura dentro de `completion_tokens`) y el desglose cache hit/miss, cuyo precio por token
    difiere 30x entre tramos. Telemetría pura: nunca vuelve a entrar a un prompt.
    """

    __tablename__ = "llm_call"
    # Las dos consultas que se hacen de verdad: la traza de un nombre y el coste de una etapa.
    __table_args__ = (
        Index("ix_llm_call_ticker_at", "ticker", "at"),
        Index("ix_llm_call_stage_at", "stage", "at"),
    )

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    # Sin FK (el esquema no tiene ninguna): se rellena al volcar, con el ScanRun ya escrito.
    # NULL = llamada fuera de un escaneo (recheck, redeep, scripts).
    scan_run_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    stage: Mapped[str] = mapped_column(String(16))   # macro|prescore|mid|deep|constructor
    ticker: Mapped[str | None] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(48))
    reasoning_effort: Mapped[str | None] = mapped_column(String(8))
    content: Mapped[str | None] = mapped_column(Text)
    # NULL en las etapas con `reasoning_effort="none"`: ahí el modelo no genera razonamiento, no
    # es que se pierda.
    reasoning: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)  # token menos seguro (logprobs)
    prompt_cache_hit_tokens: Mapped[int] = mapped_column(Integer)
    prompt_cache_miss_tokens: Mapped[int] = mapped_column(Integer)
    completion_tokens: Mapped[int] = mapped_column(Integer)
    cost_usd: Mapped[float] = mapped_column(Float)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text)


class LLMCallLogprob(Base):
    """Distribución de probabilidad de la NOTA (prescore/capa media), relacional — nunca JSON.

    Solo existe para `stage in (prescore, mid)`: ahí la respuesta es un único número y sus
    fichas SÍ son la duda entre notas (ver `app/agents/scorer.py`); en el profundo/macro/
    constructor el número sale enterrado en prosa larga y la misma medida no dice lo mismo, así
    que esas etapas se quedan solo con el texto (ya en `LLMCall.content`/`.reasoning`).

    Una fila por (ficha de la nota × candidato): la elegida (`elegido=True`) y hasta
    `_TOP_LOGPROBS` alternativas por debajo — hermanas de la misma llamada, unidas por
    `llm_call_id`, cada una su propia fila. `parte` numera las fichas numéricas de la nota en
    orden de aparición (0, 1, ...) porque el tokenizador no siempre las corta igual (a veces
    "72"+"."+"34", a veces junto)."""

    __tablename__ = "llm_call_logprob"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    llm_call_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("llm_call.id", ondelete="CASCADE"), index=True)
    parte: Mapped[int] = mapped_column(SmallInteger)
    elegido: Mapped[bool] = mapped_column(Boolean)
    token: Mapped[str] = mapped_column(String(8))
    # REAL en Postgres (precisión simple, 4 bytes — una probabilidad no necesita más) en vez del
    # DOUBLE PRECISION por defecto de Float(); en SQLite sigue siendo el genérico Float. Sin el
    # variant, `check_schema_drift.py` marcaba una diferencia de tipo sin consecuencia funcional.
    logprob: Mapped[float] = mapped_column(Float().with_variant(PG_REAL(), "postgresql"))


# ---------------------------------------------------------------------------
# Libro de capital (Capa 5) — todo el dinero en Decimal (DecimalStr), nunca float.
# ---------------------------------------------------------------------------


class Allocation(Base):
    """Movimiento de capital del usuario al sleeve del agente (+ ingreso / − retiro).

    `currency`: la divisa en la que se aportó, tal cual — el libro real ya NO convierte a USD
    al aportar (IBKR se queda con el saldo en su divisa de origen y convierte solo en el
    momento de comprar, ver `CurrencyConversion`). El libro sombra siempre es USD."""

    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    amount: Mapped[Decimal] = mapped_column(DecimalStr(32))  # firmado: + ingreso, − retiro
    note: Mapped[str] = mapped_column(Text, default="")
    book: Mapped[str] = mapped_column(String(8), default=BOOK_SHADOW, index=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")


class Trade(Base):
    """Ejecución inmutable atribuida al agente (por `order_ref`). No se edita nunca."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(16), index=True)
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    quantity: Mapped[Decimal] = mapped_column(DecimalStr(32))
    price: Mapped[Decimal] = mapped_column(DecimalStr(32))
    fees: Mapped[Decimal] = mapped_column(DecimalStr(32), default=Decimal("0"))
    order_ref: Mapped[str] = mapped_column(String(48), index=True)  # etiqueta AGENT-<uuid>
    realized_pnl: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # solo en ventas
    book: Mapped[str] = mapped_column(String(8), default=BOOK_SHADOW, index=True)


class CurrencyConversion(Base):
    """Conversión EUR→USD que IBKR ejecuta SOLA al comprar sin caja USD suficiente (auto-FX) —
    hermana de `Trade`, nunca mezclada con él: una compra puede generar dos movimientos de
    naturaleza distinta (la acción y la divisa), cada uno su propia fila, su propio comportamiento.

    Se detecta tras el fill buscando en `trades()` de IBKR una ejecución `sec_type=CASH` del par
    EUR.USD en el MISMO `trade_time` que la acción (no `order_id` — IBKR genera uno propio para
    la conversión) y con `order_type != "OTHER"`: eso último excluye el barrido diario de la casa
    de custodia (céntimos sueltos a las 21:00 UTC, sin `order_ref` nuestro, no atribuible al
    agente — verificado contra el histórico real de la cuenta). `external_id` es el `trade_id`
    de IBKR para esa ejecución: único de verdad, evita duplicar la misma conversión si se
    reconcilia más de una vez (`reconcile_working` es best-effort y puede repetirse)."""

    __tablename__ = "currency_conversions"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    order_ref: Mapped[str] = mapped_column(String(48), index=True)  # el order_ref que la disparó
    eur_amount: Mapped[Decimal] = mapped_column(DecimalStr(32))    # EUR vendidos (positivo)
    usd_amount: Mapped[Decimal] = mapped_column(DecimalStr(32))    # USD brutos recibidos (net_amount)
    rate: Mapped[Decimal] = mapped_column(DecimalStr(32))          # precio del par en el fill
    fee: Mapped[Decimal] = mapped_column(DecimalStr(32), default=Decimal("0"))
    book: Mapped[str] = mapped_column(String(8), default=BOOK_REAL, index=True)


class Position(Base):
    """Posición ABIERTA del agente (su parte, aunque la cuenta IBKR esté mezclada).

    Único por (ticker, book): el mismo nombre puede vivir a la vez en sombra y en real.
    """

    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("ticker", "book", name="uq_position_ticker_book"),)

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
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

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
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
    thesis: Mapped[str] = mapped_column(Text, default="")
    edge: Mapped[str] = mapped_column(Text, default="")
    risk: Mapped[str] = mapped_column(Text, default="")
    macro_summary: Mapped[str] = mapped_column(Text, default="")

    # Resultado de la ejecución (solo si status=executed/working/failed).
    order_ref: Mapped[str] = mapped_column(String(48), default="")      # coid propio (idempotencia)
    broker_order_id: Mapped[str | None] = mapped_column(String(48))     # id de orden en IBKR (reconciliar)
    requested_quantity: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # acciones PEDIDAS
    quantity: Mapped[Decimal | None] = mapped_column(DecimalStr(32))    # acciones YA ejecutadas (acumulado)
    fill_price: Mapped[Decimal | None] = mapped_column(DecimalStr(32))  # precio medio de ejecución
    result_msg: Mapped[str] = mapped_column(Text, default="")


class EquitySnapshot(Base):
    """Cierre diario del patrimonio de un libro + cierre del SPY (la curva histórica).

    Una fila por (día de mercado, libro). El job diario upserta el día en curso y RELLENA los
    huecos reproduciendo el log inmutable (asignaciones + trades) con cierres históricos de
    yfinance — un backend caído un día no agujerea la curva. Ver `app/history.py`.
    """

    __tablename__ = "equity_snapshots"
    __table_args__ = (UniqueConstraint("day", "book", name="uq_snapshot_day_book"),)

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
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
    value: Mapped[str] = mapped_column(Text)


class PersonalPosition(Base):
    """Snapshot de la cartera PERSONAL del usuario en IBKR — INTOCABLE para el agente.

    Existe para separar sin ambigüedad: en la cuenta IBKR conviven las posiciones personales
    del usuario y las del agente (libro 'real'). El agente NUNCA lee esta tabla para dimensionar
    ni vender (su libro es la única fuente); esto es el recibo visible de "esto es tuyo" y
    alimenta el mini-tracker de la Sala Real. Se refresca con /personal/sync (read-only a IBKR).
    """

    __tablename__ = "personal_positions"

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    ticker: Mapped[str] = mapped_column(String(48), index=True)     # símbolo o descripción corta
    description: Mapped[str] = mapped_column(Text, default="")    # contractDesc completo (opciones)
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

    id: Mapped[int] = mapped_column(PK_ID, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    endpoint: Mapped[str] = mapped_column(Text, unique=True, index=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
