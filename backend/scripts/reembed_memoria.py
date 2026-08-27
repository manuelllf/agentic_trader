"""Recalcula los chunks/embeddings de TODOS los recuerdos con el modelo de embeddings ACTUAL.

Cuándo hace falta: al cambiar `DEFAULT_MODEL` en `app/memory/store.py`, o al cambiar el
troceo (`_CHUNK_WORDS`/`_CHUNK_OVERLAP`) — los vectores viejos quedan calculados con OTRO
modelo/troceo y comparar distancias entre uno y otro no tiene sentido.

Idempotente: borra los `memory_chunks` de cada recuerdo y los recalcula desde `memories.text`
(la fuente de verdad, ya completa desde el troceo — ver `docs/backlog.md`), nunca toca
`memories`. Puede correrse varias veces sin riesgo.

Uso (desde la carpeta backend, con --extra memory --extra postgres instalados):
    uv run python scripts/reembed_memoria.py
"""

from __future__ import annotations

from app.config import settings
from app.memory import _cache_dir
from app.memory.store import MemoryStore, _chunk


def main() -> None:
    store = MemoryStore(
        database_url=settings.database_url, cache_dir=_cache_dir()
    )  # modelo = DEFAULT_MODEL actual
    import psycopg

    with psycopg.connect(store._dsn) as conn, conn.cursor() as cur:  # noqa: SLF001
        cur.execute("SELECT id, text FROM memories WHERE trim(text) != ''")
        filas = cur.fetchall()
    print(f"Recuerdos en `memories`: {len(filas)}")

    # Se calculan TODOS los chunks/vectores ANTES de tocar la tabla: la primera ejecución tras
    # cambiar de modelo tiene que descargarlo (0,22 GB), y si eso falla a mitad, no queremos
    # recuerdos ya recalculados mezclados con recuerdos del modelo/troceo viejo.
    nuevos: list[tuple[int, int, str, str]] = []   # (memory_id, chunk_index, text, vec_literal)
    for rowid, text in filas:
        for i, chunk_text in enumerate(_chunk(text)):  # noqa: SLF001
            emb = store._embed(chunk_text)  # noqa: SLF001
            nuevos.append((rowid, i, chunk_text, store._vec_literal(emb)))  # noqa: SLF001

    ids = [rowid for rowid, _ in filas]
    with psycopg.connect(store._dsn) as conn, conn.cursor() as cur:  # noqa: SLF001
        if ids:
            cur.execute("DELETE FROM memory_chunks WHERE memory_id = ANY(%s)", (ids,))
        cur.executemany(
            "INSERT INTO memory_chunks (memory_id, chunk_index, text, embedding) "
            "VALUES (%s, %s, %s, %s::vector)",
            nuevos,
        )
        conn.commit()

    print(f"Modelo usado: {store._model_name}")  # noqa: SLF001
    print(f"Chunks recalculados: {len(nuevos)} (de {len(filas)} recuerdos)")


if __name__ == "__main__":
    main()
