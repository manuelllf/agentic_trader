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
    created_at: str = ""


class MemoryStore:
    def __init__(self, db_path: str = "agent_memory.db", model_name: str = DEFAULT_MODEL) -> None:
        self._db_path = db_path
        self._model_name = model_name
        self._conn: sqlite3.Connection | None = None
        self._sql_conn: sqlite3.Connection | None = None
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

    def _connect_sql_only(self) -> sqlite3.Connection:
        """Conexión SQL pura, sin `sqlite-vec` ni el embedder: para consultas exactas.

        Si `_connect()` ya se ejecutó (recall/remember previos), reutiliza esa conexión —
        ya tiene la tabla `memories`. Si no, abre una conexión ligera propia y crea solo la
        tabla `memories` (nunca `vec_memories`, que exige conocer la dimensión del embedder).
        """
        if self._conn is not None:
            return self._conn
        if self._sql_conn is None:
            conn = sqlite3.connect(self._db_path)
            conn.execute(
                "CREATE TABLE IF NOT EXISTS memories("
                "id INTEGER PRIMARY KEY, kind TEXT, ticker TEXT, text TEXT, created_at TEXT)"
            )
            conn.commit()
            self._sql_conn = conn
        return self._sql_conn

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

    def _knn(self, emb, k: int, rowids: list[int] | None = None) -> list[Memory]:
        """KNN sobre `vec_memories`, opcionalmente restringido a un subconjunto de rowids.

        El filtro por rowid se aplica ANTES del `k` (dentro de la propia consulta MATCH), no
        después en Python: pedir los k vecinos de TODA la base y filtrar luego deja fuera
        recuerdos reales cuando la tesis de un nombre se parece a las de sus vecinos. Medido
        sobre 268 recuerdos: de 31 nombres con recuerdo guardado, 12 recibían lista vacía — y
        los más afectados eran los más trillados, justo los que más historial tenían.
        """
        import sqlite_vec

        conn = self._connect()
        if rowids is not None:
            if not rowids:
                return []
            placeholders = ",".join("?" * len(rowids))
            sql = (
                "SELECT m.id, m.kind, m.ticker, m.text, m.created_at, v.distance "
                "FROM vec_memories v JOIN memories m ON m.id = v.rowid "
                f"WHERE v.embedding MATCH ? AND k = ? AND v.rowid IN ({placeholders}) "
                "ORDER BY v.distance"
            )
            params = (sqlite_vec.serialize_float32(emb), k, *rowids)
        else:
            sql = (
                "SELECT m.id, m.kind, m.ticker, m.text, m.created_at, v.distance "
                "FROM vec_memories v JOIN memories m ON m.id = v.rowid "
                "WHERE v.embedding MATCH ? AND k = ? "
                "ORDER BY v.distance"
            )
            params = (sqlite_vec.serialize_float32(emb), k)
        rows = conn.execute(sql, params).fetchall()
        return [
            Memory(id=r[0], kind=r[1], ticker=r[2], text=r[3], created_at=r[4], distance=r[5])
            for r in rows
        ]

    def recall(self, query: str, k: int = 5, ticker: str | None = None) -> list[Memory]:
        """Recupera los k recuerdos más parecidos por significado, de un ticker si se indica.

        Cuando se pide `ticker`, la búsqueda vectorial se restringe a los rowids de ese ticker
        ANTES de quedarse con los k mejores (ver `_knn`), no después.
        """
        conn = self._connect()
        emb = self._embed(query)
        if ticker:
            ids = [
                r[0]
                for r in conn.execute(
                    "SELECT id FROM memories WHERE ticker = ?", (ticker,)
                ).fetchall()
            ]
            return self._knn(emb, k, rowids=ids)
        return self._knn(emb, k)

    def search(self, query: str, k: int = 10) -> list[Memory]:
        """Búsqueda semántica pura sobre todos los recuerdos, sin filtro de ticker.

        Pensada para alimentar un buscador general (web), a diferencia de `recall`, que acota
        el juicio del agente a un ticker concreto.
        """
        emb = self._embed(query)
        return self._knn(emb, k)

    def history_for(self, ticker: str, limit: int = 20) -> list[Memory]:
        """Recuerdos de un ticker en orden cronológico inverso, por SQL puro (sin embeddings).

        "Qué dijo el sistema de NVDA" es una consulta exacta por ticker+fecha, no una búsqueda
        por parecido semántico: usar el índice vectorial para esto sería la herramienta
        equivocada. Por eso este método NO llama a `_embed` ni fuerza la carga del modelo.
        """
        conn = self._connect_sql_only()
        rows = conn.execute(
            "SELECT id, kind, ticker, text, created_at FROM memories "
            "WHERE ticker = ? ORDER BY created_at DESC LIMIT ?",
            (ticker, limit),
        ).fetchall()
        return [
            Memory(id=r[0], kind=r[1], ticker=r[2], text=r[3], created_at=r[4]) for r in rows
        ]

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
        if self._sql_conn is not None:
            self._sql_conn.close()
            self._sql_conn = None

    def __enter__(self) -> "MemoryStore":
        return self

    def __exit__(self, *_exc) -> None:  # noqa: ANN002
        self.close()
