"""Tests del libro de capital — aritmética exacta, guardarraíles, P&L y free-roll."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app.db import Base
from app.ledger import service
from app.ledger.service import InsufficientFunds, InsufficientShares


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_2000_to_400_walkthrough(db) -> None:
    # El ejemplo exacto que pediste: $2000 → 3 compras → sabe que le quedan $400.
    service.allocate(db, 2000)
    assert service.available_cash(db) == Decimal("2000.00")
    service.record_buy(db, "AAA", quantity=60, price=10, order_ref="AGENT-1")   # 600
    service.record_buy(db, "BBB", quantity=50, price=10, order_ref="AGENT-2")   # 500
    service.record_buy(db, "CCC", quantity=50, price=10, order_ref="AGENT-3")   # 500
    assert service.available_cash(db) == Decimal("400.00")


def test_cannot_spend_more_than_cash(db) -> None:
    service.allocate(db, 100)
    with pytest.raises(InsufficientFunds):
        service.record_buy(db, "AAA", quantity=10, price=20, order_ref="AGENT-x")  # 200 > 100


def test_buy_then_sell_realizes_pnl(db) -> None:
    service.allocate(db, 1000)
    service.record_buy(db, "AAA", quantity=10, price=50, order_ref="AGENT-1")   # cash 500
    sell = service.record_sell(db, "AAA", quantity=10, price=80, order_ref="AGENT-2")
    assert sell.realized_pnl == Decimal("300.00")            # 10*(80-50)
    assert service.available_cash(db) == Decimal("1300.00")  # 500 + 800
    assert service.open_positions(db) == []                  # posición cerrada


def test_free_roll(db) -> None:
    # Recupera el coste inicial vendiendo la mitad al doble → el resto corre a riesgo cero.
    service.allocate(db, 1000)
    service.record_buy(db, "AAA", quantity=10, price=50, order_ref="AGENT-1")   # coste 500
    service.record_sell(db, "AAA", quantity=5, price=100, order_ref="AGENT-2")  # recupera 500
    assert service.available_cash(db) == Decimal("1000.00")  # capital inicial recuperado
    pos = service.open_positions(db)
    assert len(pos) == 1 and pos[0].quantity == Decimal("5")  # 5 acciones "house money"


def test_cannot_sell_more_than_held(db) -> None:
    service.allocate(db, 1000)
    service.record_buy(db, "AAA", quantity=5, price=50, order_ref="AGENT-1")
    with pytest.raises(InsufficientShares):
        service.record_sell(db, "AAA", quantity=10, price=60, order_ref="AGENT-2")


def test_max_positions_guard(db) -> None:
    service.allocate(db, 10000)
    for i, tk in enumerate(["AAA", "BBB", "CCC"]):
        service.record_buy(db, tk, quantity=1, price=10, order_ref=f"AGENT-{i}")
    assert service.can_open_new(db, "DDD", max_positions=3) is False  # 4º nombre → no
    assert service.can_open_new(db, "AAA", max_positions=3) is True   # ampliar existente → sí


def test_snapshot_equity(db) -> None:
    service.allocate(db, 1000)
    service.record_buy(db, "AAA", quantity=10, price=50, order_ref="AGENT-1")  # cash 500
    snap = service.snapshot(db, price_lookup=lambda _t: Decimal("70"))
    assert snap.cash == Decimal("500.00")
    assert snap.positions_value == Decimal("700.00")   # 10 * 70
    assert snap.equity == Decimal("1200.00")


def test_cent_exact_five_weight_allocation(db) -> None:
    """El escenario EXACTO que falló: 5 pesos 25/25/20/15/15 sobre $2000 con precios que no
    dividen limpio. Con floor de acciones a 4 decimales NUNCA se sobrepasa la caja (el bug de
    JAZZ: 1.243·241.43=$300.10 > slice $300) y caja+invertido cuadra al céntimo."""
    service.allocate(db, 2000)   # sin live_prices inyectado, el sizing valora a coste (cero red)
    plan = [("RGA", "229.85", 25), ("SSRM", "28.795", 25), ("HIG", "138.16", 20),
            ("DXCM", "74.69", 15), ("JAZZ", "241.43", 15)]
    for tk, px, w in plan:
        qty, side = service.size_to_weight(db, models.BOOK_SHADOW, tk, "comprar", w, Decimal(px))
        assert side == "buy" and qty > 0
        service.record_buy(db, tk, qty, Decimal(px), order_ref="t", book=models.BOOK_SHADOW)

    assert len(service.open_positions(db, models.BOOK_SHADOW)) == 5     # las 5 entraron
    assert service.available_cash(db, models.BOOK_SHADOW) >= Decimal("0.00")  # nunca negativo
    snap = service.snapshot(db, book=models.BOOK_SHADOW)               # sin precio → a coste
    assert snap.cash + snap.positions_value == snap.equity            # cuadra exacto
    assert snap.equity == Decimal("2000.00")                          # dinero conservado


def test_size_to_weight_clamps_to_cash(db) -> None:
    """Comprar al 100% con un precio que no divide exacto: floor de acciones → coste ≤ caja,
    y reintentar una posición ya cubierta da error claro (idempotente)."""
    service.allocate(db, 100)
    qty, side = service.size_to_weight(db, models.BOOK_SHADOW, "AAA", "comprar", 100, Decimal("30.01"))
    service.record_buy(db, "AAA", qty, Decimal("30.01"), order_ref="t", book=models.BOOK_SHADOW)
    assert service.available_cash(db, models.BOOK_SHADOW) >= Decimal("0.00")
    with pytest.raises(InsufficientFunds):   # ya cubre el peso objetivo
        service.size_to_weight(db, models.BOOK_SHADOW, "AAA", "comprar", 100, Decimal("30.01"))
