"""Runner del escaneo en segundo plano.

El escaneo (pre-score Flash del universo entero + informe V4-Pro en los finalistas) tarda
~15 min → se ejecuta en un hilo aparte y la web consulta el estado. El propio servicio borra
scores/propuesta previos y persiste la foto nueva.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime

from app.db import SessionLocal
from app.scan_service import run_scan_and_store

_state: dict = {
    "status": "idle",       # idle | running | done | error
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
}
_lock = threading.Lock()


def get_status() -> dict:
    with _lock:
        return dict(_state)


def _run(sample_size: int | None) -> None:
    db = SessionLocal()
    try:
        result = run_scan_and_store(db, sample_size=sample_size)
        with _lock:
            _state.update(status="done", result=result, error=None,
                          finished_at=datetime.now(UTC).isoformat())
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state.update(status="error", error=str(exc),
                          finished_at=datetime.now(UTC).isoformat())
    finally:
        db.close()


def start(sample_size: int | None = None) -> bool:
    """Arranca el escaneo si no hay uno en marcha. Devuelve True si lo lanzó."""
    with _lock:
        if _state["status"] == "running":
            return False
        _state.update(status="running", started_at=datetime.now(UTC).isoformat(),
                      finished_at=None, result=None, error=None)
    threading.Thread(target=_run, args=(sample_size,), daemon=True).start()
    return True
