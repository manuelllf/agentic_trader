"""Cartera híbrida EUR/USD del libro real — caja por divisa, sizing combinado, y el
emparejamiento del auto-FX de IBKR contra los tres patrones reales vistos en producción
(STK, CASH/FXCONV disparado por una compra, CASH/FXCONV/OTHER del barrido de las 21:00 UTC
que hay que ignorar)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.approvals import approve, create_from_items
from app.brokers.base import BrokerResult, FxFill
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_REAL, Approval, CurrencyConversion


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


# ---- caja por divisa, sizing combinado ---------------------------------------

def test_cash_by_currency_separa_eur_y_usd(db) -> None:
    ledger.allocate(db, 500, book=BOOK_REAL, currency="EUR")
    ledger.allocate(db, 200, book=BOOK_REAL, currency="USD")
    wallet = ledger.cash_by_currency(db, BOOK_REAL)
    assert wallet == {"USD": Decimal("200.00"), "EUR": Decimal("500.00")}
    # `available_cash` (el que usa `record_buy`) solo ve el USD — el EUR es otra caja.
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("200.00")


def test_size_to_weight_suma_eur_al_cambio_solo_si_se_pide(db) -> None:
    ledger.allocate(db, 100, book=BOOK_REAL, currency="USD")
    ledger.allocate(db, 100, book=BOOK_REAL, currency="EUR")   # ≈ $115 al cambio de este test

    # Sin tipo de cambio (dry-run): el EUR no cuenta, el sizing ve solo $100 (libro real: sin
    # comisión simulada, ver `commissions.py` — a diferencia de la sombra, aquí cabe exacto).
    qty_sin, _ = ledger.size_to_weight(db, BOOK_REAL, "AAA", "comprar", 100, Decimal("10"))
    assert qty_sin == Decimal("10.0000")

    # Con tipo de cambio (bróker en vivo): $100 + €100×1.15 ≈ $215 gastables.
    qty_con, _ = ledger.size_to_weight(
        db, BOOK_REAL, "AAA", "comprar", 100, Decimal("10"), eur_usd_rate=Decimal("1.15"))
    assert qty_con > qty_sin


def test_cash_by_currency_libro_vacio_no_revienta(db) -> None:
    """Sin ninguna asignación todavía: cero limpio en las dos divisas, no un error ni None."""
    assert ledger.cash_by_currency(db, BOOK_REAL) == {"USD": Decimal("0.00"), "EUR": Decimal("0.00")}
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("0.00")


def test_size_to_weight_rate_none_y_cero_se_comportan_igual(db) -> None:
    """`if eur_usd_rate:` trata `None` y `Decimal("0")` como lo mismo (0 es falsy en Python) —
    fijado con un test explícito para que un refactor futuro (p.ej. `is not None`) no cambie
    el comportamiento sin que salte una alarma: un cambio a cero es tan "sin cotización" como
    no tener ninguna."""
    ledger.allocate(db, 100, book=BOOK_REAL, currency="USD")
    ledger.allocate(db, 500, book=BOOK_REAL, currency="EUR")
    sin_rate, _ = ledger.size_to_weight(db, BOOK_REAL, "AAA", "comprar", 100, Decimal("10"),
                                        eur_usd_rate=None)
    rate_cero, _ = ledger.size_to_weight(db, BOOK_REAL, "AAA", "comprar", 100, Decimal("10"),
                                         eur_usd_rate=Decimal("0"))
    assert sin_rate == rate_cero == Decimal("10.0000")   # los 500 EUR no cuentan en ninguno de los dos


def test_size_to_weight_solo_eur_sin_cambio_no_ve_capital(db) -> None:
    """Caso real: solo hay EUR (nada de USD todavía) y `/fx` está caído (sin cotización) — el
    sizing, a propósito, NO inventa un cambio de emergencia: prefiere fallar limpio ("sin
    capital") a sizear con un número inventado. Ni un céntimo en juego sin dato real detrás."""
    ledger.allocate(db, 1000, book=BOOK_REAL, currency="EUR")
    with pytest.raises(ledger.InsufficientFunds, match="capital"):
        ledger.size_to_weight(db, BOOK_REAL, "AAA", "comprar", 100, Decimal("10"),
                              eur_usd_rate=None)


def test_cash_by_currency_refleja_una_venta_de_eur_de_mas_sin_esconderla(db) -> None:
    """Si una `CurrencyConversion` (por el motivo que sea: un bug, un dato duplicado que burló
    el `external_id`) vendiese más EUR del que hay asignado, `cash_by_currency` NO lo enmascara
    con un suelo en cero — devuelve el número negativo tal cual. El guardarraíl de verdad contra
    gastar de más vive en `record_buy`/`InsufficientFunds` (el lado USD), no aquí: esta función
    es un espejo de lo que hay, no un validador."""
    ledger.allocate(db, 100, book=BOOK_REAL, currency="EUR")
    db.add(CurrencyConversion(
        external_id="ext-x", order_ref="AGENT-REAL-x",
        eur_amount=Decimal("150.00"), usd_amount=Decimal("165.00"),
        rate=Decimal("1.10"), fee=Decimal("0"), book=BOOK_REAL,
    ))
    db.commit()
    assert ledger.cash_by_currency(db, BOOK_REAL)["EUR"] == Decimal("-50.00")


def test_currency_conversion_resta_eur_y_suma_usd(db) -> None:
    ledger.allocate(db, 500, book=BOOK_REAL, currency="EUR")
    db.add(CurrencyConversion(
        external_id="ext-1", order_ref="AGENT-REAL-x",
        eur_amount=Decimal("100.00"), usd_amount=Decimal("115.00"),
        rate=Decimal("1.15"), fee=Decimal("0.50"), book=BOOK_REAL,
    ))
    db.commit()
    wallet = ledger.cash_by_currency(db, BOOK_REAL)
    assert wallet["EUR"] == Decimal("400.00")          # 500 − 100 vendidos
    assert wallet["USD"] == Decimal("114.50")           # 115 recibidos − 0.50 de comisión


# ---- IbkrWebBroker.fx_conversions_for: los tres patrones reales ---------------

class _FakeIbindClient:
    """Solo lo que `fx_conversions_for` necesita: `.trades(...).data`."""

    def __init__(self, trades: list[dict]) -> None:
        self._trades = trades

    def trades(self, days=None, account_id=None):  # noqa: ANN001
        class _R:
            def __init__(self, data):
                self.data = data
        return _R(self._trades)


def _broker_with(trades: list[dict]):
    from app.brokers.ibkr_web import IbkrWebBroker

    b = object.__new__(IbkrWebBroker)   # sin __init__: sin credenciales ni sesión real
    b._client = _FakeIbindClient(trades)
    b._account = "U1"
    return b


_STK_TRADE = {
    "symbol": "ASTS", "sec_type": "STK", "currency": "USD", "side": "BUY",
    "size": 16, "price": 59.3, "trade_time": "2026-07-16T13:41:01Z",
    "order_type": "LIMIT", "commission": 0.03628754, "net_amount": 948.8,
    "order_id": 1225203650,
}
_FX_TRADE_DISPARADA = {
    "symbol": "EUR.USD", "sec_type": "CASH", "exchange": "FXCONV", "side": "SELL",
    "size": 854.17, "price": 1.14516, "trade_time": "2026-07-16T13:41:01Z",
    "order_type": "MARKET", "commission": 0, "net_amount": 978.1613172,
    "order_id": 1225203462, "trade_id": "0000d5db.6dc152e0.01.01",
}
_FX_BARRIDO_CUSTODIA = {   # 21:00 UTC, sin relación con ninguna orden — debe IGNORARSE
    "symbol": "EUR.USD", "sec_type": "CASH", "exchange": "FXCONV", "side": "SELL",
    "size": 0.00589918, "price": 1.14381916, "trade_time": "2026-07-16T13:41:01Z",
    "order_type": "OTHER", "commission": 0, "net_amount": 0.0067476,
    "order_id": 1225974641, "trade_id": "CUSTHSFX.0256c02b.01.01",
}


def test_encuentra_la_conversion_disparada_por_la_compra() -> None:
    broker = _broker_with([_STK_TRADE, _FX_TRADE_DISPARADA, _FX_BARRIDO_CUSTODIA])
    fx = broker.fx_conversions_for("1225203650")
    assert len(fx) == 1                                    # el barrido de custodia NO entra
    assert fx[0] == FxFill(
        external_id="0000d5db.6dc152e0.01.01",
        eur_amount=Decimal("854.17"), usd_amount=Decimal("978.1613172"),
        rate=Decimal("1.14516"), fee=Decimal("0"),
    )


def test_sin_auto_fx_no_encuentra_nada() -> None:
    solo_stk = {**_STK_TRADE, "order_id": 999}
    broker = _broker_with([solo_stk])
    assert broker.fx_conversions_for("999") == []


def test_orden_distinta_no_se_confunde() -> None:
    broker = _broker_with([_STK_TRADE, _FX_TRADE_DISPARADA])
    assert broker.fx_conversions_for("otra-orden-cualquiera") == []


def test_ignora_otro_par_de_divisa_en_el_mismo_instante() -> None:
    """Que otra cosa ejecute en el MISMO segundo (coincidencia real, no imposible con miles de
    fills al día) no debe colarse solo por compartir `trade_time` — el símbolo tiene que ser
    EUR.USD, nada más."""
    otro_par = {**_FX_TRADE_DISPARADA, "symbol": "GBP.USD", "trade_id": "otro-par-1"}
    broker = _broker_with([_STK_TRADE, otro_par])
    assert broker.fx_conversions_for("1225203650") == []


def test_ignora_cash_sin_trade_id() -> None:
    """Una ejecución CASH/EUR.USD candidata pero sin `trade_id` (dato incompleto de IBKR) se
    salta en vez de inventar un id de conversión — sin id único no hay forma de deduplicar
    después si se reconcilia dos veces."""
    sin_id = {**_FX_TRADE_DISPARADA, "trade_id": None}
    broker = _broker_with([_STK_TRADE, sin_id])
    assert broker.fx_conversions_for("1225203650") == []


def test_trades_falla_no_revienta_devuelve_vacio() -> None:
    """Un fallo de red al leer `trades()` no debe tumbar la reconciliación del fill — se trata
    igual que "no hubo auto-FX", el llamador reintentará en el siguiente sondeo."""
    class _RompeClient:
        def trades(self, days=None, account_id=None):  # noqa: ANN001
            raise RuntimeError("timeout de verdad")

    from app.brokers.ibkr_web import IbkrWebBroker
    b = object.__new__(IbkrWebBroker)
    b._client = _RompeClient()
    b._account = "U1"
    assert b.fx_conversions_for("1225203650") == []


def test_trades_data_no_es_lista_no_revienta() -> None:
    """`trades().data` puede venir `None` (cuenta sin actividad) o un dict de error — cualquier
    forma que no sea lista se trata como "sin trades", nunca un TypeError a medio camino."""
    for basura in (None, {"error": "algo"}, "no debería pasar nunca pero por si acaso"):
        broker = _broker_with(basura)   # type: ignore[arg-type]
        assert broker.fx_conversions_for("1225203650") == []


def test_dos_fills_de_la_misma_orden_a_horas_distintas() -> None:
    """Fill parcial: dos ejecuciones STK del MISMO `order_id` en instantes distintos (p. ej. dos
    venues) — el auto-FX de CADA instante debe encontrarse, no solo el del primero."""
    stk_2 = {**_STK_TRADE, "trade_time": "2026-07-16T13:41:05Z", "exchange": "NASDAQ"}
    fx_2 = {**_FX_TRADE_DISPARADA, "trade_time": "2026-07-16T13:41:05Z",
           "trade_id": "segunda-conversion", "size": 12.3, "net_amount": 14.0}
    broker = _broker_with([_STK_TRADE, stk_2, _FX_TRADE_DISPARADA, fx_2])
    fx = broker.fx_conversions_for("1225203650")
    assert {f.external_id for f in fx} == {"0000d5db.6dc152e0.01.01", "segunda-conversion"}


def test_lote_compartido_dos_ordenes_ven_las_mismas_conversiones() -> None:
    """Límite conocido y documentado: si DOS órdenes nuestras ejecutan en el mismo segundo y
    comparten un único auto-FX de fondo, `fx_conversions_for` (que empareja por hora, no por
    id — IBKR no da otra cosa) devuelve la MISMA conversión a las dos. Quien evita duplicarla en
    el libro es `_reconcile_fx` por `external_id` (ver test de approvals), no esta función — a
    este nivel es correcto y esperado que ambas la "vean"."""
    otra_orden_stk = {**_STK_TRADE, "order_id": 555, "symbol": "MSFT"}
    broker = _broker_with([_STK_TRADE, otra_orden_stk, _FX_TRADE_DISPARADA])
    fx_a = broker.fx_conversions_for("1225203650")
    fx_b = broker.fx_conversions_for("555")
    assert fx_a == fx_b == [FxFill(
        external_id="0000d5db.6dc152e0.01.01",
        eur_amount=Decimal("854.17"), usd_amount=Decimal("978.1613172"),
        rate=Decimal("1.14516"), fee=Decimal("0"),
    )]


# ---- de punta a punta: approve() con auto-FX real ------------------------------

def _items():
    return [{"ticker": "HUMA", "action": "comprar", "target_weight_pct": 100.0, "price": 100}]


class _LiveBrokerConFx:
    """Bróker en vivo que rellena el hueco de USD con una conversión EUR→USD real."""

    name = "fake-live"
    is_live = True

    def place_order(self, ticker, side, quantity, order_ref=""):  # noqa: ANN001
        return BrokerResult(ok=True, fill_price=Decimal("100"), simulated=False,
                            status="filled", order_id="OID-1",
                            filled_quantity=Decimal(quantity), message="filled")

    def poll_order(self, order_id):  # noqa: ANN001
        raise AssertionError("no debería sondear: la orden ya llenó al enviarla")

    def fx_conversions_for(self, broker_order_id):  # noqa: ANN001
        return [FxFill(external_id="fx-1", eur_amount=Decimal("50.00"),
                       usd_amount=Decimal("58.00"), rate=Decimal("1.16"), fee=Decimal("0"))]

    def status(self):
        return {"mode": "live", "live": True, "detail": "fake"}


def test_approve_reconcilia_auto_fx_antes_de_mover_el_libro(db, monkeypatch) -> None:
    """Caja real: $5 + €50. El sizing (con el cambio indicativo) pide más de lo que hay en $ —
    IBKR cubre el resto con su auto-FX, y el libro tiene que verlo ANTES de `record_buy` o la
    compra se rechazaría por falta de caja USD aunque la operación sea correcta."""
    from app import approvals as approvals_mod, tracking

    monkeypatch.setattr(tracking, "live_prices",
                        lambda tickers: {t: 100.0 for t in tickers} | {"EURUSD=X": 1.16})
    ledger.allocate(db, 5, book=BOOK_REAL, currency="USD")
    ledger.allocate(db, 50, book=BOOK_REAL, currency="EUR")
    create_from_items(db, _items(), "m")
    a = db.query(Approval).filter(Approval.status == "pending").first()

    broker = _LiveBrokerConFx()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: broker)
    out = approve(db, a.id)

    assert out.status == "executed", out.result_msg
    conv = db.query(CurrencyConversion).filter_by(external_id="fx-1").one()
    assert conv.eur_amount == Decimal("50.00")
    wallet = ledger.cash_by_currency(db, BOOK_REAL)
    assert wallet["EUR"] == Decimal("0.00")             # los 50 EUR se vendieron enteros


