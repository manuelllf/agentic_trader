"""Memoria semántica del agente (vectorizada) — separada del libro de capital.

El dinero vive en el ledger (exacto, sin vectores). Aquí van las TESIS y razonamientos
pasados, embebidos con un modelo local (gratis), para que el agente pueda RECORDAR por
significado ("¿qué concluí de un setup parecido antes?") aunque el historial crezca.

`get_store()` devuelve un singleton perezoso; si faltan las deps (fastembed/sqlite-vec) o
falla, el que llama debe tolerarlo (la memoria es una mejora, no un requisito del escaneo).
"""

from __future__ import annotations

from app.memory.store import Memory, MemoryStore

_store: MemoryStore | None = None


def get_store(db_path: str = "agent_memory.db") -> MemoryStore:
    global _store
    if _store is None:
        _store = MemoryStore(db_path=db_path)
    return _store


__all__ = ["Memory", "MemoryStore", "get_store"]
