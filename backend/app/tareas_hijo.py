"""Lo que corre dentro del proceso hijo (ver `proceso_hijo`). Cada tarea abre su propia sesión de
BD y recibe el evento con el que el padre pide parar."""

from __future__ import annotations

import threading


def escaneo(args: dict, cancelado: threading.Event) -> dict:
    from app.db import SessionLocal
    from app.scan_service import run_scan_and_store

    db = SessionLocal()
    try:
        return run_scan_and_store(db, cancel_event=cancelado, **args)
    finally:
        db.close()


def foto(args: dict, cancelado: threading.Event) -> dict:  # noqa: ARG001 — la foto no se cancela
    from app import foto_service
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        return foto_service.capturar(db, **args)
    finally:
        db.close()


def analitica(args: dict, cancelado: threading.Event) -> dict[str, int]:  # noqa: ARG001
    from app import analytics_sync

    return analytics_sync.sync(**args)