def test_reconciliar_dos_veces_no_duplica_la_conversion(db, monkeypatch) -> None:
    """`_reconcile_fx` corre en cada `approve`/`reconcile_working` — idempotente por
    `external_id`, nunca duplica la misma conversión."""
    from app import approvals as approvals_mod
    from app.approvals import _reconcile_fx

    ledger.allocate(db, 500, book=BOOK_REAL, currency="EUR")
    a = Approval(ticker="AAA", action="comprar", order_ref="AGENT-REAL-x",
                broker_order_id="OID-1", status="working")
    db.add(a)
    db.commit()

    monkeypatch.setattr(approvals_mod, "get_broker", lambda: _LiveBrokerConFx())
    _reconcile_fx(db, a)
    _reconcile_fx(db, a)   # segunda pasada: el mismo external_id ya existe
    db.commit()
    assert db.query(CurrencyConversion).filter_by(external_id="fx-1").count() == 1


def test_dos_aprobaciones_del_mismo_lote_no_duplican_la_conversion(db, monkeypatch) -> None:
    """El caso real de dos órdenes compartiendo un único auto-FX de fondo (ver el test del
    bróker): la segunda que reconcilia encuentra el `external_id` YA registrado por la primera
    y no inserta nada más — la caja EUR/USD se mueve una sola vez, no dos."""
    from app import approvals as approvals_mod
    from app.approvals import _reconcile_fx

    ledger.allocate(db, 500, book=BOOK_REAL, currency="EUR")
    a1 = Approval(ticker="AAA", action="comprar", order_ref="AGENT-REAL-1",
                 broker_order_id="OID-1", status="working")
    a2 = Approval(ticker="BBB", action="comprar", order_ref="AGENT-REAL-2",
                 broker_order_id="OID-2", status="working")
    db.add_all([a1, a2])
    db.commit()

    # Mismo `external_id` para las dos órdenes: exactamente lo que devuelve el bróker real
    # cuando dos compras comparten el mismo auto-FX de fondo (mismo trade_time).
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: _LiveBrokerConFx())
    _reconcile_fx(db, a1)
    _reconcile_fx(db, a2)
    db.commit()

    assert db.query(CurrencyConversion).filter_by(external_id="fx-1").count() == 1
    wallet = ledger.cash_by_currency(db, BOOK_REAL)
    assert wallet["EUR"] == Decimal("450.00")   # los 50 EUR se restaron UNA vez, no dos


