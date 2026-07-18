"""Tests de la Sala Real: libros separados, aprobaciones Sí/No, sizing Decimal exacto."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import approvals as approvals_mod
from app import models  # noqa: F401
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_REAL, Approval


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def fixed_prices(monkeypatch):
    """Precios vivos deterministas y broker dry-run con fill fijo."""
    prices = {"HIG": 100.0, "CP": 50.0}
    from app import tracking
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: prices)
    return prices


# ---- libros separados ----

def test_books_are_independent(db) -> None:
    ledger.allocate(db, 2000, book="shadow")
    ledger.allocate(db, 500, book=BOOK_REAL)
    ledger.record_buy(db, "HIG", "1", "100", "S-REF", book="shadow")

    assert ledger.available_cash(db) == Decimal("1900.00")
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("500.00")
    assert ledger.open_positions(db, BOOK_REAL) == []

    # mismo ticker en ambos libros a la vez
    ledger.record_buy(db, "HIG", "2", "100", "R-REF", book=BOOK_REAL)
    assert len(ledger.open_positions(db)) == 1
    assert len(ledger.open_positions(db, BOOK_REAL)) == 1


def test_reset_shadow_keeps_capital_and_leaves_real_untouched(db) -> None:
    from app.models import BOOK_SHADOW, EquitySnapshot, Meta, Position, Trade

    ledger.allocate(db, 2000, book=BOOK_SHADOW)
    ledger.record_buy(db, "HIG", "5", "100", "S-REF", book=BOOK_SHADOW)   # sombra: caja 1500 + posición
    ledger.allocate(db, 500, book=BOOK_REAL)
    ledger.record_buy(db, "CP", "3", "50", "R-REF", book=BOOK_REAL)       # real: no debe tocarse
    db.add(EquitySnapshot(day=date(2026, 7, 14), book=BOOK_SHADOW,
                          equity=Decimal("2000.00"), spy_close=750.0))
    db.add(Meta(key="spy_ref:shadow:1", value="750.0"))
    db.commit()

    out = ledger.reset_shadow_book(db)

    assert out["ok"] and out["deleted"]["positions"] == 1 and out["deleted"]["trades"] == 1
    assert ledger.available_cash(db, BOOK_SHADOW) == Decimal("2000.00")   # capital conservado (todo en caja)
    assert ledger.open_positions(db, BOOK_SHADOW) == []                   # sin holdings
    assert db.query(EquitySnapshot).filter(EquitySnapshot.book == BOOK_SHADOW).count() == 0
    assert db.query(Meta).filter(Meta.key.like("spy_ref:shadow:%")).count() == 0
    # el libro REAL intacto
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("350.00")
    assert len(ledger.open_positions(db, BOOK_REAL)) == 1


# ---- creación de aprobaciones desde la propuesta ----

def _items():
    return [
        {"ticker": "HIG", "action": "comprar", "score": 85, "target_weight_pct": 30.0,
         "price": "100", "target_price": 120.0, "upside_pct": 20.0,
         "thesis": "t", "edge": "e", "risk": "r"},
        {"ticker": "CP", "action": "mantener", "score": 80, "target_weight_pct": 20.0,
         "price": "50", "target_price": None, "upside_pct": None,
         "thesis": "", "edge": "", "risk": ""},
    ]


def test_create_from_items_skips_mantener_and_replaces_old(db) -> None:
    n = approvals_mod.create_from_items(db, _items(), "macro X")
    assert n == 1  # 'mantener' no genera aprobación
    first = approvals_mod.pending(db)[0]
    assert first.ticker == "HIG" and first.macro_summary == "macro X"

    # un escaneo nuevo caduca lo pendiente anterior
    approvals_mod.create_from_items(db, _items(), "macro Y")
    pend = approvals_mod.pending(db)
    assert len(pend) == 1 and pend[0].macro_summary == "macro Y"
    assert any(a.status == "expired" for a in approvals_mod.history(db))


# ---- Sí / No ----

def test_reject_discards_without_effect(db, fixed_prices) -> None:
    approvals_mod.create_from_items(db, _items(), "m")
    a = approvals_mod.pending(db)[0]
    out = approvals_mod.reject(db, a.id)
    assert out.status == "rejected"
    assert ledger.open_positions(db, BOOK_REAL) == []          # nada ejecutado
    with pytest.raises(ValueError):                            # no se decide dos veces
        approvals_mod.approve(db, a.id)


def test_approve_executes_exact_decimal(db, fixed_prices) -> None:
    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, _items(), "m")
    a = approvals_mod.pending(db)[0]

    out = approvals_mod.approve(db, a.id)
    assert out.status == "executed", out.result_msg
    # 30% de $1000 a $100 = 3 acciones exactas
    assert out.quantity == Decimal("3.0000")
    assert out.fill_price == Decimal("100.00")

    pos = ledger.open_positions(db, BOOK_REAL)
    assert len(pos) == 1 and pos[0].ticker == "HIG"
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("700.00")
    # el libro sombra ni se entera
    assert ledger.available_cash(db) == Decimal("0.00")


def test_approve_without_capital_fails_clean(db, fixed_prices) -> None:
    approvals_mod.create_from_items(db, _items(), "m")
    a = approvals_mod.pending(db)[0]
    out = approvals_mod.approve(db, a.id)
    assert out.status == "failed"
    assert "capital" in out.result_msg.lower()
    assert ledger.open_positions(db, BOOK_REAL) == []


class _FakeBroker:
    """Broker de mentira para ejercitar el camino LÍMITE en vivo (working → reconciliar)."""

    name = "fake"
    is_live = True

    def __init__(self) -> None:
        self.place_status = "working"
        self.poll_status = "working"
        self.filled_qty: Decimal | None = None
        self.fill_price = Decimal("100")

    def place_order(self, ticker, side, quantity, order_ref=""):  # noqa: ANN001
        from app.brokers.base import BrokerResult
        return BrokerResult(ok=True, fill_price=None, simulated=False, status=self.place_status,
                            order_id="OID1", filled_quantity=None, message="enviada")

    def poll_order(self, order_id):  # noqa: ANN001
        from app.brokers.base import BrokerResult
        return BrokerResult(ok=(self.poll_status != "rejected"), fill_price=self.fill_price,
                            simulated=False, status=self.poll_status, order_id=order_id,
                            filled_quantity=self.filled_qty, message=f"estado {self.poll_status}")

    def status(self):
        return {"mode": "live", "live": True, "detail": "fake"}


def test_limit_working_then_reconciled(db, fixed_prices, monkeypatch) -> None:
    """La orden límite queda 'working' al enviar y no registra nada; al reconciliar (IBKR ya
    ejecutó) entra el fill REAL en el libro real. Ni un céntimo antes de tiempo."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, _items(), "m")            # HIG comprar 30% @100 → 3 acc.
    a = approvals_mod.pending(db)[0]

    fake = _FakeBroker()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)

    out = approvals_mod.approve(db, a.id)
    assert out.status == "working"                                # enviada, sin fill aún
    assert out.broker_order_id == "OID1"
    assert ledger.open_positions(db, BOOK_REAL) == []             # NADA ejecutado todavía
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("1000.00")

    # IBKR ejecuta la orden → la reconciliación registra el fill real.
    fake.poll_status = "filled"
    fake.filled_qty = Decimal("3")
    fake.fill_price = Decimal("100")
    n = approvals_mod.reconcile_working(db)
    assert n == 1

    a2 = db.get(Approval, a.id)
    assert a2.status == "executed" and a2.quantity == Decimal("3")
    pos = ledger.open_positions(db, BOOK_REAL)
    assert len(pos) == 1 and pos[0].quantity == Decimal("3")
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("700.00")  # 1000 − 3×100

    # Reconciliar otra vez no vuelve a comprar (idempotente).
    assert approvals_mod.reconcile_working(db) == 0
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("700.00")


