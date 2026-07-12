"""Cadencia doble: la sombra se recalibra en cada escaneo; la sala real solo recibe
propuestas en el primer escaneo programado del mes (o en escaneos manuales)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_service,
    scheduler,
)
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_SHADOW, Approval, Proposal

_ET = ZoneInfo("America/New_York")


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class FakeLLM:
    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        return self._reply


_FAKE_REPLY = (
    '{"score": 90, "headline": "tesis", "report": "informe", "target_price": 150.0, '
    '"cash_pct": 0, "positions": [{"ticker": "AAA", "weight_pct": 100, '
    '"thesis": "t", "edge": "e", "risk": "r"}], "summary": "cartera concentrada", '
    '"regime": "neutral", "outlook": "estable", "favored_sectors": [], "avoided_sectors": []}'
)


def _stub_scan(monkeypatch) -> None:
    """El pipeline entero baratamente stubeado (mismo patrón que test_autoexec)."""
    from app import tracking
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod
    from app.screener import universe as universe_mod
    from app.screener.fundamentals import NameData

    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: FakeLLM(_FAKE_REPLY))
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["AAA"])
    monkeypatch.setattr(fund_mod, "gather", lambda t: NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ))
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": [], "avoided_sectors": [], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 100.0})
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)


def test_shadow_recalibration_scan_creates_no_approvals(db, monkeypatch) -> None:
    """real_proposals=False: la sombra se ejecuta sola IGUAL, pero la real no recibe nada."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    result = scan_service.run_scan_and_store(db, sample_size=5, real_proposals=False)

    assert result["real_proposals"] is False
    assert db.query(Approval).count() == 0                       # cero propuestas a la real
    assert db.query(Proposal).count() == 1                       # la propuesta persiste (sombra)
    pos = {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)}
    assert pos == {"AAA"}                                        # y la sombra se auto-ejecutó


def test_default_scan_still_creates_approvals(db, monkeypatch) -> None:
    """Sin argumento (escaneo manual / cadencia única): la real recibe sus propuestas."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    result = scan_service.run_scan_and_store(db, sample_size=5)

    assert result["real_proposals"] is True
    assert db.query(Approval).count() >= 1


def test_real_proposals_due_only_first_scheduled_week(monkeypatch) -> None:
    """El primer escaneo programado del mes cae siempre en día 1-7; el resto, no propone."""
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", True)
    assert scheduler.real_proposals_due(datetime(2026, 7, 7, 10, 15, tzinfo=_ET)) is True
    assert scheduler.real_proposals_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is False
    assert scheduler.real_proposals_due(datetime(2026, 7, 28, 10, 15, tzinfo=_ET)) is False

    # Cadencia única (flag apagado): todos los escaneos proponen.
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", False)
    assert scheduler.real_proposals_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is True
