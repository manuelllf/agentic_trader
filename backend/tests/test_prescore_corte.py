"""Corte del prescore individual (`scan_service._pre_uno`) cuando el proveedor está caído: una
racha de `_PRESCORE_CORTE_FALLOS` nombres seguidos con error aborta el escaneo en vez de agotar
los 2 reintentos de cada uno de los ~3.000 nombres del universo contra un proveedor que ya no
responde. Universo de 120 nombres (patrón de `_stub_escaneo` en test_estrategia_jev.py) — LLM
falso, sin red."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_llm_stage,
    scan_service,
)
from app.db import Base
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod
from app.screener.fundamentals import NameData

_N = 120
_TICKERS = [f"T{i}" for i in range(_N)]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class _SiempreFalla:
    """Prescore que siempre revienta el parseo: cada llamada cuenta como fallo."""

    def __init__(self) -> None:
        self.llamadas = 0

    def chat(self, system: str, user: str, *, temperature: float = 1.0,
            top_p: float | None = None) -> str:
        self.llamadas += 1
        return "esto no es JSON"


class _MitadFalla:
    """Uno de cada dos falla: nunca 50 SEGUIDOS, así que el corte no debe dispararse."""

    def __init__(self) -> None:
        self.llamadas = 0

    def chat(self, system: str, user: str, *, temperature: float = 1.0,
            top_p: float | None = None) -> str:
        self.llamadas += 1
        if self.llamadas % 2 == 0:
            return "esto no es JSON"
        return '{"score": 70}'


def _stub_universo(monkeypatch, prescore) -> None:
    from app.screener import universe as universe_mod

    def fake_get_llm(model: str | None = None, **kw):
        return prescore

    monkeypatch.setattr(scan_service, "get_llm", fake_get_llm)
    monkeypatch.setattr(scan_llm_stage, "get_llm", fake_get_llm)
    monkeypatch.setattr(scan_service.settings, "llm_provider", "deepseek")  # camino _pre_uno
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    # Pocos hilos a propósito: con más hilos que nombres, los 120 arrancarían casi a la vez y el
    # corte no tendría nada "aún sin arrancar" que ahorrarse -- así se fuerza la cola real.
    monkeypatch.setattr(scan_service, "_PRESCORE_WORKERS", 4)
    monkeypatch.setattr(scan_service.time, "sleep", lambda s: None)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(_TICKERS), {"fuente": "cierre", "at": "2026-09-23T20:30:00+00:00", "dias": 0,
                         "size": len(_TICKERS)}))
    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, **kw: (NameData(
        ticker=t, sector="Tech", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[]), None))
    monkeypatch.setattr(macro_mod, "get_macro", lambda db=None: {
        "regime": "neutral", "vix": 15.0, "datos": "VIX 15.0.",
        "wiki_events_text": "", "macro_headlines": {},
    })


def test_proveedor_caido_corta_el_prescore_y_no_agota_reintentos(db, monkeypatch) -> None:
    llm = _SiempreFalla()
    _stub_universo(monkeypatch, llm)

    with pytest.raises(RuntimeError, match="Prescore cortado"):
        scan_service.run_scan_and_store(db, decide=False)

    # Sin el corte, 120 nombres x hasta 3 intentos cada uno serían hasta 360 llamadas.
    # Con el corte a 50 fallos seguidos, se aborta muy por debajo de eso.
    assert llm.llamadas < 3 * _N


def test_fallos_intermitentes_no_disparan_el_corte(db, monkeypatch) -> None:
    llm = _MitadFalla()
    _stub_universo(monkeypatch, llm)

    result = scan_service.run_scan_and_store(db, decide=False)

    # No hubo abort: el escaneo llegó a producir un resultado normal.
    assert result is not None
    assert llm.llamadas > 0
