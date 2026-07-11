"""Tests de la auto-ejecución del libro sombra tras el escaneo (sin botones).

Dos niveles:
- Unitario: `execute_proposal_all` ordena ventas antes que compras y es idempotente.
- Integración: `run_scan_and_store` con el pipeline entero baratamente stubeado (FakeLLM +
  universo/fundamentales de mentira, igual que el resto de tests del ranker) — comprueba que,
  tras el escaneo, el libro sombra YA queda ejecutado solo, sin pulsar nada.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app import service
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_SHADOW, Proposal, Trade


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class FakeLLM:
    """Una única respuesta JSON que sirve a la vez de prescore, informe profundo, macro outlook
    y construcción — cada consumidor solo lee las claves que le importan (`dict.get`)."""

    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        return self._reply


# ---- unitario: orden y no-op --------------------------------------------------

def _seed_proposal(db, items: list[dict]) -> None:
    db.add(Proposal(cash_target_pct=0.0, macro_summary="m", items=items))
    db.commit()


def test_execute_proposal_all_sells_before_buys(db, monkeypatch) -> None:
    """Una compra que necesita la caja que libera una venta de LA MISMA propuesta debe completarse:
    si las compras se intentaran antes, fallaría por falta de caja (justo el bug que se corrige)."""
    from app import tracking

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"OLD": 100.0, "NEW": 100.0})
    ledger.allocate(db, 1000)
    ledger.record_buy(db, "OLD", 10, 50, "seed")  # coste 500 → caja libre 500

    # La propuesta pide vender TODO OLD y comprar NEW al 100% (equity, con OLD ya vendido, es
    # 1500 → NEW necesita 1500, que solo caben si la venta de OLD corre ANTES).
    _seed_proposal(db, [
        {"ticker": "NEW", "action": "comprar", "score": 90, "target_weight_pct": 100.0,
         "price": "100", "target_price": None, "upside_pct": None,
         "thesis": "", "edge": "", "risk": ""},
        {"ticker": "OLD", "action": "vender", "score": 80, "target_weight_pct": 0.0,
         "price": "100", "target_price": None, "upside_pct": None,
         "thesis": "", "edge": "", "risk": ""},
    ])

    res = service.execute_proposal_all(db)
    assert res["skipped"] == [], res["skipped"]         # nada se saltó: la venta abrió paso
    assert len(res["executed"]) == 2

    pos = {p.ticker: p for p in ledger.open_positions(db, BOOK_SHADOW)}
    assert set(pos) == {"NEW"}
    assert pos["NEW"].quantity == Decimal("15.0000")     # 1500 / 100
    assert ledger.available_cash(db, BOOK_SHADOW) == Decimal("0.00")  # sin céntimos sueltos

    # La venta quedó registrada ANTES que la compra (orden explícito, no el de la propuesta).
    # order_ref filtra el trade semilla (la compra inicial de OLD, previa a la propuesta).
    trades = db.query(Trade).filter(Trade.order_ref.like("shadow-prop%")).order_by(Trade.id).all()
    sides = [t.side for t in trades]
    assert sides == ["sell", "buy"]


def test_execute_proposal_all_rerun_is_noop(db, monkeypatch) -> None:
    """Reintentar sobre un libro que ya está al objetivo no debe mover un céntimo (idempotente)."""
    from app import tracking

    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 100.0})
    ledger.allocate(db, 1000)
    _seed_proposal(db, [
        {"ticker": "AAA", "action": "comprar", "score": 90, "target_weight_pct": 100.0,
         "price": "100", "target_price": None, "upside_pct": None,
         "thesis": "", "edge": "", "risk": ""},
    ])

    first = service.execute_proposal_all(db)
    assert len(first["executed"]) == 1 and first["skipped"] == []
    cash_after = ledger.available_cash(db, BOOK_SHADOW)
    positions_after = [(p.ticker, p.quantity) for p in ledger.open_positions(db, BOOK_SHADOW)]

    second = service.execute_proposal_all(db)
    assert second["executed"] == []                      # nada que ejecutar de nuevo
    assert len(second["skipped"]) == 1                    # AAA: "ya cubre el peso objetivo"
    assert ledger.available_cash(db, BOOK_SHADOW) == cash_after
    assert [(p.ticker, p.quantity) for p in ledger.open_positions(db, BOOK_SHADOW)] == positions_after


def test_execute_proposal_all_skips_mantener(db) -> None:
    _seed_proposal(db, [
        {"ticker": "AAA", "action": "mantener", "score": 90, "target_weight_pct": 50.0,
         "price": "100", "target_price": None, "upside_pct": None,
         "thesis": "", "edge": "", "risk": ""},
    ])
    res = service.execute_proposal_all(db)
    assert res == {"ok": True, "executed": [], "skipped": [],
                   "message": "0 ejecutada(s), 0 saltada(s)."}


# ---- integración: el escaneo entero deja el libro sombra ya ejecutado --------

_FAKE_REPLY = (
    '{"score": 90, "headline": "tesis", "report": "informe", "target_price": 150.0, '
    '"cash_pct": 0, "positions": [{"ticker": "AAA", "weight_pct": 100, '
    '"thesis": "t", "edge": "e", "risk": "r"}], "summary": "cartera concentrada", '
    '"regime": "neutral", "outlook": "estable", "favored_sectors": [], "avoided_sectors": []}'
)


def test_scan_auto_executes_shadow_book_sells_first(db, monkeypatch) -> None:
    """Escenario completo: había una posición vieja (OLD) que el escaneo nuevo NO selecciona
    (pasa a 'vender') y una nueva (AAA) que sí (pasa a 'comprar' al 100%). Sin ejecutar nada a
    mano, al terminar `run_scan_and_store` el libro sombra ya refleja la propuesta — y la compra
    de AAA (que necesita la caja liberada por la venta de OLD) no falla."""
    from app import tracking
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod
    from app.screener import universe as universe_mod
    from app.screener.fundamentals import NameData

    fake_llm = FakeLLM(_FAKE_REPLY)
    monkeypatch.setattr(service, "get_llm", lambda *a, **k: fake_llm)
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["AAA"])
    monkeypatch.setattr(fund_mod, "gather", lambda t: NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ))
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": [], "avoided_sectors": [], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"OLD": 100.0, "AAA": 100.0})
    # Sin caja/tope artificial: 1 sola posición al 100%, para que el resultado sea determinista.
    monkeypatch.setattr(service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(service.settings, "min_positions", 1)

    ledger.allocate(db, 1000)
    ledger.record_buy(db, "OLD", 10, 50, "seed")   # coste 500 → caja libre 500, equity vivo 1500

    result = service.run_scan_and_store(db, sample_size=5)
    assert result["positions"] == 1                # la cartera objetivo: solo AAA

    pos = {p.ticker: p for p in ledger.open_positions(db, BOOK_SHADOW)}
    assert set(pos) == {"AAA"}                      # OLD se vendió sola, AAA se compró sola
    assert pos["AAA"].quantity == Decimal("15.0000")  # 1500 (equity con OLD a 100) / 100
    assert ledger.available_cash(db, BOOK_SHADOW) == Decimal("0.00")

    # order_ref filtra el trade semilla (la compra inicial de OLD, previa al escaneo).
    trades = (db.query(Trade).filter(Trade.book == BOOK_SHADOW, Trade.order_ref.like("shadow-prop%"))
              .order_by(Trade.id).all())
    sides = [t.side for t in trades]
    assert sides == ["sell", "buy"]  # la venta de OLD corrió ANTES que la compra de AAA

    # Re-lanzar la ejecución sobre la MISMA propuesta no mueve nada más (idempotente).
    again = service.execute_proposal_all(db)
    assert again["executed"] == []
    assert ledger.available_cash(db, BOOK_SHADOW) == Decimal("0.00")
    assert [(p.ticker, p.quantity) for p in ledger.open_positions(db, BOOK_SHADOW)] == \
        [("AAA", Decimal("15.0000"))]


def test_scan_failure_in_autoexec_never_fails_the_scan(db, monkeypatch) -> None:
    """Un fallo en la auto-ejecución (p. ej. el libro sombra revienta) no debe tirar el escaneo:
    los scores/propuesta ya persistidos siguen ahí."""
    from app import tracking
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod
    from app.screener import universe as universe_mod
    from app.screener.fundamentals import NameData
    from app.models import Score

    fake_llm = FakeLLM(_FAKE_REPLY)
    monkeypatch.setattr(service, "get_llm", lambda *a, **k: fake_llm)
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

    def _boom(_db):
        raise RuntimeError("libro sombra roto")

    monkeypatch.setattr(service, "execute_proposal_all", _boom)

    result = service.run_scan_and_store(db, sample_size=5)  # no debe lanzar
    assert result["positions"] == 1
    assert db.query(Proposal).count() == 1
    assert db.query(Score).count() >= 1
