"""Recalcula el embedding de TODOS los recuerdos con el modelo de embeddings ACTUAL.

Cuándo hace falta: al cambiar `DEFAULT_MODEL` en `app/memory/store.py` (p.ej. de un modelo
solo-inglés a uno multilingüe, porque las tesis guardadas están en español). Los vectores
viejos quedan calculados con OTRO modelo y comparar distancias entre modelos distintos no
tiene sentido — hay que recalcular toda la tabla `vec_memories` con el modelo nuevo.

Idempotente: no borra nada de `memories` (la fuente de verdad), solo vacía y repuebla
`vec_memories` a partir del texto ya guardado. Puede correrse varias veces sin riesgo.

Uso (desde la carpeta backend):
    uv run python scripts/reembed_memoria.py
"""

from __future__ import annotations

from app.config import settings
from app.memory.store import MemoryStore


def main() -> None:
    store = MemoryStore(db_path=settings.memory_db_path)  # modelo = DEFAULT_MODEL actual
    try:
        conn = store._connect()  # noqa: SLF001 — script de mantenimiento, conexión cruda
        import sqlite_vec

        filas = conn.execute("SELECT id, text FROM memories").fetchall()
        print(f"Recuerdos en `memories`: {len(filas)}")

        # Se calculan TODOS los vectores ANTES de tocar la tabla: la primera ejecución tras
        # cambiar de modelo tiene que descargarlo (0,22 GB), y si eso falla a mitad, borrar
        # primero dejaría la memoria a medias. Así, o se sustituye entera o no se toca.
        nuevos = [
            (rowid, sqlite_vec.serialize_float32(store._embed(text)))  # noqa: SLF001
            for rowid, text in filas
            if text and text.strip()   # los vacíos (informes que fallaron) no se embeben
        ]

        conn.execute("DELETE FROM vec_memories")
        conn.executemany("INSERT INTO vec_memories(rowid, embedding) VALUES (?, ?)", nuevos)
        conn.commit()
        recalculados = len(nuevos)

        print(f"Modelo usado: {store._model_name}")  # noqa: SLF001
        print(f"Vectores recalculados: {recalculados}")
    finally:
        store.close()


if __name__ == "__main__":
    main()
