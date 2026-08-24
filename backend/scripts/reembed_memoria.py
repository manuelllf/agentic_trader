"""Recalcula el embedding de TODOS los recuerdos con el modelo de embeddings ACTUAL.

Cuándo hace falta: al cambiar `DEFAULT_MODEL` en `app/memory/store.py` (p.ej. de un modelo
solo-inglés a uno multilingüe, porque las tesis guardadas están en español). Los vectores
viejos quedan calculados con OTRO modelo y comparar distancias entre modelos distintos no
tiene sentido — hay que recalcular la columna `embedding` con el modelo nuevo.

Idempotente: solo hace UPDATE de la columna `embedding` a partir del `text` ya guardado
(la fuente de verdad), nunca borra filas. Puede correrse varias veces sin riesgo.

Uso (desde la carpeta backend, con --extra memory --extra postgres instalados):
    uv run python scripts/reembed_memoria.py
"""

from __future__ import annotations

from app.config import settings
from app.memory import _cache_dir
from app.memory.store import MemoryStore


def main() -> None:
    store = MemoryStore(
        database_url=settings.database_url, cache_dir=_cache_dir()
    )  # modelo = DEFAULT_MODEL actual
    import psycopg

    with psycopg.connect(store._dsn) as conn, conn.cursor() as cur:  # noqa: SLF001
        cur.execute("SELECT id, text FROM memories")
        filas = cur.fetchall()
    print(f"Recuerdos en `memories`: {len(filas)}")

    # Se calculan TODOS los vectores ANTES de tocar la tabla: la primera ejecución tras cambiar
    # de modelo tiene que descargarlo (0,22 GB), y si eso falla a mitad, no queremos filas ya
    # actualizadas con el modelo nuevo mezcladas con filas del viejo.
    nuevos = [
        (store._vec_literal(store._embed(text)), rowid)  # noqa: SLF001
        for rowid, text in filas
        if text and text.strip()   # los vacíos (informes que fallaron) no se embeben
    ]

    with psycopg.connect(store._dsn) as conn, conn.cursor() as cur:  # noqa: SLF001
        cur.executemany(
            "UPDATE memories SET embedding = %s::vector WHERE id = %s", nuevos
        )
        conn.commit()

    print(f"Modelo usado: {store._model_name}")  # noqa: SLF001
    print(f"Vectores recalculados: {len(nuevos)}")


if __name__ == "__main__":
    main()
