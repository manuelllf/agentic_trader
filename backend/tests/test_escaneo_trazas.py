"""Tests del escaneo: traza de auditoría, reintento de LLM, news_used congelado, ScanRun.

Fake LLM, in-memory DB; never touches OpenRouter."""

from __future__ import annotations

import json
import re

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_service,
)
from app.db import Base
from app.ledger import service as ledger
from app.models import Proposal, ProposalItem, ScanAudit, ScanRun, ScanRunConstructionItem, Score, Watchlist


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _scores_reply(user: str) -> str:
    """Batch prescore reply: extracts numbered tickers and assigns fixed scores."""
    tickers = re.findall(r"^\d+\.\s+(\S+)", user, re.MULTILINE)
    return json.dumps({"scores": [{"ticker": t, "score": 90.0} for t in tickers]})


class FakeLLM:
    """One JSON response serves deep/macro/construction; each consumer reads its keys.

    Batch prescore detected by "SEVERAL companies" in SYSTEM prompt."""

    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        if "SEVERAL companies" in system:
            return _scores_reply(user)
        return self._reply


class FlakyLLM:
    """Like FakeLLM; first call fails (broken JSON) to simulate transport errors."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        self.calls += 1
        if self.calls == 1:
            return "esto no es json"
        if "SEVERAL companies" in system:
            return _scores_reply(user)
        return self._reply


_FAKE_REPLY = (
    '{"score": 90, "headline": "tesis", "report": "informe", "target_price": 150.0, '
    '"cash_pct": 0, "positions": [{"ticker": "AAA", "weight_pct": 100, '
    '"thesis": "t", "edge": "e", "risk": "r"}], "summary": "cartera concentrada", '
    '"regime": "neutral", "outlook": "estable", '
    '"favored_sectors": ["Technology"], "avoided_sectors": ["Energy"]}'
)


def _stub_universo(monkeypatch, symbols: list[str]) -> None:
    """Fixed universe from last-close snapshot."""
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-07-27T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_common(monkeypatch, llm, symbols: list[str]) -> None:
    """Stub entire pipeline except fund_mod.gather (per-test control)."""
    from app import tracking
    from app.screener import macro as macro_mod

    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: llm)
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    # Clear always_deep_tickers so test-controlled ticker doesn't vanish from sample.
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    _stub_universo(monkeypatch, symbols)
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm, db=None, **_kw: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": ["Technology"], "avoided_sectors": ["Energy"], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: dict.fromkeys(tickers, 100.0))
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)
    monkeypatch.setattr(scan_service.time, "sleep", lambda s: None)  # sin la pausa del reintento


def _gather_stub(monkeypatch, sector: str = "Technology", news: list | None = None,
                 high_52w: float | None = None):
    """Stub fundamentals.gather with fixed NameData."""
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, hist=None, **kw: (NameData(
        ticker=t, sector=sector, industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9,
        news=news if news is not None else [], high_52w=high_52w,
    ), None))


# ---- entry_lane en la traza ---------------------------------------------------

def test_entry_lane_en_la_traza(db, monkeypatch) -> None:
    """Entry lanes: OLD (position), NEW (top caps). La watchlist ya no es carril ni se escanea:
    WATCH no aparece en la traza aunque esté guardada en la tabla."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["NEW"])
    _gather_stub(monkeypatch)

    ledger.allocate(db, 1000)
    ledger.record_buy(db, "OLD", 5, 100, "seed")
    db.add(Watchlist(ticker="WATCH", score=90, thesis="tesis previa"))
    db.commit()

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    rows = {r.ticker: r for r in db.query(ScanAudit).all()}
    assert rows["OLD"].entry_lane == "posicion"
    assert rows["NEW"].entry_lane == "caps"   # top_caps=10 >= 3 nombres: los rescata a todos
    assert "WATCH" not in rows                 # guardada, pero ya no da acceso a nada


# ---- news_used congelado -------------------------------------------------------

