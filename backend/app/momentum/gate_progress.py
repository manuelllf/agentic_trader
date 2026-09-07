"""Progreso EN VIVO del gate que esté corriendo ahora mismo -- mismo patrón que
`app/scan_progress.py`: dict en memoria, un solo proceso, se resetea al reiniciar.
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime

_lock = threading.Lock()
_state: dict = {
    "status": "idle",   # idle | running | done | error
    "total": 0,
    "hecho": 0,
    "ok": 0,
    "fail": 0,
    "ticker_actual": None,
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def iniciar(total: int) -> None:
    with _lock:
        _state.update(status="running", total=total, hecho=0, ok=0, fail=0,
                      ticker_actual=None, started_at=datetime.now(UTC).isoformat(),
                      finished_at=None, error=None)


def marca_ticker(ticker: str) -> None:
    with _lock:
        _state["ticker_actual"] = ticker


def tick(ok: bool) -> None:
    with _lock:
        _state["hecho"] += 1
        _state["ok" if ok else "fail"] += 1


def terminar(error: str | None = None) -> None:
    with _lock:
        _state.update(status="error" if error else "done", ticker_actual=None,
                      finished_at=datetime.now(UTC).isoformat(), error=error)


def snapshot() -> dict:
    with _lock:
        return dict(_state)
