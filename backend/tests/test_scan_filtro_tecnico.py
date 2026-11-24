import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from test_escaneo_trazas import _FAKE_REPLY, FakeLLM, _gather_stub, _stub_common

from app import scan_service
from app.agents.scorer import PrescoreResult
from app.db import Base
from app.models import ScanAudit, ScanRun


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _preparar(monkeypatch):
    _stub_common(monkeypatch, FakeLLM(_FAKE_REPLY), ["AAA", "MSFT"])
    _gather_stub(monkeypatch)
    monkeypatch.setattr(scan_service.settings, "scan_full_universe", True)
    monkeypatch.setattr(scan_service, "_prescore_llm",
                        lambda *a: scan_service.JevProvider(api_key="fake", stage="prescore"))
    monkeypatch.setattr(scan_service.deepseek_mod, "account_balance_usd", lambda *a: None)
    monkeypatch.setattr(scan_service.universe_mod, "tickers_elegibles",
                        lambda db: ["FUERA", "HUMA", "ASTS", "MSFT", "AAA"])
    notas = {"FUERA": 100, "HUMA": 99, "ASTS": 98, "MSFT": 95, "AAA": 90}
    monkeypatch.setattr(scan_service.scorer_mod, "prescore_one",
                        lambda llm, d, *a, **kw: PrescoreResult(
                            ticker=d.ticker, score=notas[d.ticker]))
    llamadas = []
    original = scan_service.portfolio.cartera_jev

    def cartera(filas, *args):
        llamadas.append([p.ticker for p, _ in filas])
        return original(filas, *args)

    monkeypatch.setattr(scan_service.portfolio, "cartera_jev", cartera)
    return llamadas


def test_decision_puntua_elegibles_y_la_cartera_solo_toma_los_tecnicos(db, monkeypatch):
    llamadas = _preparar(monkeypatch)
    result = scan_service.run_scan_and_store(db, decide=True)
    filas = {r.ticker: r for r in db.query(ScanAudit).all()}
    assert result["scanned"] == result["prescored"] == 5
    assert set(filas) == {"AAA", "MSFT", "HUMA", "ASTS", "FUERA"}
    assert {t for t, r in filas.items() if r.pasa_filtro_tecnico} == {"AAA", "MSFT"}
    assert filas["FUERA"].prescore == 100
    assert llamadas == [["MSFT", "AAA"]]
    assert [p["ticker"] for p in result["jev_cartera"]] == ["MSFT", "AAA"]
    assert not any(i.startswith("Jev puntuó") for i in db.query(ScanRun).one().issues)


@pytest.mark.parametrize("decide,sample_size", [(False, None), (False, 1), (True, 1)])
def test_observatorio_y_muestra_se_limitan_al_universo_liquido(db, monkeypatch, decide,
                                                               sample_size):
    _preparar(monkeypatch)
    result = scan_service.run_scan_and_store(db, decide=decide, sample_size=sample_size)
    filas = {r.ticker for r in db.query(ScanAudit).all()}
    assert filas <= {"AAA", "MSFT"}
    assert result["scanned"] == (2 if sample_size is None else 1)


def test_global_no_filtra_y_guarda_marca_nula(db, monkeypatch):
    llamadas = _preparar(monkeypatch)
    monkeypatch.setattr(scan_service.universe_global, "top_market_cap_usd",
                        lambda db, limite: [("FUERA", "FUERA"), ("MSFT", "MSFT"), ("AAA", "AAA")])
    monkeypatch.setattr(scan_service.universe_mod, "tickers_elegibles",
                        lambda db: pytest.fail("Global no consulta elegibles"))
    scan_service.run_scan_and_store(db, decide=False, modo_universo="global_topcap")
    filas = db.query(ScanAudit).all()
    assert len(filas) == 3 and all(r.pasa_filtro_tecnico is None for r in filas)
    assert llamadas == [["FUERA", "MSFT", "AAA"]]
    assert not any(i.startswith("Jev puntuó") for i in db.query(ScanRun).one().issues)