def test_partial_fill_incremental_price_exact(db, fixed_prices, monkeypatch) -> None:
    """Fill parcial a un precio y resto a otro: el coste del libro debe cuadrar AL CÉNTIMO con
    el coste total según IBKR (total × precio medio acumulado), no con una aproximación."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, _items(), "m")            # HIG 30% @100 → 3 acciones
    a = approvals_mod.pending(db)[0]

    fake = _FakeBroker()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)
    approvals_mod.approve(db, a.id)                               # queda working

    # 1º parcial: 1 acción a medio acumulado $99.00
    fake.poll_status = "partial"
    fake.filled_qty = Decimal("1")
    fake.fill_price = Decimal("99.00")
    approvals_mod.reconcile_working(db)
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("901.00")   # 1000 − 1×99

    # 2º: ejecutada entera; medio acumulado sube a $99.50 (las otras 2 entraron a $99.75)
    fake.poll_status = "filled"
    fake.filled_qty = Decimal("3")
    fake.fill_price = Decimal("99.50")
    approvals_mod.reconcile_working(db)

    a2 = db.get(Approval, a.id)
    assert a2.status == "executed"
    assert a2.fill_price == Decimal("99.50")                      # medio acumulado visible
    # Coste total registrado = 3 × 99.50 = 298.50 EXACTO → caja 1000 − 298.50
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("701.50")
    pos = ledger.open_positions(db, BOOK_REAL)
    assert len(pos) == 1 and pos[0].quantity == Decimal("3")


def test_filled_without_quantity_uses_requested(db, fixed_prices, monkeypatch) -> None:
    """IBKR responde 'filled' sin cantidad: se usa la cantidad SOLICITADA (requested_quantity),
    no cero (el bug habría registrado nada)."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, _items(), "m")
    a = approvals_mod.pending(db)[0]

    fake = _FakeBroker()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)
    approvals_mod.approve(db, a.id)                               # working, pidió 3

    fake.poll_status = "filled"
    fake.filled_qty = None                                        # IBKR no da cantidad
    fake.fill_price = Decimal("100")
    approvals_mod.reconcile_working(db)

    a2 = db.get(Approval, a.id)
    assert a2.status == "executed" and a2.quantity == Decimal("3.0000")
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("700.00")


