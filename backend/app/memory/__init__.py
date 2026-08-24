"""Memoria semántica del agente (vectorizada) — separada del libro de capital.

El dinero vive en el ledger (exacto, sin vectores). Aquí van las TESIS y razonamientos
pasados, embebidos con un modelo local (gratis), para que el agente pueda RECORDAR por
significado ("¿qué concluí de un setup parecido antes?") aunque el historial crezca.

`get_store()` devuelve un singleton perezoso; si faltan las deps (fastembed) o falla (p. ej.
DATABASE_URL no es Postgres), el que llama debe tolerarlo (la memoria es una mejora, no un
requisito del escaneo).
"""

from __future__ import annotations

import importlib.util
import os

from app.config import settings
from app.memory.store import Memory, MemoryStore

_store: MemoryStore | None = None


def _cache_dir() -> str:
    """Mismo directorio que antes usaba el volumen para el SQLite (`MEMORY_DB_PATH` sigue
    apuntando a `/data/agent_memory.db` en Railway) — reutiliza `/data/fastembed_cache`, que
    ya existe, sin tener que tocar ninguna variable de entorno en el despliegue."""
    return os.path.join(os.path.dirname(settings.memory_db_path) or ".", "fastembed_cache")


def get_store() -> MemoryStore:
    global _store
    if _store is None:
        _store = MemoryStore(database_url=settings.database_url, cache_dir=_cache_dir())
    return _store


def reset_store() -> None:
    """Olvida el singleton (p. ej. tras un cambio de configuración en caliente)."""
    global _store
    if _store is not None:
        _store.close()
        _store = None


def status() -> dict:
    """Diagnóstico READ-ONLY de la memoria vectorial SIN cargar el modelo de embeddings.

    Cuenta filas en `memories` (Postgres) directamente; comprueba con `find_spec` (sin importar
    nada pesado) si `fastembed` está instalado. Sirve para confirmar que un `recall` funcionaría
    sin disparar la carga del modelo (~130 MB).
    """
    deps = bool(importlib.util.find_spec("fastembed"))
    if not settings.database_url.startswith(("postgresql", "postgres")):
        return {"available": False, "deps": deps, "count": 0,
                "error": "DATABASE_URL no es Postgres."}
    try:
        import psycopg

        from app.memory.store import _pg_dsn

        with psycopg.connect(_pg_dsn(settings.database_url)) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM memories")
            count = cur.fetchone()[0]
    except Exception as exc:  # noqa: BLE001 — tabla ausente/BD caída: no debe tirar el diagnóstico
        return {"available": False, "deps": deps, "count": 0, "error": str(exc)}
    return {"available": bool(count and deps), "deps": deps, "count": count}


__all__ = ["Memory", "MemoryStore", "get_store", "reset_store", "status"]
