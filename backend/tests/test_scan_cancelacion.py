"""Cancelación del escaneo: hasta ahora los puntos de control (`_revisar_cancelado`) solo
vivían ENTRE etapas (antes de macro/prescore/mid/deep) -- el gather (la etapa más larga sobre
el universo entero) no miraba `cancel_event` en ningún punto de su propio bucle, así que
"Detener escaneo" no hacía nada visible hasta que el gather completo (miles de tickers) o su
cooldown de reintento (hasta 180s) terminaban solos."""

from __future__ import annotations

import threading

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models  # noqa: F401  (registra las tablas)
from app import scan_llm_stage, scan_service
from app.db import Base
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class _LLMNuncaLlamado:
    """Si el gather se cancela de verdad, ninguna etapa posterior (macro/prescore) debería
    llegar a pedirle nada a esto."""

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        raise AssertionError("no debería llamarse al LLM tras cancelar durante el gather")


def _stub_universo(monkeypatch, symbols: list[str]) -> None:
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-09-17T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_comun(monkeypatch, symbols: list[str]) -> None:
    llm = _LLMNuncaLlamado()
    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: llm)
    monkeypatch.setattr(scan_llm_stage, "get_llm", lambda *a, **k: llm)
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    _stub_universo(monkeypatch, symbols)


def test_cancelacion_durante_el_gather_corta_antes_de_terminar(db, monkeypatch) -> None:
    """Cancelar a mitad del gather debe abortar el escaneo SIN esperar a que termine de
    procesar el universo entero -- antes de este fix, el `cancel_event` se marcaba pero el
    bucle de `_run_gather` lo ignoraba hasta el final."""
    tickers = [f"T{i}" for i in range(30)]
    _stub_comun(monkeypatch, tickers)

    cancel_event = threading.Event()
    llamadas: list[str] = []

    def _tick_falso(ok: bool, reason: str | None = None) -> None:
        llamadas.append(reason or "ok")
        if len(llamadas) == 5:
            cancel_event.set()

    monkeypatch.setattr(scan_service.scan_progress, "tick", _tick_falso)

    from app.screener import fundamentals as fund_mod

    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, hist=None, **kw: (
        NameData(ticker=t, sector="Technology", industry="Software", price=100.0,
                fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[]),
        None,
    ))

    with pytest.raises(scan_service.ScanCancelado):
        scan_service.run_scan_and_store(db, sample_size=len(tickers), decide=True,
                                        cancel_event=cancel_event)

    # Se cortó tras el 5º tick, no tras procesar los 30 tickers del universo.
    assert len(llamadas) < len(tickers)


def test_dormir_cancelable_no_espera_los_segundos_enteros_si_ya_estaba_pedida(monkeypatch) -> None:
    """El cooldown de `gather_retry` puede ser de hasta 180s -- con el evento YA marcado antes
    de empezar, `_dormir_cancelable` tiene que cortar en el primer chequeo, no dormir la espera
    entera (antes era un `time.sleep(espera)` de una sola pieza, sordo a la cancelación)."""
    cancel_event = threading.Event()
    cancel_event.set()

    with pytest.raises(scan_service.ScanCancelado):
        scan_service._dormir_cancelable(180.0, cancel_event)


def test_dormir_cancelable_duerme_normal_sin_cancelacion(monkeypatch) -> None:
    """Sin cancelación de por medio, sigue durmiendo lo pedido en total (comportamiento de
    `time.sleep` intacto para el caso normal, sin `cancel_event`) -- reloj falso porque el
    sleep está troceado en pasos de 1s como mucho."""
    reloj = {"ahora": 0.0}
    dormido: list[float] = []

    def _sleep_falso(s: float) -> None:
        dormido.append(s)
        reloj["ahora"] += s

    monkeypatch.setattr(scan_service.time, "monotonic", lambda: reloj["ahora"])
    monkeypatch.setattr(scan_service.time, "sleep", _sleep_falso)

    scan_service._dormir_cancelable(2.5, None)

    assert sum(dormido) == pytest.approx(2.5)
