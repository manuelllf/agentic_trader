"""Progreso EN VIVO del escaneo diario de momentum que esté corriendo ahora mismo -- mismo
patrón que `gate_progress.py`: dict en memoria, un solo proceso, se resetea al reiniciar.
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime

_lock = threading.Lock()
_state: dict = {
    "status": "idle",   # idle | running | done | error
    "total": 0,
    "hecho": 0,
    "ticker_actual": None,
    "started_at": None,
    "finished_at": None,
    "nuevas": 0,
    "resueltas": 0,
    "error": None,
}


def iniciar(total: int) -> None:
    with _lock:
        _state.update(status="running", total=total, hecho=0, ticker_actual=None,
                      started_at=datetime.now(UTC).isoformat(), finished_at=None,
                      nuevas=0, resueltas=0, error=None)


def avance(hecho: int, ticker: str) -> None:
    with _lock:
        _state["hecho"] = hecho
        _state["ticker_actual"] = ticker


def terminar(nuevas: int = 0, resueltas: int = 0, error: str | None = None) -> None:
    with _lock:
        _state.update(status="error" if error else "done", ticker_actual=None,
                      finished_at=datetime.now(UTC).isoformat(), nuevas=nuevas,
                      resueltas=resueltas, error=error)


def snapshot() -> dict:
    with _lock:
        return dict(_state)
