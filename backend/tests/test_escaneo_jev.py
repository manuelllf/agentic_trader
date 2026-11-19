"""El escaneo solo de Jev: las notas de todo el universo y la cartera de Lambda, nada de Alpha."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from test_escaneo_trazas import _FAKE_REPLY, FakeLLM, _gather_stub, _stub_common

from app import scan_service
from app.agents.scorer import PrescoreResult
from app.db import Base
from app.models import (
    Proposal,
    ScanAudit,
    ScanRun,
    ScanRunJevItem,
    ScanRunTiming,
    Score,
    Trade,
    Watchlist,
)

SIMBOLOS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]
NOTAS = {"AAA": 95, "BBB": 90, "CCC": 85, "DDD": 80, "EEE": 75, "FFF": 70}
DIMENSIONES = {"fundamentals": [8.0, 0.9], "valuation": [7.0, 0.8],
               "financing": [6.0, 0.7], "catalyst": [5.0, 0.6]}


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _no_debe_llamarse(nombre: str):
    def _falla(*a, **k):
        pytest.fail(f"El escaneo solo de Jev no debe llamar a {nombre}")
    return _falla


@pytest.fixture
def jev(monkeypatch):
    """Todo el escaneo simulado: Jev da las notas y cualquier cosa de Alpha hace fallar la prueba."""

    _stub_common(monkeypatch, FakeLLM(_FAKE_REPLY), SIMBOLOS)
    _gather_stub(monkeypatch)
    s = scan_service
    monkeypatch.setattr(s.settings, "scan_full_universe", True)
    monkeypatch.setattr(s.settings, "always_deep_tickers", ["BTC-USD"])   # de Alpha: no entra
    monkeypatch.setattr(s.settings, "mid_layer", True)                    # apagada en este modo
    monkeypatch.setattr(s.settings, "jev_portfolio_n", 3)
    monkeypatch.setattr(s.settings, "jev_max_por_industria", 3)
    monkeypatch.setattr(s, "_prescore_llm",
                        lambda *a: s.JevProvider(api_key="fake", stage="prescore"))
    monkeypatch.setattr(s.deepseek_mod, "account_balance_usd", lambda *a: None)
    monkeypatch.setattr(s.universe_mod, "tickers_elegibles", lambda db: list(SIMBOLOS))
    monkeypatch.setattr(s.scorer_mod, "prescore_one",
                        lambda llm, d, *a, **kw: PrescoreResult(
                            ticker=d.ticker, score=NOTAS[d.ticker], confidence=0.9,
                            dimensiones=DIMENSIONES))
    return s


def test_guarda_las_notas_de_todo_el_universo_y_la_cartera_de_lambda(db, jev) -> None:
    result = jev.run_scan_and_store(db, decide=True, solo_jev=True)

    assert result["scanned"] == result["prescored"] == 6
    assert result["scanned"] >= result["prescored"] >= 0
    assert [p["ticker"] for p in result["jev_cartera"]] == ["AAA", "BBB", "CCC"]
    assert {r.ticker: r.jev_fundamentals for r in db.query(ScanAudit).all()} == dict.fromkeys(
        SIMBOLOS, 800)
    run = db.query(ScanRun).one()
    assert run.decide is True and run.cadence == "jev/full"
    assert (run.counter_scanned, run.counter_prescored, run.counter_deep) == (6, 6, 0)
    assert [(i.ticker, i.weight_pct) for i in
            db.query(ScanRunJevItem).order_by(ScanRunJevItem.posicion)] == [
        ("AAA", 33.33), ("BBB", 33.33), ("CCC", 33.33)]
    assert db.query(ScanAudit).filter(ScanAudit.reached_deep.is_(True)).count() == 0


def test_no_puntua_los_garantizados_de_alpha_ni_mira_su_libro(db, jev) -> None:
    jev.run_scan_and_store(db, decide=True, solo_jev=True)
    assert "BTC-USD" not in {r.ticker for r in db.query(ScanAudit).all()}


def test_no_toca_el_ranking_ni_la_watchlist_ni_crea_propuesta(db, jev) -> None:
    db.add(Score(ticker="VIEJA", sector="Technology", score=80, headline="h", report="r",
                 price=1.0, market_cap=1.0))
    db.add(Watchlist(ticker="VIGILADA", score=70))
    db.commit()
    result = jev.run_scan_and_store(db, decide=True, solo_jev=True)
    assert [s.ticker for s in db.query(Score).all()] == ["VIEJA"]
    assert [w.ticker for w in db.query(Watchlist).all()] == ["VIGILADA"]
    assert db.query(Proposal).count() == 0 and db.query(Trade).count() == 0
    assert "proposed" not in result
    assert "Escaneo de Jev" in db.query(ScanRun).one().construction_summary


def test_sin_capa_media_aunque_el_interruptor_este_encendido(db, jev, monkeypatch) -> None:
    monkeypatch.setattr(jev.scan_config, "mid_layer_activa", lambda db: True)
    jev.run_scan_and_store(db, decide=True, solo_jev=True)
    assert db.query(ScanAudit).filter(ScanAudit.mid_score.isnot(None)).count() == 0
    fases = {t.fase for t in db.query(ScanRunTiming)}
    assert {"gather", "macro", "prescore", "total"} <= fases
    assert not fases & {"mid", "deep", "constructor"}


def test_designa_la_foto_de_la_liga_como_cualquier_escaneo_de_decision(db, jev, monkeypatch) -> None:
    from app.liga.procesos import foto as liga_foto

    designados: list[int] = []
    monkeypatch.setattr(liga_foto, "auto_desde_escaneo", designados.append)
    jev.run_scan_and_store(db, decide=True, solo_jev=True)
    assert designados == [db.query(ScanRun).one().id]


def test_una_prueba_sin_decision_no_designa_nada(db, jev, monkeypatch) -> None:
    from app.liga.procesos import foto as liga_foto

    monkeypatch.setattr(liga_foto, "auto_desde_escaneo", _no_debe_llamarse("la designación"))
    jev.run_scan_and_store(db, decide=False, solo_jev=True)
    run = db.query(ScanRun).one()
    assert run.decide is False and run.cadence == "jev/full"
    assert db.query(ScanRunJevItem).count() == 3


def test_el_informe_dice_que_es_de_jev_y_si_es_el_oficial(db, jev) -> None:
    from app import scan_state

    jev.run_scan_and_store(db, decide=True, solo_jev=True)
    informe = scan_state.informe(db)
    assert informe["mode"] == "jev" and informe["decide"] is True
    assert [p["ticker"] for p in informe["jev_cartera"]] == ["AAA", "BBB", "CCC"]


def test_predice_la_nota_usa_el_prescore_de_una_muestra_sin_profundo(db, jev, monkeypatch) -> None:
    from datetime import date, timedelta

    from app import scan_outcomes

    jev.run_scan_and_store(db, decide=True, solo_jev=True)
    hoy = date.today()
    series = {t: [(hoy - timedelta(days=3), 100.0), (hoy, 100.0 + i)]
              for i, t in enumerate([*SIMBOLOS, "SPY"])}
    monkeypatch.setattr(scan_outcomes, "_cierres_ajustados", lambda tickers, desde: series)
    escaneo = scan_outcomes.outcomes(db)[0]
    assert escaneo["tipo"] == "jev" and escaneo["mode"] == "decisión"
    pares = {p["ticker"]: p for p in escaneo["pairs"]}
    assert {t: p["score"] for t, p in pares.items()} == NOTAS
    assert {t for t, p in pares.items() if p["funded"]} == {"AAA", "BBB", "CCC"}   # la de Lambda
    assert escaneo["groups"]["jev"]["n"] == 3
    assert escaneo["groups"]["cartera"]["n"] == 0


def test_la_muestra_de_notas_cubre_toda_la_escala(db, monkeypatch) -> None:
    from datetime import datetime

    from app import scan_outcomes

    at = datetime(2026, 11, 30, 21, 45)
    db.add_all(ScanAudit(scan_at=at, ticker=f"T{i:04d}", prescore=float(i % 100), price=10.0,
                         stage="prescore") for i in range(1000))
    db.commit()
    muestra = scan_outcomes._muestra_de_notas(db, at)
    assert len(muestra) == scan_outcomes.MUESTRA_NOTAS
    notas = [r.prescore for r in muestra]
    assert notas == sorted(notas, reverse=True) and notas[0] == 99.0 and notas[-1] <= 1.0


def test_el_trabajo_mensual_pide_solo_jev(db, monkeypatch) -> None:
    from app import proceso_hijo, scheduler

    pedidos: list[dict] = []
    monkeypatch.setattr(scheduler, "SessionLocal", lambda: db)
    monkeypatch.setattr(proceso_hijo, "ejecutar",
                        lambda tarea, args, **kw: pedidos.append(args) or {})
    scheduler._scan_job()
    assert pedidos and pedidos[0]["solo_jev"] is True and pedidos[0]["decide"] is True
    assert pedidos[0]["sample_size"] is None
