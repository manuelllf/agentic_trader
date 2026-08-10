"""Tests del escaneo (scan_service): traza de auditoría, memoria fuera del prompt, reintento de
fallos del LLM, news_used congelado y ScanRun. LLM falso y DB en memoria (patrón de test_ranker.py
y test_autoexec.py) — nunca toca OpenRouter."""

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
from app.models import Proposal, ScanAudit, ScanRun, Score, Watchlist


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _scores_reply(user: str) -> str:
    """Respuesta de prescore POR LOTE: extrae los tickers numerados del prompt
    (`_prescore_batch_prompt`, líneas "N. TICKER ...") y les da nota fija. El prescore individual
    ya no se usa en el pipeline principal, solo el profundo/capa media/constructor siguen
    recibiendo `_FAKE_REPLY` tal cual."""
    tickers = re.findall(r"^\d+\.\s+(\S+)", user, re.MULTILINE)
    return json.dumps({"scores": [{"ticker": t, "score": 90.0} for t in tickers]})


class FakeLLM:
    """Una única respuesta JSON sirve a la vez de informe profundo, macro y construcción — cada
    consumidor solo lee las claves que le importan (`dict.get`). El prescore por lote se detecta
    por el SYSTEM prompt (única llamada que menciona "SEVERAL companies") y responde aparte."""

    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        if "SEVERAL companies" in system:
            return _scores_reply(user)
        return self._reply


class FlakyLLM:
    """Como FakeLLM, pero la PRIMERA llamada de toda su vida falla (JSON roto): simula el 429
    de transporte o el JSON cortado del 4-ago, indistinguibles a priori."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
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
    """Universo fijo, como si viniera de la foto del último cierre."""
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-07-27T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_common(monkeypatch, llm, symbols: list[str]) -> None:
    """El pipeline entero baratamente stubeado, salvo `fund_mod.gather` (lo pone cada test:
    algunos necesitan controlar `news` para comprobar el congelado)."""
    from app import tracking
    from app.screener import macro as macro_mod

    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: llm)
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)  # memoria fuera (embeddings)
    # Sin esto, los 4 tickers reales de `always_deep_tickers` (MSFT/HUMA/ASTS/BTC-USD, no
    # mockeados) se comen el `sample_size` diminuto de estos tests y el ticker que el test SÍ
    # controla desaparece de la muestra. Producción usa universos de miles, ahí no pasa.
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    _stub_universo(monkeypatch, symbols)
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm, db=None: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": ["Technology"], "avoided_sectors": ["Energy"], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: dict.fromkeys(tickers, 100.0))
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)


def _gather_stub(monkeypatch, sector: str = "Technology", news: list | None = None):
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None: (NameData(
        ticker=t, sector=sector, industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9,
        news=news if news is not None else [],
    ), None))


# ---- entry_lane + had_prior_thesis en la traza --------------------------------

def test_entry_lane_y_had_prior_thesis_en_la_traza(db, monkeypatch) -> None:
    """OLD entra por posición, WATCH por watchlist (con tesis previa) y NEW por el carril de
    mayores caps (sin tesis previa, porque ni está en cartera ni en watchlist)."""
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
    assert rows["WATCH"].entry_lane == "watchlist"
    assert rows["NEW"].entry_lane == "caps"   # top_caps=10 >= 3 nombres: los rescata a todos
    assert rows["WATCH"].had_prior_thesis is True     # tenía tesis previa en la watchlist
    assert rows["OLD"].had_prior_thesis is False       # en cartera pero SIN tesis guardada
    assert rows["NEW"].had_prior_thesis is False


# ---- news_used congelado -------------------------------------------------------

def test_news_used_se_congela(db, monkeypatch) -> None:
    """La copia persistida de las noticias que entraron al prompt no debe cambiar si alguien
    muta la lista original después (las noticias son un endpoint en vivo)."""
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


# ---- fallo del LLM: reintento y el nombre no se pierde -------------------------

def test_fallo_llm_se_reintenta_y_el_nombre_no_se_pierde(db, monkeypatch) -> None:
    """La primera llamada al LLM (del prescore de AAA) revienta; el reintento la salva y AAA
    llega al ranking profundo con normalidad."""
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
    """La lectura ordena por created_at descendente: conservar el histórico no rompe nada y
    permite ver después por qué el constructor dejó fuera a cada candidato."""
    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)

    db.add(Proposal(cash_target_pct=0.0, macro_summary="propuesta vieja", items=[]))
    db.commit()
    vieja_id = db.query(Proposal).one().id

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    props = db.query(Proposal).all()
    assert len(props) == 2                                   # la vieja sigue, más la nueva
    assert vieja_id in {p.id for p in props}