def test_reconcile_un_fallo_no_deshace_fills_anteriores(db, fixed_prices, monkeypatch) -> None:
    """Dos órdenes working: la 1ª llena y el sondeo de la 2ª revienta. El fill de la 1ª debe
    quedar persistido ENTERO (estado incluido): el commit va por-aprobación, así el rollback
    del fallo de la 2ª no le revierte el estado a la 1ª (que mentiría 'working' un ciclo)."""
    items = [
        {"ticker": "HIG", "action": "comprar", "score": 85, "target_weight_pct": 30.0,
         "price": "100", "target_price": None, "upside_pct": None,
         "thesis": "t", "edge": "e", "risk": "r"},
        {"ticker": "CP", "action": "comprar", "score": 80, "target_weight_pct": 20.0,
         "price": "50", "target_price": None, "upside_pct": None,
         "thesis": "t", "edge": "e", "risk": "r"},
    ]
    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, items, "m")

    class _Fake(_FakeBroker):
        def __init__(self) -> None:
            super().__init__()
            self._orders = 0

        def place_order(self, ticker, side, quantity, order_ref=""):  # noqa: ANN001
            from app.brokers.base import BrokerResult
            self._orders += 1
            return BrokerResult(ok=True, fill_price=None, simulated=False, status="working",
                                order_id=f"OID{self._orders}", filled_quantity=None,
                                message="enviada")

        def poll_order(self, order_id):  # noqa: ANN001
            if order_id == "OID2":
                raise RuntimeError("IBKR no responde")
            from app.brokers.base import BrokerResult
            return BrokerResult(ok=True, fill_price=Decimal("100"), simulated=False,
                                status="filled", order_id=order_id,
                                filled_quantity=Decimal("3"), message="filled")

    fake = _Fake()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)
    a1, a2 = approvals_mod.pending(db)
    approvals_mod.approve(db, a1.id)                                 # HIG → OID1
    approvals_mod.approve(db, a2.id)                                 # CP → OID2
    assert db.get(Approval, a1.id).status == "working"
    assert db.get(Approval, a2.id).status == "working"

    assert approvals_mod.reconcile_working(db) == 1                  # solo la 1ª cambió

    ok = db.get(Approval, a1.id)
    assert ok.status == "executed" and ok.quantity == Decimal("3")   # persistida ENTERA
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("700.00")  # 1000 − 3×100
    assert db.get(Approval, a2.id).status == "working"               # la fallida sigue viva


