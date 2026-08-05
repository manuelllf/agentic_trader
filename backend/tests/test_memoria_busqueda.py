"""Tests de `MemoryStore`: filtro por ticker en `recall`, `search` e `history_for`.

`recall`/`search` necesitan embeddings reales (fastembed) y se saltan si no está instalado
(dependencia opcional del extra "memory"). `history_for` es SQL puro sobre la tabla `memories`
y se prueba SIN cargar ningún embedder: inserta filas directamente por SQL, tal y como pide la
propiedad que se quiere garantizar (una consulta exacta no debe forzar el modelo de vectores).
"""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
from collections.abc import Iterator

import pytest

from app.memory.store import MemoryStore


def _insert(db_path: str, kind: str, ticker: str, text: str, created_at: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS memories("
        "id INTEGER PRIMARY KEY, kind TEXT, ticker TEXT, text TEXT, created_at TEXT)"
    )
    conn.execute(
        "INSERT INTO memories(kind, ticker, text, created_at) VALUES (?, ?, ?, ?)",
        (kind, ticker, text, created_at),
    )
    conn.commit()
    conn.close()


@pytest.fixture
def short_tmpdir() -> Iterator[str]:
    """Directorio temporal PLANO (no el `tmp_path` de pytest, anidado bajo
    `pytest-of-<user>/pytest-NNN/<nombre-del-test>/`).

    Los tests que cargan fastembed de verdad necesitan sitio para el modelo en disco: el nombre
    del repo de HuggingFace (`models--qdrant--paraphrase-multilingual-MiniLM-L12-v2-onnx-Q`) más
    el hash del blob (64 caracteres) y el sufijo `.incomplete` ya son largos de por sí. Sumados a
    la ruta anidada de `tmp_path`, la ruta total supera los 260 caracteres de Windows (MAX_PATH)
    y la descarga falla con `FileNotFoundError` al abrir el `.incomplete` — no es un fallo de
    red ni del código, es el límite clásico de longitud de ruta de Windows. Reproducido de forma
    determinista: 266 caracteres con `tmp_path`, 218 con este directorio plano.
    """
    d = tempfile.mkdtemp(prefix="fe")
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_history_for_orden_cronologico_inverso_sin_embeddings(tmp_path) -> None:
    db_path = str(tmp_path / "memoria.db")
    _insert(db_path, "tesis", "NVDA", "primera tesis", "2026-01-01T00:00:00+00:00")
    _insert(db_path, "decision", "NVDA", "segunda tesis", "2026-02-01T00:00:00+00:00")
    _insert(db_path, "observacion", "NVDA", "tercera tesis", "2026-03-01T00:00:00+00:00")
    _insert(db_path, "tesis", "AAPL", "tesis de otro ticker", "2026-02-15T00:00:00+00:00")

    store = MemoryStore(db_path=db_path)
    try:
        recuerdos = store.history_for("NVDA")
        assert [m.text for m in recuerdos] == ["tercera tesis", "segunda tesis", "primera tesis"]
        assert all(m.ticker == "NVDA" for m in recuerdos)
    finally:
        store.close()


def test_history_for_respeta_el_limite(tmp_path) -> None:
    db_path = str(tmp_path / "memoria.db")
    for i in range(5):
        _insert(db_path, "tesis", "TSLA", f"tesis {i}", f"2026-01-0{i + 1}T00:00:00+00:00")

    store = MemoryStore(db_path=db_path)
    try:
        recuerdos = store.history_for("TSLA", limit=2)
        assert len(recuerdos) == 2
        assert recuerdos[0].text == "tesis 4"
        assert recuerdos[1].text == "tesis 3"
    finally:
        store.close()


def test_history_for_ticker_sin_recuerdos_devuelve_vacio(tmp_path) -> None:
    db_path = str(tmp_path / "memoria.db")
    _insert(db_path, "tesis", "AAPL", "tesis de AAPL", "2026-01-01T00:00:00+00:00")

    store = MemoryStore(db_path=db_path)
    try:
        assert store.history_for("MSFT") == []
    finally:
        store.close()


def test_history_for_no_carga_el_embedder(tmp_path) -> None:
    """Propiedad central del pedido: una consulta exacta no debe forzar fastembed/sqlite-vec."""
    db_path = str(tmp_path / "memoria.db")
    _insert(db_path, "tesis", "NVDA", "tesis de NVDA", "2026-01-01T00:00:00+00:00")

    store = MemoryStore(db_path=db_path)
    try:
        store.history_for("NVDA")
        assert store._embedder is None
    finally:
        store.close()


@pytest.mark.parametrize("k", [3])
def test_recall_filtra_por_ticker_antes_del_k(short_tmpdir, k) -> None:
    """Reproduce el bug medido en producción: sin filtrar antes, un ticker con recuerdos
    reales podía recibir lista vacía porque sus vecinos más cercanos eran de otras empresas.
    """
    pytest.importorskip("fastembed")
    pytest.importorskip("sqlite_vec")

    db_path = f"{short_tmpdir}/memoria_vec.db"
    store = MemoryStore(db_path=db_path)
    try:
        # Muchos recuerdos parecidos de otro ticker "trillado" para copar los k globales.
        for i in range(10):
            store.remember(f"AAPL tiene un momentum fuerte en el trimestre {i}", ticker="AAPL")
        # Un único recuerdo de NVDA, semánticamente distinto pero real.
        store.remember("NVDA depende de la demanda de centros de datos de IA", ticker="NVDA")

        resultados = store.recall("demanda de centros de datos de IA", k=k, ticker="NVDA")

        assert len(resultados) == 1
        assert resultados[0].ticker == "NVDA"
    finally:
        store.close()


def test_search_no_filtra_por_ticker(short_tmpdir) -> None:
    pytest.importorskip("fastembed")
    pytest.importorskip("sqlite_vec")

    db_path = f"{short_tmpdir}/memoria_vec.db"
    store = MemoryStore(db_path=db_path)
    try:
        store.remember("tesis de AAPL sobre márgenes", ticker="AAPL")
        store.remember("tesis de NVDA sobre centros de datos", ticker="NVDA")

        resultados = store.search("tesis sobre márgenes y centros de datos", k=10)

        tickers = {m.ticker for m in resultados}
        assert tickers == {"AAPL", "NVDA"}
    finally:
        store.close()
