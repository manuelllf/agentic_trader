"""Tests del escaneo de Jev: foto del escaneo, reintento de LLM, macro persistido y ScanRun.

Fake LLM, in-memory DB; never touches OpenRouter."""

from __future__ import annotations

import json
import re

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_llm_stage,
    scan_service,
)
from app.db import Base
from app.models import Foto, ScanAudit, ScanRun


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
    """Batch prescore detected by "SEVERAL companies" in SYSTEM prompt."""

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

    monkeypatch.setattr(universe_mod, "tickers_elegibles", lambda db: list(symbols))
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-07-27T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_common(monkeypatch, llm, symbols: list[str]) -> None:
    """Stub entire pipeline except fund_mod.gather (per-test control)."""
    from app import tracking
    from app.screener import macro as macro_mod

    monkeypatch.setattr(scan_llm_stage, "get_llm", lambda *a, **k: llm)
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    _stub_universo(monkeypatch, symbols)
    monkeypatch.setattr(macro_mod, "get_macro", lambda db=None: {
        "regime": "neutral", "vix": 15.0, "datos": "VIX 15.0.",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: dict.fromkeys(tickers, 100.0))
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


# ---- la foto del escaneo de decisión -------------------------------------------

def _gather_con_foto(monkeypatch, vistas: list) -> None:
    """Un gather que apunta con qué ventana y foto se le pidió cada nombre."""
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    def gather(t, db=None, hist=None, ttl_h=None, foto_id=None, **kw):
        vistas.append((t, ttl_h, foto_id))
        return NameData(ticker=t, sector="Technology", industry="Software", price=100.0,
                        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9,
                        news=[], foto_id=foto_id), None

    monkeypatch.setattr(fund_mod, "gather", gather)


def test_el_escaneo_de_decision_puntua_su_propia_foto_y_la_deja_apuntada(db, monkeypatch) -> None:
    _stub_common(monkeypatch, FakeLLM(_FAKE_REPLY), ["AAA", "BBB"])
    vistas: list = []
    _gather_con_foto(monkeypatch, vistas)

    scan_service.run_scan_and_store(db, decide=True)

    foto = db.query(Foto).one()
    assert (foto.estado, foto.pedidos, foto.capturados) == ("completa", 2, 2)
    assert {(ttl, fid) for _t, ttl, fid in vistas} == {(0, foto.id)}      # fresco y con su foto
    assert db.query(ScanRun).one().foto_id == foto.id


def test_el_escaneo_reutiliza_una_foto_completa_reciente_sin_descargar(db, monkeypatch) -> None:
    from datetime import UTC, datetime

    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    _stub_common(monkeypatch, FakeLLM(_FAKE_REPLY), ["AAA", "BBB"])
    foto = Foto(alcance="nasdaq", estado="completa", fin=datetime.now(UTC))
    db.add(foto)
    db.commit()
    for t in ("AAA", "BBB"):
        fund_mod.foto_guardar(db, t, NameData(ticker=t, sector="Technology", industry="Software",
                                              price=9.0, fundamentals_text="", technical_text=""),
                              foto_id=foto.id)
    vistas: list = []
    _gather_con_foto(monkeypatch, vistas)

    scan_service.run_scan_and_store(db, decide=True)

    assert vistas == []                                   # todo salió de la foto de antes
    assert db.query(Foto).count() == 1
    assert db.query(ScanRun).one().foto_id == foto.id


def test_sin_decision_o_con_muestra_el_escaneo_no_abre_foto(db, monkeypatch) -> None:
    _stub_common(monkeypatch, FakeLLM(_FAKE_REPLY), ["AAA", "BBB"])
    _gather_con_foto(monkeypatch, [])

    scan_service.run_scan_and_store(db, decide=False)
    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    assert db.query(Foto).count() == 0
    assert {r.foto_id for r in db.query(ScanRun).all()} == {None}


# ---- macro persistido ----------------------------------------------------------

def test_titulares_y_eventos_del_macro_se_persisten(db, monkeypatch) -> None:
    """Antes solo vivían en la caché de `Meta` (blob sin scan_run_id, podado con el tiempo) --
    ahora quedan colgados del `ScanRun` para poder comprobar qué vio el macro de verdad."""
    from app.models import ScanRunMacroHeadline
    from app.screener import macro as macro_mod

    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)
    monkeypatch.setattr(macro_mod, "get_macro", lambda db=None: {
        "regime": "neutral", "vix": 15.0, "datos": "VIX 15.0.",
        "macro_headlines": {"yfinance": ["Y1"], "gnews": ["G1", "G2"], "gdelt": []},
        "wiki_events_text": "eventos de la semana", "wiki_scheduled_text": "calendario del año",
    })

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).order_by(ScanRun.id.desc()).first()
    assert run.macro_wiki_events == "eventos de la semana"
    assert run.macro_wiki_scheduled == "calendario del año"
    titulares = db.query(ScanRunMacroHeadline).filter_by(scan_run_id=run.id).all()
    assert {(t.fuente, t.texto) for t in titulares} == {
        ("yfinance", "Y1"), ("gnews", "G1"), ("gnews", "G2"),
    }


# ---- fallo del LLM: reintento y el nombre no se pierde -------------------------

def test_fallo_llm_se_reintenta_y_el_nombre_no_se_pierde(db, monkeypatch) -> None:
    """La primera llamada al LLM falla; el reintento puntúa el nombre en vez de perderlo."""
    flaky = FlakyLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, flaky, ["AAA"])
    _gather_stub(monkeypatch)

    result = scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    assert flaky.calls >= 2               # hubo reintento
    assert result["prescored"] == 1       # AAA no se perdió
    row = db.query(ScanAudit).filter(ScanAudit.ticker == "AAA").one()
    assert row.stage != "prescore_error"


# ---- ScanRun: una fila por escaneo con el macro que vio ------------------------

def test_scan_run_registra_el_macro_sin_sectores(db, monkeypatch) -> None:
    from app.models import ScanRunSector

    llm = FakeLLM(_FAKE_REPLY)
    _stub_common(monkeypatch, llm, ["AAA"])
    _gather_stub(monkeypatch)

    scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    run = db.query(ScanRun).one()
    assert db.query(ScanRunSector).count() == 0          # el macro ya no inclina sectores
    assert run.outlook == "VIX 15.0."                   # guarda los datos, no una previsión
    assert run.regime == "neutral"
    assert run.decide is True
    assert "by_model" in run.cost