def test_working_buy_reserves_cash(db, fixed_prices, monkeypatch) -> None:
    """Compra 'working' (orden límite viva en IBKR, sin fill) → su caja queda COMPROMETIDA:
    una segunda compra solo puede usar la caja libre. Sin esto: doble gasto."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)
    approvals_mod.create_from_items(db, _items(), "m")            # HIG 30% @100 → pide 3 ($300)
    a = approvals_mod.pending(db)[0]

    fake = _FakeBroker()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)
    approvals_mod.approve(db, a.id)                               # working: $300 comprometidos

    # Segunda compra de otro ticker al 100%: solo puede gastar 1000 − 300 = $700.
    db.add(Approval(ticker="CP", action="comprar", target_weight_pct=100.0))
    db.commit()
    b = approvals_mod.pending(db)[0]
    fake.place_status = "filled"                                  # esta llena al instante
    fake2_qty = approvals_mod.approve(db, b.id)
    assert fake2_qty.status in ("executed", "working")
    # CP a $50: sin reserva habrían salido 20 acc. ($1000); con reserva, 14 ($700).
    assert fake2_qty.requested_quantity == Decimal("14.0000")


def test_working_sell_blocks_double_sell(db, fixed_prices, monkeypatch) -> None:
    """Venta 'working' → las acciones quedan bloqueadas: una segunda venta del mismo ticker
    falla limpio. Sin esto: vender dos veces las mismas acciones (short accidental)."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)
    ledger.record_buy(db, "HIG", "4", "90", "R-REF", book=BOOK_REAL)
    db.add(Approval(ticker="HIG", action="vender", target_weight_pct=0.0))
    db.commit()
    a = approvals_mod.pending(db)[0]

    fake = _FakeBroker()
    monkeypatch.setattr(approvals_mod, "get_broker", lambda: fake)
    approvals_mod.approve(db, a.id)                               # venta working: 4 acc. bloqueadas

    db.add(Approval(ticker="HIG", action="vender", target_weight_pct=0.0))
    db.commit()
    b = approvals_mod.pending(db)[0]
    out = approvals_mod.approve(db, b.id)
    assert out.status == "failed"
    assert "venta en curso" in out.result_msg.lower()
    # El libro sigue intacto: 4 acciones, nada vendido dos veces.
    pos = ledger.open_positions(db, BOOK_REAL)
    assert len(pos) == 1 and pos[0].quantity == Decimal("4")


def test_agent_never_sells_personal_holdings(db, fixed_prices, monkeypatch) -> None:
    """La cuenta IBKR tiene acciones PERSONALES del usuario, pero el libro real del agente está
    vacío → una venta debe FALLAR limpio (el sizing solo ve el libro del agente, jamás IBKR)."""
    from app import approvals as approvals_mod

    ledger.allocate(db, 1000, book=BOOK_REAL)                     # capital sí, posición no
    db.add(Approval(ticker="HIG", action="vender", target_weight_pct=0.0))
    db.commit()
    a = approvals_mod.pending(db)[0]

    out = approvals_mod.approve(db, a.id)                         # dry-run broker da igual:
    assert out.status == "failed"                                 # el sizing corta ANTES
    assert "no hay posición" in out.result_msg.lower()
    assert ledger.open_positions(db, BOOK_REAL) == []             # nada vendido, nada tocado


def test_approve_sell_full_position(db, fixed_prices) -> None:
    ledger.allocate(db, 1000, book=BOOK_REAL)
    ledger.record_buy(db, "HIG", "4", "90", "R-REF", book=BOOK_REAL)
    db.add(Approval(ticker="HIG", action="vender", target_weight_pct=0.0))
    db.commit()
    a = approvals_mod.pending(db)[0]

    out = approvals_mod.approve(db, a.id)
    assert out.status == "executed", out.result_msg
    assert out.quantity == Decimal("4")                        # vende TODA la posición
    assert ledger.open_positions(db, BOOK_REAL) == []
    # caja: 1000 − 4×90 + 4×100 = 1040 exacto
    assert ledger.available_cash(db, BOOK_REAL) == Decimal("1040.00")
