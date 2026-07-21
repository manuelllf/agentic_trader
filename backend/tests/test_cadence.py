"""Cadencia de decisión: el escaneo semanal es OBSERVATORIO (aprende sin tocar libros);
la cartera —sombra y propuestas a la real— solo se decide en el primer escaneo programado
del mes o en los escaneos manuales."""

from __future__ import annotations

import json
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


def test_observatory_scan_learns_without_touching_books(db, monkeypatch) -> None:
    """decide=False: refresca el conocimiento (ranking) pero NO inventa propuesta, NO toca la
    sombra y NO crea aprobaciones para la real."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    result = scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    assert result["decided"] is False
    assert db.query(models.Score).count() >= 1                   # el ranking SÍ se refrescó
    assert db.query(Proposal).count() == 0                       # sin propuesta nueva
    assert db.query(Approval).count() == 0                       # cero propuestas a la real
    assert ledger.open_positions(db, BOOK_SHADOW) == []          # la sombra ni se ejecutó


def test_observatory_scan_preserves_decided_portfolio(db, monkeypatch) -> None:
    """Un observatorio DESPUÉS de una decisión no pisa nada: la cartera sombra y la propuesta
    decidida sobreviven intactas (cada elección vive su mes)."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5)           # decisión: compra AAA
    pos_before = {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)}
    prop_id = db.query(Proposal).one().id
    assert pos_before == {"AAA"}

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    assert {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)} == pos_before
    assert db.query(Proposal).one().id == prop_id                # la propuesta decidida sigue


def test_default_scan_decides_both_books(db, monkeypatch) -> None:
    """Sin argumento (escaneo manual / cadencia única): ciclo completo — la sombra se ejecuta
    y la real recibe sus propuestas."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    result = scan_service.run_scan_and_store(db, sample_size=5)

    assert result["decided"] is True
    assert db.query(Approval).count() >= 1
    assert {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)} == {"AAA"}


def test_decision_due_only_first_scheduled_week(monkeypatch) -> None:
    """El primer escaneo programado del mes cae siempre en día 1-7; el resto, observatorio."""
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", True)
    assert scheduler.decision_due(datetime(2026, 7, 7, 10, 15, tzinfo=_ET)) is True
    assert scheduler.decision_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is False
    assert scheduler.decision_due(datetime(2026, 7, 28, 10, 15, tzinfo=_ET)) is False

    # Cadencia única (flag apagado): todos los escaneos deciden.
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", False)
    assert scheduler.decision_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is True


# ---- informe persistido del escaneo (panel de errores) -----------------------

def _last_report(db) -> dict:
    return json.loads(db.get(models.Meta, "last_scan_report").value)


def test_scan_writes_persistent_report(db, monkeypatch) -> None:
    """Cada escaneo (observatorio y decisión) deja su informe en Meta con modo, contadores y
    novedades; con el pipeline stubeado, cero incidencias."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    rep = _last_report(db)
    assert rep["mode"] == "observatorio" and rep["error"] is None
    assert rep["issues"] == [] and rep["deep"] == 1
    assert any("entran AAA" in c for c in rep["changes"])   # primer ranking: AAA es novedad

    scan_service.run_scan_and_store(db, sample_size=5)
    rep = _last_report(db)
    assert rep["mode"] == "decisión" and rep["error"] is None
    # la decisión compró AAA → sale de la watchlist ("lo que vigilo y no tengo")
    assert any("Watchlist" in c and "sale AAA" in c for c in rep["changes"])


def test_scan_report_records_issues(db, monkeypatch) -> None:
    """Un nombre sin datos de mercado queda anotado como incidencia (antes: solo en logs)."""
    from app.screener import fundamentals as fund_mod
    from app.screener import universe as universe_mod
    from app.screener.fundamentals import NameData

    _stub_scan(monkeypatch)
    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(fund_mod, "gather", lambda t: None if t == "BBB" else NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ))
    ledger.allocate(db, 1000)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert any("BBB" in i and "sin datos" in i for i in _last_report(db)["issues"])


def test_scan_report_registra_novedades_del_ranking(db, monkeypatch) -> None:
    """Entre dos escaneos, el informe dice qué ENTRA y qué SALE del ranking — el reemplazo
    de la tabla Score era mudo y las novedades invisibles."""
    from app import watchlist as watchlist_mod
    from app.screener import universe as universe_mod

    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)     # ranking = {AAA}
    watchlist_mod.drop(db, {"AAA"})          # fuera de vigilancia → el 2º escaneo no la arrastra

    monkeypatch.setattr(universe_mod, "build_universe", lambda: ["BBB"])
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)     # ranking = {BBB}

    texto = " ".join(_last_report(db)["changes"])
    assert "entran BBB" in texto and "salen AAA" in texto


def test_scan_failure_writes_report(db) -> None:
    """Si el escaneo revienta entero, el envoltorio deja el informe con el error — antes,
    un cron caído era invisible en la web (seguía enseñando datos viejos sin señal)."""
    scan_service.write_scan_failure(db, RuntimeError("boom"))
    rep = _last_report(db)
    assert rep["error"] == "boom" and rep["mode"] is None and rep["issues"] == []
