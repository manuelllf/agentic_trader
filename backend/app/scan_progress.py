"""Progreso EN VIVO del escaneo que esté corriendo ahora mismo — pura telemetría, en memoria,
no persiste, se resetea al reiniciar. Un solo proceso confirmado (sin `--workers` en el CMD del
Dockerfile), así que un dict a nivel de módulo + lock basta; no hace falta BD ni Redis.
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime

_lock = threading.Lock()
_state: dict = {
    # idle | macro | gather | gather_retry | prescore | mid | deep | constructor | done | error
    "stage": "idle",
    "scan_started_at": None,
    "stage_started_at": None,
    "total": None,
    # Qué cuenta "total"/"done": cambia según la etapa (tickers en gather/mid/deep, LOTES de
    # ~20 en prescore) — sin esto, "38/151" en prescore se lee como tickers y son lotes.
    "unit": None,
    "done": 0,
    "ok": 0,
    "fail": 0,
    "last_fail": None,         # cadena corta, ej. "TICKER: motivo" — una miga de pan, no un log
}


def reset() -> None:
    with _lock:
        _state.update(stage="idle", scan_started_at=datetime.now(UTC).isoformat(),
                      stage_started_at=None, total=None, unit=None, done=0, ok=0, fail=0,
                      last_fail=None)


def set_stage(stage: str, total: int | None = None, unit: str | None = None) -> None:
    with _lock:
        _state.update(stage=stage, stage_started_at=datetime.now(UTC).isoformat(),
                      total=total, unit=unit, done=0, ok=0, fail=0, last_fail=None)


def tick(ok: bool, reason: str | None = None) -> None:
    with _lock:
        _state["done"] += 1
        if ok:
            _state["ok"] += 1
        else:
            _state["fail"] += 1
            # SIEMPRE se deja algo: un `fail` sin `last_fail` es peor que uno con un motivo
            # genérico — el primero parece un hueco de telemetría (¿se perdió el dato?), el
            # segundo dice claramente "falló, sin más detalle para este caso".
            _state["last_fail"] = reason if reason else "(sin motivo registrado)"


def snapshot() -> dict:
    with _lock:
        return dict(_state)
