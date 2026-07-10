"""Tests del ranker fundamental (scorer, constructor, watchlist, muestreo) con LLM falso."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app import watchlist as wl
from app.agents import constructor as constructor_mod
from app.agents import scorer as scorer_mod
from app.db import Base
from app.models import Watchlist
from app.screener import universe as universe_mod
from app.screener.fundamentals import NameData


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


def _name(ticker: str = "AAA") -> NameData:
    return NameData(ticker=ticker, sector="Technology", industry="Software",
                    price=100.0, fundamentals_text="- P/E: 20", technical_text="RSI 55", news=[])


# ---- scorer ----

def test_scorer_parses_and_clamps() -> None:
    llm = FakeLLM('{"report": "informe", "headline": "tesis fuerte", "score": 88}')
    r = scorer_mod.score(llm, _name(), "macro n/d")
    assert r.score == 88 and r.headline == "tesis fuerte" and r.report == "informe"

    over = FakeLLM('{"report": "x", "headline": "y", "score": 150}')
    assert scorer_mod.score(over, _name(), "m").score == 100  # recorta a 100


def test_scorer_bad_json_is_zero() -> None:
    r = scorer_mod.score(FakeLLM("no soy json"), _name(), "m")
    assert r.score == 0  # queda fuera del embudo


# ---- constructor ----

def test_constructor_enforces_rules() -> None:
    reply = (
        '{"cash_pct": 0, "positions": ['
        '{"ticker": "AAA", "weight_pct": 60, "thesis": "t", "edge": "e", "risk": "r"},'  # >35 → 35
        '{"ticker": "BBB", "weight_pct": 30, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "CCC", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "DDD", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'
        '{"ticker": "EEE", "weight_pct": 20, "thesis": "t", "edge": "e", "risk": "r"},'  # 5ª → fuera (max 4)
        '{"ticker": "ZZZ", "weight_pct": 10, "thesis": "t", "edge": "e", "risk": "r"}'   # no puntuada → fuera
        '], "summary": "s"}'
    )
    valid = {"AAA", "BBB", "CCC", "DDD", "EEE"}  # ZZZ no está
    res = constructor_mod.construct(FakeLLM(reply), "cartera", "candidatos", "macro",
                                    max_positions=4, max_position_pct=35.0, valid_tickers=valid)
    assert len(res.positions) == 4                       # tope de 4
    assert all(p.weight_pct <= 35.0 for p in res.positions)  # tope 35%
    assert "ZZZ" not in {p.ticker for p in res.positions}    # anti-alucinación
    # 35+30+20+20 = 105 > 100 → renormaliza, cash 0.
    assert abs(sum(p.weight_pct for p in res.positions) - 100.0) < 0.1
    assert res.cash_pct == 0.0


def test_constructor_bad_json_all_cash() -> None:
    res = constructor_mod.construct(FakeLLM("nope"), "c", "c", "m", 4, 35.0, {"AAA"})
    assert res.positions == [] and res.cash_pct == 100.0


# ---- watchlist ----

def test_watchlist_entry_and_eviction(db) -> None:
    wl.update(db, [("AAA", 90, "alta conviccion"), ("BBB", 50, "flojo")])
    assert wl.tickers(db) == ["AAA"]                       # solo >=85 entra
    assert wl.thesis_for(db, "AAA") == "alta conviccion"

    wl.update(db, [("AAA", 65, "cayo")])                   # <70 → sale
    assert wl.tickers(db) == []


def test_watchlist_staleness(db) -> None:
    old = datetime.now(UTC) - timedelta(days=40)
    db.add(Watchlist(ticker="OLD", score=88, thesis="t", first_seen=old, last_seen=old, last_high=old))
    db.commit()
    wl.update(db, [("OLD", 80, "sigue ok")])  # 80: sobre evict pero bajo entry → last_high NO se refresca
    assert wl.tickers(db) == []               # caduca por antigüedad (>28d sin puntuar alto)


def test_watchlist_cap(db, monkeypatch) -> None:
    monkeypatch.setattr(wl.settings, "watchlist_max", 3)
    scored = [(f"T{i}", 85 + i, f"t{i}") for i in range(10)]  # 10 nombres >=85
    wl.update(db, scored)
    rows = db.scalars(select(Watchlist)).all()
    assert len(rows) == 3                                   # capado
    assert min(r.score for r in rows) == 92                # se quedan los de mayor score (94,93,92)


# ---- muestreo ----

def test_sample_includes_always_and_fills(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: [f"U{i}" for i in range(500)])
    sample = universe_mod.sample_for_scan(["HELD1", "HELD2"], n=50)
    assert sample[:2] == ["HELD1", "HELD2"]                 # posiciones/watchlist siempre primero
    assert len(sample) == 50
    assert len(set(sample)) == 50                           # sin duplicados


def test_sample_dedups_always(monkeypatch) -> None:
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["U1", "U2", "U3"])
    sample = universe_mod.sample_for_scan(["AAA", "aaa", "AAA"], n=3)
    assert sample.count("AAA") == 1


# ---- selección fiel al paper (top-N por score, desempate por market cap) ----

class _Row:
    def __init__(self, ticker: str, score: int) -> None:
        self.ticker, self.score = ticker, score


def test_select_top_n_by_score_then_marketcap() -> None:
    from app.service import _select
    rows = [_Row("A", 80), _Row("B", 90), _Row("C", 90), _Row("D", 70)]
    mcap = {"A": 5e9, "B": 3e9, "C": 8e9, "D": 20e9}
    sel = _select(rows, mcap, floor=0, n=2)
    # empate a 90 entre B y C → desempata market cap: C (8B) antes que B (3B)
    assert [r.ticker for r in sel] == ["C", "B"]


def test_select_respects_floor_when_set() -> None:
    from app.service import _select
    rows = [_Row("A", 80), _Row("B", 60)]
    assert [r.ticker for r in _select(rows, {}, floor=72, n=4)] == ["A"]   # B cae por el suelo
    assert [r.ticker for r in _select(rows, {}, floor=0, n=4)] == ["A", "B"]  # sin suelo, ambos


# ---- 100% invertido (water-filling con tope por posición) ----

def test_full_invest_sums_to_100_and_respects_cap() -> None:
    from app.service import _full_invest
    # el LLM da 50/30/20 pero el tope es 35 → clava el 50 y reparte
    w = _full_invest([50.0, 30.0, 20.0], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01           # 100% invertido
    assert all(x <= 35.0 + 1e-6 for x in w)     # ninguno pasa el tope
    assert w[0] == 35.0                          # el mayor queda clavado al tope


def test_full_invest_five_equal() -> None:
    from app.service import _full_invest
    w = _full_invest([1, 1, 1, 1, 1], cap=35.0)
    assert abs(sum(w) - 100.0) < 0.01 and all(abs(x - 20.0) < 0.01 for x in w)
