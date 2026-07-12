"""Memoria semántica del agente (vectorizada) — separada del libro de capital.

El dinero vive en el ledger (exacto, sin vectores). Aquí van las TESIS y razonamientos
pasados, embebidos con un modelo local (gratis), para que el agente pueda RECORDAR por
significado ("¿qué concluí de un setup parecido antes?") aunque el historial crezca.

`get_store()` devuelve un singleton perezoso; si faltan las deps (fastembed/sqlite-vec) o
falla, el que llama debe tolerarlo (la memoria es una mejora, no un requisito del escaneo).
"""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

from app.config import settings
from app.memory.store import Memory, MemoryStore

_store: MemoryStore | None = None


def get_store(db_path: str | None = None) -> MemoryStore:
    global _store
    if _store is None:
        _store = MemoryStore(db_path=db_path or settings.memory_db_path)
    return _store


def reset_store() -> None:
    """Cierra y olvida el singleton (p. ej. antes de sobrescribir el fichero de memoria)."""
    global _store
    if _store is not None:
        _store.close()
        _store = None


def status() -> dict:
    """Diagnóstico READ-ONLY de la memoria vectorial SIN cargar el modelo de embeddings.

    Abre el fichero con sqlite3 crudo y cuenta los recuerdos; comprueba con `find_spec` (sin
    importar nada pesado) si las deps de vectores están instaladas. Sirve para confirmar que el
    volcado llegó al volumen y que un `recall` funcionaría, sin disparar fastembed (~130 MB).
    """
    path = settings.memory_db_path
    deps = bool(importlib.util.find_spec("fastembed") and importlib.util.find_spec("sqlite_vec"))
    if not Path(path).exists():
        return {"available": False, "exists": False, "count": 0, "deps": deps, "path": path}
    try:
        conn = sqlite3.connect(path)
        try:
            has_table = conn.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='memories'"
            ).fetchone()[0]
            count = conn.execute("SELECT count(*) FROM memories").fetchone()[0] if has_table else 0
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 — un fichero corrupto no debe tirar el diagnóstico
        return {"available": False, "exists": True, "count": 0, "deps": deps,
                "path": path, "error": str(exc)}
    # Utilizable = fichero con recuerdos Y deps instaladas (recall real funcionaría).
    return {"available": bool(count and deps), "exists": True, "count": count,
            "deps": deps, "path": path}


__all__ = ["Memory", "MemoryStore", "get_store", "reset_store", "status"]
