"""Almacén de memoria vectorial: `sqlite-vec` + embeddings locales (`fastembed`).

- `sqlite-vec`: búsqueda vectorial DENTRO de un fichero SQLite → cero infra, inspeccionable.
- `fastembed`: embeddings en local con ONNX (sin torch, ligero) → 0 € por vector.

Las dependencias se importan de forma perezosa: la app arranca sin ellas; solo hacen falta
si de verdad usas la memoria (`uv sync --extra memory`).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

# Modelo de embeddings local por defecto (~130 MB, buen equilibrio calidad/tamaño).
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


@dataclass
class Memory:
    id: int
    kind: str
    ticker: str
    text: str
    distance: float | None = None


class MemoryStore:
    def __init__(self, db_path: str = "agent_memory.db", model_name: str = DEFAULT_MODEL) -> None:
        self._db_path = db_path
        self._model_name = model_name
        self._conn: sqlite3.Connection | None = None
        self._embedder = None
        self._dim: int | None = None

    # -- inicialización perezosa ------------------------------------------------
    def _embed(self, text: str):  # noqa: ANN001
        if self._embedder is None:
            import os

            from fastembed import TextEmbedding  # import perezoso

            # Cache del modelo JUNTO a la DB de memoria → en Railway cae en el volumen y se
            # descarga una sola vez (no en cada deploy).
            cache = os.path.join(os.path.dirname(self._db_path) or ".", "fastembed_cache")
            self._embedder = TextEmbedding(model_name=self._model_name, cache_dir=cache)
        return list(self._embedder.embed([text]))[0]

    def _connect(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn

        import sqlite_vec  # import perezoso

        conn = sqlite3.connect(self._db_path)
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)

        if self._dim is None:
            self._dim = len(self._embed("dimension probe"))
        conn.execute(
            "CREATE TABLE IF NOT EXISTS memories("
            "id INTEGER PRIMARY KEY, kind TEXT, ticker TEXT, text TEXT, created_at TEXT)"
        )
        conn.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(embedding float[{self._dim}])"
        )
        conn.commit()
        self._conn = conn
        return conn

    # -- API --------------------------------------------------------------------
    def remember(self, text: str, kind: str = "", ticker: str = "") -> int:
        """Guarda un recuerdo (tesis, decisión, observación) y su embedding."""
        import sqlite_vec

        conn = self._connect()
        cur = conn.execute(
            "INSERT INTO memories(kind, ticker, text, created_at) VALUES (?, ?, ?, ?)",
            (kind, ticker, text, datetime.now(UTC).isoformat()),
        )
        rowid = cur.lastrowid
        emb = self._embed(text)
        conn.execute(
            "INSERT INTO vec_memories(rowid, embedding) VALUES (?, ?)",
            (rowid, sqlite_vec.serialize_float32(emb)),
        )
        conn.commit()
        return int(rowid)

    def recall(self, query: str, k: int = 5, ticker: str | None = None) -> list[Memory]:
        """Recupera los k recuerdos más parecidos por significado."""
        import sqlite_vec

        conn = self._connect()
        emb = self._embed(query)
        rows = conn.execute(
            "SELECT m.id, m.kind, m.ticker, m.text, v.distance "
            "FROM vec_memories v JOIN memories m ON m.id = v.rowid "
            "WHERE v.embedding MATCH ? AND k = ? "
            "ORDER BY v.distance",
            (sqlite_vec.serialize_float32(emb), k),
        ).fetchall()
        results = [Memory(id=r[0], kind=r[1], ticker=r[2], text=r[3], distance=r[4]) for r in rows]
        if ticker:
            results = [m for m in results if m.ticker == ticker]
        return results

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> "MemoryStore":
        return self

    def __exit__(self, *_exc) -> None:  # noqa: ANN002
        self.close()
