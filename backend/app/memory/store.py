"""Almacén de memoria vectorial: Postgres/pgvector (Supabase) + embeddings locales (`fastembed`).

- `pgvector`: búsqueda vectorial dentro de la misma base que el resto de la app — mismo backup,
  mismo pool de conexiones, sin fichero SQLite aparte en el volumen de Railway.
- `fastembed`: embeddings en local con ONNX (sin torch, ligero) → 0 € por vector.

Las dependencias se importan de forma perezosa: la app arranca sin ellas; solo hacen falta
si de verdad usas la memoria (`uv sync --extra memory --extra postgres`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

# Modelo de embeddings local por defecto. Las tesis guardadas están en ESPAÑOL y el modelo
# antiguo (BAAI/bge-small-en-v1.5) es solo inglés: medido sobre los 317 recuerdos reales, la
# posición del acierto en el top-10 mejora en 6 de 8 consultas — "aseguradoras" #6→#2,
# "mineras de oro" #2→#1, "bancos con exposición a emergentes" #10→#4, "venta de acciones por
# directivos" no salía y pasa a #8. Mismas 384 dimensiones que el modelo anterior → la tabla
# `memories` no cambia de forma, solo hay que recalcular los vectores (ver
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


def _pg_dsn(database_url: str) -> str:
    """`postgresql+psycopg://...` (dialecto SQLAlchemy) → `postgresql://...` (lo que espera
    `psycopg.connect` a pelo). Mismo patrón que `_run_analytics_query` en `api/routes.py`."""
    return database_url.replace("postgresql+psycopg://", "postgresql://")


class MemoryStore:
    def __init__(self, database_url: str, model_name: str = DEFAULT_MODEL,
                 cache_dir: str | None = None) -> None:
        if not database_url.startswith(("postgresql", "postgres")):
            raise ValueError(
                "La memoria vectorial requiere Postgres (pgvector) — DATABASE_URL apunta a "
                f"{database_url.split(':', 1)[0]!r}, no a postgresql."
            )
        self._dsn = _pg_dsn(database_url)
        self._model_name = model_name
        # En Railway cae en el mismo volumen que antes usaba el SQLite (`/data/fastembed_cache`,
        # ya existe) → el modelo ONNX (~0,22 GB) se descarga una sola vez, no en cada deploy.
        self._cache_dir = cache_dir
        self._embedder = None
        self._dim: int | None = None

    # -- inicialización perezosa ------------------------------------------------
    def _embed(self, text: str):  # noqa: ANN001
        if self._embedder is None:
            from fastembed import TextEmbedding  # import perezoso

            self._embedder = TextEmbedding(model_name=self._model_name, cache_dir=self._cache_dir)
        return list(self._embedder.embed([text]))[0]

    def _connect(self):  # noqa: ANN001
        """Conexión nueva por llamada: Postgres soporta concurrencia real (a diferencia del
        SQLite de antes), así que no hace falta el singleton `check_same_thread=False` ni sus
        workarounds — cada método abre y cierra la suya."""
        import psycopg

        return psycopg.connect(self._dsn)

    @staticmethod
    def _vec_literal(emb) -> str:  # noqa: ANN001
        return "[" + ",".join(repr(float(x)) for x in emb) + "]"

    # -- API --------------------------------------------------------------------
    def remember(self, text: str, kind: str = "", ticker: str = "") -> int:
        """Guarda un recuerdo (tesis, decisión, observación) y su embedding.

        Descarta texto en blanco (residuo de informes profundos que fallaron al parsear) — no
        tiene sentido ni embeberlo ni mostrarlo. Devuelve -1 para dejar claro que no se guardó
        nada.
        """
        if not text.strip():
            return -1
        emb = self._embed(text)
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO memories (kind, ticker, text, created_at, embedding) "
                "VALUES (%s, %s, %s, %s, %s::vector) RETURNING id",
                (kind, ticker, text, datetime.now(UTC), self._vec_literal(emb)),
            )
            rowid = cur.fetchone()[0]
            conn.commit()
        return int(rowid)

    def _knn(self, emb, k: int, rowids: list[int] | None = None) -> list[Memory]:
        """KNN por distancia L2 (`<->`, mismo operador que usaba `sqlite-vec` por defecto — no
        se cambia de métrica al migrar, para no mover el ranking ya calibrado), opcionalmente
        restringido a un subconjunto de ids.

        El filtro por id se aplica DENTRO de la propia consulta (no después en Python): pedir
        los k vecinos de TODA la base y filtrar luego deja fuera recuerdos reales cuando la
        tesis de un nombre se parece a las de sus vecinos (medido sobre el store real: de 31
        nombres con recuerdo guardado, 12 recibían lista vacía con ese orden).
        """
        vec = self._vec_literal(emb)
        with self._connect() as conn, conn.cursor() as cur:
            if rowids is not None:
                if not rowids:
                    return []
                cur.execute(
                    "SELECT id, kind, ticker, text, created_at, embedding <-> %s::vector AS dist "
                    "FROM memories WHERE id = ANY(%s) AND trim(text) != '' "
                    "ORDER BY embedding <-> %s::vector LIMIT %s",
                    (vec, rowids, vec, k),
                )
            else:
                cur.execute(
                    "SELECT id, kind, ticker, text, created_at, embedding <-> %s::vector AS dist "
                    "FROM memories WHERE trim(text) != '' "
                    "ORDER BY embedding <-> %s::vector LIMIT %s",
                    (vec, vec, k),
                )
            rows = cur.fetchall()
        return [
            Memory(id=r[0], kind=r[1], ticker=r[2], text=r[3], created_at=r[4].isoformat(),
                   distance=r[5])
            for r in rows
        ]

    def recall(self, query: str, k: int = 5, ticker: str | None = None) -> list[Memory]:
        """Recupera los k recuerdos más parecidos por significado, de un ticker si se indica.

        Cuando se pide `ticker`, la búsqueda vectorial se restringe a los ids de ese ticker
        ANTES de quedarse con los k mejores (ver `_knn`), no después.
        """
        emb = self._embed(query)
        if ticker:
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute("SELECT id FROM memories WHERE ticker = %s", (ticker,))
                ids = [r[0] for r in cur.fetchall()]
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
            tickers = sorted({m.ticker for m in candidatos})
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT ticker, COUNT(*) FROM memories "
                    "WHERE ticker = ANY(%s) AND trim(text) != '' GROUP BY ticker",
                    (tickers,),
                )
                counts = dict(cur.fetchall())
        return dedup_por_ticker(candidatos, counts=counts)

    def history_for(self, ticker: str, limit: int = 20) -> list[Memory]:
        """Recuerdos de un ticker en orden cronológico inverso, por SQL puro (sin embeddings).

        "Qué dijo el sistema de NVDA" es una consulta exacta por ticker+fecha, no una búsqueda
        por parecido semántico: usar el índice vectorial para esto sería la herramienta
        equivocada. Por eso este método NO llama a `_embed` ni fuerza la carga del modelo.
        """
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, kind, ticker, text, created_at FROM memories "
                "WHERE ticker = %s AND trim(text) != '' ORDER BY created_at DESC LIMIT %s",
                (ticker, limit),
            )
            rows = cur.fetchall()
        return [
            Memory(id=r[0], kind=r[1], ticker=r[2], text=r[3], created_at=r[4].isoformat())
            for r in rows
        ]

    def close(self) -> None:
        """Sin conexión persistente que cerrar: cada método abre/cierra la suya (ver
        `_connect`). Se queda como no-op para no romper `reset_store()`/el context manager."""

    def __enter__(self) -> "MemoryStore":
        return self

    def __exit__(self, *_exc) -> None:  # noqa: ANN002
        self.close()
