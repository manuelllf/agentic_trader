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

# Modelo de embeddings local por defecto. Las tesis guardadas están en ESPAÑOL y el modelo
# antiguo (BAAI/bge-small-en-v1.5) es solo inglés: medido sobre los 317 recuerdos reales, la
# posición del acierto en el top-10 mejora en 6 de 8 consultas — "aseguradoras" #6→#2,
# "mineras de oro" #2→#1, "bancos con exposición a emergentes" #10→#4, "venta de acciones por
# directivos" no salía y pasa a #8. Mismas 384 dimensiones que el modelo anterior → la tabla
# `vec_memories` no cambia de forma, solo hay que recalcular los vectores (ver
# scripts/reembed_memoria.py). Pesa 0,22 GB frente a 0,13 del modelo inglés.
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@dataclass
class Memory:
    id: int
    kind: str
    ticker: str
    text: str
    distance: float | None = None
    created_at: str = ""
    # Solo se rellena tras deduplicar por ticker (ver `_dedup_por_ticker`): cuántas tesis
    # tiene ESE ticker guardadas en total, no solo cuántas caían en este resultado.
    n_tesis: int | None = None


def dedup_por_ticker(items: list[Memory], counts: dict[str, int] | None = None) -> list[Memory]:
    """Colapsa varias filas del mismo ticker a una sola: la de menor distancia.

    Sin esto, un solo nombre con varias tesis guardadas puede ocupar varios huecos del top-10
    con tesis de fechas distintas (medido sobre el store real: 59 de 204 nombres tienen más de
    una). Aislada de la base de datos a propósito, para poder probarla sin montar embeddings:
    `counts` es opcional y, si se pasa, rellena `n_tesis` (cuántas tiene ESE ticker en total,
    no solo cuántas cayeron en `items`). El resultado queda ordenado por distancia.
    """
    mejor: dict[str, Memory] = {}
    for m in items:
        actual = mejor.get(m.ticker)
        if actual is None or (m.distance or 0.0) < (actual.distance or 0.0):
            mejor[m.ticker] = m
    ordenados = sorted(mejor.values(), key=lambda m: m.distance if m.distance is not None else 0.0)
    if counts:
        for m in ordenados:
            m.n_tesis = counts.get(m.ticker, 1)
    return ordenados


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

        # `check_same_thread=False`: FastAPI atiende cada petición en un hilo distinto del
        # pool y el store cachea esta conexión en el singleton. Sin esto, la SEGUNDA petición
        # (en otro hilo) revienta con: "ProgrammingError: SQLite objects created in a thread
        # can only be used in that same thread". Reproducido en producción: buscar un ticker
        # devolvía su historia la primera vez y luego caía. Es seguro porque aquí solo se lee
        # (o se escribe siempre desde `remember`, nunca en paralelo) y SQLite serializa el
        # acceso a nivel de fichero.
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
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
            # Mismo motivo que en `_connect`: este singleton se comparte entre peticiones que
            # FastAPI puede atender en hilos distintos del pool.
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.execute(
                "CREATE TABLE IF NOT EXISTS memories("
                "id INTEGER PRIMARY KEY, kind TEXT, ticker TEXT, text TEXT, created_at TEXT)"
            )
            conn.commit()
            self._sql_conn = conn
        return self._sql_conn

    # -- API --------------------------------------------------------------------
    def remember(self, text: str, kind: str = "", ticker: str = "") -> int:
        """Guarda un recuerdo (tesis, decisión, observación) y su embedding.

        Descarta texto en blanco (2 de 317 recuerdos reales eran un solo espacio: residuo de
        informes profundos que fallaron al parsear en julio) — no tiene sentido ni embeberlo
        ni mostrarlo. Devuelve -1 para dejar claro que no se guardó nada.
        """
        if not text.strip():
            return -1
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
                "AND trim(m.text) != '' "
                "ORDER BY v.distance"
            )
            params = (sqlite_vec.serialize_float32(emb), k, *rowids)
        else:
            sql = (
                "SELECT m.id, m.kind, m.ticker, m.text, m.created_at, v.distance "
                "FROM vec_memories v JOIN memories m ON m.id = v.rowid "
                "WHERE v.embedding MATCH ? AND k = ? AND trim(m.text) != '' "
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
        el juicio del agente a un ticker concreto. Dedupica por ticker (ver `dedup_por_ticker`)
        y rellena `n_tesis` con el total real de esa empresa en `memories` (no solo las que
        cayeron en este top-k).
        """
        emb = self._embed(query)
        candidatos = self._knn(emb, k)
        counts: dict[str, int] = {}
        if candidatos:
            conn = self._connect()
            tickers = sorted({m.ticker for m in candidatos})
            placeholders = ",".join("?" * len(tickers))
            filas = conn.execute(
                f"SELECT ticker, COUNT(*) FROM memories "
                f"WHERE ticker IN ({placeholders}) AND trim(text) != '' GROUP BY ticker",
                tickers,
            ).fetchall()
            counts = dict(filas)
        return dedup_por_ticker(candidatos, counts=counts)

    def history_for(self, ticker: str, limit: int = 20) -> list[Memory]:
        """Recuerdos de un ticker en orden cronológico inverso, por SQL puro (sin embeddings).

        "Qué dijo el sistema de NVDA" es una consulta exacta por ticker+fecha, no una búsqueda
        por parecido semántico: usar el índice vectorial para esto sería la herramienta
        equivocada. Por eso este método NO llama a `_embed` ni fuerza la carga del modelo.
        """
        conn = self._connect_sql_only()
        rows = conn.execute(
            "SELECT id, kind, ticker, text, created_at FROM memories "
            "WHERE ticker = ? AND trim(text) != '' ORDER BY created_at DESC LIMIT ?",
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
