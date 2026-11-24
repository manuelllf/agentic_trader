"""Cadencia del escaneo: `decide=False` es OBSERVATORIO (la simulación manual) y el cron
programado (mensual único) siempre decide. Ninguno de los dos toca libros ni propuestas."""

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
    scan_state,
)
from app.db import Base


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _scores_reply(user: str) -> str:
    """Respuesta de prescore POR LOTE (ver mismo helper en test_escaneo_trazas.py)."""
    tickers = re.findall(r"^\d+\.\s+(\S+)", user, re.MULTILINE)
    return json.dumps({"scores": [{"ticker": t, "score": 90.0} for t in tickers]})


class FakeLLM:
    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        if "SEVERAL companies" in system:
            return _scores_reply(user)
        return self._reply


_FAKE_REPLY = '{"score": 90}'


def _stub_universo(monkeypatch, symbols: list[str]) -> None:
    """Universo fijo, como si viniera de la foto del último cierre."""
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "build_universe", lambda: list(symbols))
    monkeypatch.setattr(universe_mod, "tickers_elegibles", lambda db: list(symbols))
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-07-27T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_scan(monkeypatch) -> None:
    """El pipeline entero baratamente stubeado."""
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod
    from app.screener.fundamentals import NameData

    monkeypatch.setattr(scan_llm_stage, "get_llm", lambda *a, **k: FakeLLM(_FAKE_REPLY))
    monkeypatch.setattr(scan_service.time, "sleep", lambda s: None)  # sin la pausa del reintento
    _stub_universo(monkeypatch, ["AAA"])
    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, hist=None, **kw: (NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ), None))
    monkeypatch.setattr(macro_mod, "get_macro", lambda db=None: {
        "regime": "neutral", "vix": 15.0, "datos": "VIX 15.0.",
    })


# ---- informe persistido del escaneo (panel de errores) -----------------------

def _last_report(db) -> dict:
    return scan_state.informe(db)


def test_scan_writes_persistent_report(db, monkeypatch) -> None:
    """Cada escaneo (observatorio y decisión) deja su fila en `scan_runs` con su `decide`; con el
    pipeline stubeado, cero incidencias."""
    _stub_scan(monkeypatch)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    rep = _last_report(db)
    assert rep["mode"] == "jev" and rep["decide"] is False and rep["error"] is None
    assert rep["issues"] == [] and rep["prescored"] == 1

    scan_service.run_scan_and_store(db, sample_size=5)
    rep = _last_report(db)
    assert rep["mode"] == "jev" and rep["decide"] is True and rep["error"] is None


def test_scan_report_records_issues(db, monkeypatch) -> None:
    """Un nombre sin datos de mercado queda anotado como incidencia (antes: solo en logs)."""
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    _stub_scan(monkeypatch)
    _stub_universo(monkeypatch, ["AAA", "BBB"])
    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, hist=None, **kw: (None, "sin datos")
                        if t == "BBB" else (NameData(
                            ticker=t, sector="Technology", industry="Software", price=100.0,
                            fundamentals_text="- P/E: 20", technical_text="RSI 55",
                            market_cap=5e9, news=[],
                        ), None))

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert any("BBB" in i and "sin datos" in i for i in _last_report(db)["issues"])


# ---- universo: sin foto del cierre no se decide ------------------------------

def test_decision_se_aborta_sin_foto_del_universo(db, monkeypatch) -> None:
    """Con el mercado abierto, NASDAQ solo ha contado medio día de volumen y el universo sale
    recortado. Un observatorio así avisa y sigue; una DECISIÓN mensual se aborta: elegir la
    cartera del mes mirando una fracción del mercado no es una decisión, es un accidente."""
    from app.screener import universe as universe_mod

    _stub_scan(monkeypatch)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        ["AAA"], {"fuente": "vivo", "at": None, "dias": None, "size": 1}))

    with pytest.raises(RuntimeError, match="Decisión abortada"):
        scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)   # observatorio sí corre
    assert any("EN VIVO" in i for i in _last_report(db)["issues"])


def test_escaneo_se_aborta_con_universo_de_emergencia(db, monkeypatch) -> None:
    """40 nombres de SEED no son un mercado: mejor un fallo visible en el panel que un ranking
    con pinta de normal."""
    from app.screener import universe as universe_mod

    _stub_scan(monkeypatch)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        ["AAA"], {"fuente": "seed", "at": None, "dias": None, "size": 40}))

    with pytest.raises(RuntimeError, match="Sin universo"):
        scan_service.run_scan_and_store(db, sample_size=5, decide=False)


# ---- cursor rotatorio ----------------------------------------------------------

def test_cursor_rotatorio_no_avanza_si_el_escaneo_revienta(db, monkeypatch) -> None:
    """Avanzaba nada más construir la muestra: un escaneo que reventaba a mitad quemaba su
    franja del universo y esos nombres no volvían hasta la siguiente vuelta entera."""
    from app.screener import macro as macro_mod

    _stub_scan(monkeypatch)
    monkeypatch.setattr(macro_mod, "get_macro",
                        lambda db=None: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(RuntimeError):
        scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert scan_state._scan_cursor(db) == 0                  # la franja no se consumió

    _stub_scan(monkeypatch)                                    # el macro vuelve a funcionar
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert scan_state._scan_cursor(db) == 5                  # escaneo completo → sí avanza


def test_scan_failure_writes_report(db) -> None:
    """Si el escaneo revienta entero, el envoltorio deja el informe con el error — antes,
    un cron caído era invisible en la web (seguía enseñando datos viejos sin señal)."""
    scan_state.write_scan_failure(db, RuntimeError("boom"), decide=True)
    rep = _last_report(db)
    assert rep["error"] == "boom" and rep["mode"] == "decisión" and rep["issues"] == []
    # Sin cifras del embudo ni coste: a 0 parecerían medidas reales.
    assert rep["prescored"] is None and rep["cost"] is None and rep["universe"] is None


def test_informe_sin_jev_no_lleva_cartera(db, monkeypatch) -> None:
    """Relacional, no JSON: sin prescore de Jev no hay cartera ni filas hijas."""
    from app.models import ScanRunJevItem

    _stub_scan(monkeypatch)
    scan_service.run_scan_and_store(db, sample_size=5)
    rep = _last_report(db)
    assert rep["jev_cartera"] == [] and db.query(ScanRunJevItem).count() == 0