class _LiveBrokerSinFx(_LiveBrokerConFx):
    """Como `_LiveBrokerConFx` pero el auto-FX nunca aparece en `trades()` (latencia de IBKR,
    fallo del lookup, lo que sea) — para probar que el fallo de emparejamiento es RUIDOSO, no
    un agujero silencioso en el libro."""

    def fx_conversions_for(self, broker_order_id):  # noqa: ANN001
        return []


def test_approve_falla_limpio_si_el_auto_fx_no_se_encuentra(db, monkeypatch) -> None:
    """El sizing contó con €50 (al cambio indicativo) para cubrir una compra que la caja $ sola
    no llega a pagar. Si al reconciliar el auto-FX no aparece (fallo de IBKR o del lookup), la
    compra NO debe apuntarse a medias: `record_buy` rechaza por caja insuficiente, la aprobación
    queda 'failed' con un motivo legible, y no se crea ni Trade ni Position ni conversión — nada
    dangling, nada que reconciliar a mano después."""
    from app import approvals as approvals_mod, tracking
    from app.models import BOOK_REAL, Position, Trade

    monkeypatch.setattr(tracking, "live_prices",
                        lambda tickers: {t: 100.0 for t in tickers} | {"EURUSD=X": 1.16})
    ledger.allocate(db, 5, book=BOOK_REAL, currency="USD")
    ledger.allocate(db, 50, book=BOOK_REAL, currency="EUR")   # el sizing SÍ cuenta con esto
    create_from_items(db, _items(), "m")
    a = db.query(Approval).filter(Approval.status == "pending").first()

    monkeypatch.setattr(approvals_mod, "get_broker", lambda: _LiveBrokerSinFx())
    out = approve(db, a.id)

    assert out.status == "failed"
    assert "caja" in out.result_msg.lower() or "cash" in out.result_msg.lower()
    assert db.query(Trade).filter(Trade.book == BOOK_REAL).count() == 0
    assert db.query(Position).filter(Position.book == BOOK_REAL).count() == 0
    assert db.query(CurrencyConversion).count() == 0
    # Y el capital sigue intacto — nada se movió por el intento fallido.
    assert ledger.cash_by_currency(db, BOOK_REAL) == {"USD": Decimal("5.00"), "EUR": Decimal("50.00")}