def test_news_used_se_congela(db, monkeypatch) -> None:
    """Persisted news snapshot immutable after scan (news endpoint is live)."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    noticias = ["Titular uno", "Titular dos"]
    _gather_stub(monkeypatch, news=noticias)

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    row = db.query(Score).filter(Score.ticker == "AAA").one()
    assert row.news_used == ["Titular uno", "Titular dos"]

    noticias.append("Titular nuevo (mutado después del escaneo)")
    db.expire(row)
    assert row.news_used == ["Titular uno", "Titular dos"]     # sigue congelado


def test_news_used_tambien_se_congela_en_observatorio(db, monkeypatch) -> None:
    """Un escaneo observatorio (decide=False) es conocimiento y traza igual que uno decisivo:
    las noticias que entraron al prompt se congelan también ahí, no solo cuando decide cartera.
    Además, en un segundo observatorio se REFRESCAN (no se acumulan debajo de las viejas), porque
    la fila de Score se reutiliza en vez de recrearse."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])

    _gather_stub(monkeypatch, news=["Titular uno"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=True)   # crea la fila de Score

    _gather_stub(monkeypatch, news=["Titular del observatorio"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    row = db.query(Score).filter(Score.ticker == "AAA").one()
    assert row.news_used == ["Titular del observatorio"]   # refrescado, no acumulado

    _gather_stub(monkeypatch, news=["Titular más reciente"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    row = db.query(Score).filter(Score.ticker == "AAA").one()
    assert row.news_used == ["Titular más reciente"]       # el segundo observatorio pisa al primero


# ---- ScanRunFinalist: archivo que sobrevive al pisado de Score -----------------

def test_scan_run_finalist_guarda_informe_y_guardarrailes_completos(db, monkeypatch) -> None:
    """`ScanRunFinalist` (a diferencia de `Score`) es una fila nueva por escaneo, nunca se pisa:
    tiene que llevar el informe completo, las noticias y los 5 campos de guardarraíl."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch, news=["Titular uno", "Titular dos"])

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).order_by(ScanRun.id.desc()).first()
    finalist = next(f for f in run.finalists if f["ticker"] == "AAA")
    assert finalist["report"] == "informe"
    assert finalist["news_used"] == ["Titular uno", "Titular dos"]
    # Los 5 campos de guardarraíl viajan aunque en este caso no se disparen (valores por defecto).
    assert finalist["target_raw"] is None
    assert finalist["target_flagged"] is False
    assert finalist["target_consensus_mean"] is None
    assert finalist["target_echoed_consensus"] is False
    assert finalist["under_acquisition"] is None


def test_scan_run_finalist_sobrevive_al_pisado_de_score(db, monkeypatch) -> None:
    """Un segundo escaneo pisa `Score` (fila de trabajo) pero NO el `ScanRunFinalist` del
    primero — es el archivo de verdad de ESE escaneo concreto, no del ticker en general."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch, news=["Titular del primer escaneo"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=True)
    primer_run_id = db.query(ScanRun).order_by(ScanRun.id.desc()).first().id

    _gather_stub(monkeypatch, news=["Titular del segundo escaneo"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    row = db.query(Score).filter(Score.ticker == "AAA").one()
    assert row.news_used == ["Titular del segundo escaneo"]   # Score: pisada, como siempre

    primer_run = db.get(ScanRun, primer_run_id)
    finalist = next(f for f in primer_run.finalists if f["ticker"] == "AAA")
    assert finalist["news_used"] == ["Titular del primer escaneo"]   # intacto, no se movió


def test_mid_score_se_persiste_en_finalist_y_audit(db, monkeypatch) -> None:
    """Antes solo vivía dentro de `llm_call.content` (JSON crudo) — ahora es columna propia,
    mismo patrón que prescore/deep_score, en las dos tablas que ya las llevan."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).order_by(ScanRun.id.desc()).first()
    finalist = next(f for f in run.finalists if f["ticker"] == "AAA")
    assert finalist["mid_score"] == 90.0   # score de _FAKE_REPLY

    audit_row = db.query(ScanAudit).filter(ScanAudit.ticker == "AAA").one()
    assert audit_row.mid_score == 90.0


def test_high_52w_se_persiste_en_cartera_y_propuesta(db, monkeypatch) -> None:
    """`build_trades()` ya lo calculaba bien, pero `_guardar_trade_items()` lo dejaba fuera al
    escribir la fila (bug real, 28-ago: la web enseñaba dist. ATH vacía en todas las filas)."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch, high_52w=120.0)

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).order_by(ScanRun.id.desc()).first()
    item = db.query(ScanRunConstructionItem).filter_by(scan_run_id=run.id, ticker="AAA").one()
    assert item.high_52w == 120.0

    prop = db.query(Proposal).order_by(Proposal.id.desc()).first()
    prop_item = db.query(ProposalItem).filter_by(proposal_id=prop.id, ticker="AAA").one()
    assert prop_item.high_52w == 120.0


# ---- fallo del LLM: reintento y el nombre no se pierde -------------------------

def test_fallo_llm_se_reintenta_y_el_nombre_no_se_pierde(db, monkeypatch) -> None:
    """First LLM call fails; retry saves the ticker; reaches deep ranking."""
    flaky = FlakyLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, flaky, ["AAA"])
    _gather_stub(monkeypatch)

    result = scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    assert flaky.calls >= 2               # hubo reintento
    assert result["deep"] == 1            # AAA no se perdió
    row = db.query(ScanAudit).filter(ScanAudit.ticker == "AAA").one()
    assert row.stage != "prescore_error"
    assert db.query(Score).filter(Score.ticker == "AAA").count() == 1


# ---- ScanRun: una fila por escaneo con los sectores del macro ------------------

def test_scan_run_registra_sectores_favorecidos_y_evitados(db, monkeypatch) -> None:
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).one()
    assert run.favored_sectors == ["Technology"]
    assert run.avoided_sectors == ["Energy"]
    assert run.regime == "neutral"
    assert run.decide is True
    assert "by_model" in run.cost


# ---- una propuesta anterior sobrevive a un escaneo nuevo -----------------------

def test_propuesta_anterior_sobrevive_a_un_escaneo_nuevo(db, monkeypatch) -> None:
    """Prior proposal persists; read orders by created_at desc."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)

    db.add(Proposal(cash_target_pct=0.0, macro_summary="propuesta vieja"))
    db.commit()
    vieja_id = db.query(Proposal).one().id

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    props = db.query(Proposal).all()
    assert len(props) == 2                                   # la vieja sigue, más la nueva
    assert vieja_id in {p.id for p in props}