def test_reconcile_working_reintenta_sin_corromper_si_falta_el_fx(db, monkeypatch) -> None:
    """Mismo fallo que el test anterior pero visto desde `reconcile_working` (el camino de una
    orden límite que primero queda 'working' y se reconcilia después): el fallo se traga con un
    log y un rollback de ESA aprobación — la aprobación se queda 'working' (no 'failed', no
    'executed' a medias) para poder reintentarse en el siguiente sondeo, y el capital no se
    mueve ni un céntimo mientras tanto."""
    from app import approvals as approvals_mod, tracking

    monkeypatch.setattr(tracking, "live_prices",
                        lambda tickers: {t: 100.0 for t in tickers} | {"EURUSD=X": 1.16})
    ledger.allocate(db, 5, book=BOOK_REAL, currency="USD")
    ledger.allocate(db, 50, book=BOOK_REAL, currency="EUR")
    create_from_items(db, _items(), "m")
    a = db.query(Approval).filter(Approval.status == "pending").first()

    class _WorkingLuegoFilledSinFx(_LiveBrokerSinFx):
        def place_order(self, ticker, side, quantity, order_ref=""):  # noqa: ANN001
            return BrokerResult(ok=True, fill_price=None, simulated=False, status="working",
                                order_id="OID-1", message="enviada")

        def poll_order(self, order_id):  # noqa: ANN001
            return BrokerResult(ok=True, fill_price=Decimal("100"), simulated=False,
                                status="filled", order_id=order_id,
                                filled_quantity=Decimal("0.63"), message="filled")

    broker = _WorkingLuegoFilledSinFx()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: broker)
    out = approve(db, a.id)
    assert out.status == "working"                          # enviada, sin auto-FX que reconciliar aún

    changed = approvals_mod.reconcile_working(db)
    assert changed == 0                                      # el fallo no cuenta como cambio real
    refreshed = db.get(Approval, a.id)
    assert refreshed.status == "working"                     # NO 'failed': se reintentará solo
    assert refreshed.quantity in (None, Decimal("0"))         # nada se apuntó a medias
    assert ledger.cash_by_currency(db, BOOK_REAL) == {"USD": Decimal("5.00"), "EUR": Decimal("50.00")}
    # Y el motivo del atasco se ve en el panel — no un log que el usuario nunca llega a leer.
    assert "falló" in refreshed.result_msg.lower() or "fall" in refreshed.result_msg.lower()
