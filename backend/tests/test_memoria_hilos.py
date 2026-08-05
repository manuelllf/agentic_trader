"""Tests sin red y sin embeddings: bug de hilos, filtro de recuerdos vacíos y deduplicación.

El bug importante (reproducido en producción): `history_for` cacheaba la conexión sqlite del
singleton `MemoryStore`, pero FastAPI atiende cada petición en un hilo distinto del pool →
`ProgrammingError: SQLite objects created in a thread can only be used in that same thread`.
Aquí se reproduce llamando desde el hilo principal Y desde un hilo aparte sobre el MISMO store.
"""

from __future__ import annotations

import sqlite3
import threading

from app.memory.store import Memory, MemoryStore, dedup_por_ticker


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


def test_history_for_funciona_desde_otro_hilo(tmp_path) -> None:
    """Reproduce el bug real: mismo store, misma conexión cacheada, hilo distinto."""
    db_path = str(tmp_path / "memoria.db")
    _insert(db_path, "tesis", "NVDA", "primera tesis", "2026-01-01T00:00:00+00:00")
    _insert(db_path, "decision", "NVDA", "segunda tesis", "2026-02-01T00:00:00+00:00")

    store = MemoryStore(db_path=db_path)
    try:
        desde_principal = store.history_for("NVDA")

        resultado_hilo: list[Memory] = []
        error_hilo: list[Exception] = []

        def _en_otro_hilo() -> None:
            try:
                resultado_hilo.extend(store.history_for("NVDA"))
            except Exception as exc:  # noqa: BLE001 — se captura para poder aserirla en el test
                error_hilo.append(exc)

        hilo = threading.Thread(target=_en_otro_hilo)
        hilo.start()
        hilo.join()

        assert not error_hilo, f"history_for reventó en otro hilo: {error_hilo}"
        assert [m.text for m in resultado_hilo] == [m.text for m in desde_principal]
    finally:
        store.close()


def test_history_for_omite_recuerdos_de_texto_vacio(tmp_path) -> None:
    db_path = str(tmp_path / "memoria.db")
    _insert(db_path, "tesis", "NVDA", "tesis real", "2026-01-01T00:00:00+00:00")
    _insert(db_path, "tesis", "NVDA", " ", "2026-01-02T00:00:00+00:00")  # residuo de parseo roto

    store = MemoryStore(db_path=db_path)
    try:
        recuerdos = store.history_for("NVDA")
        assert [m.text for m in recuerdos] == ["tesis real"]
    finally:
        store.close()


def _memoria(id_, ticker, text, distance) -> Memory:
    return Memory(id=id_, kind="tesis", ticker=ticker, text=text, distance=distance)


def test_dedup_por_ticker_se_queda_con_la_de_menor_distancia() -> None:
    items = [
        _memoria(1, "AAPL", "tesis de marzo", 0.30),
        _memoria(2, "AAPL", "tesis de julio, más parecida", 0.10),
        _memoria(3, "NVDA", "única tesis de NVDA", 0.20),
    ]

    resultado = dedup_por_ticker(items)

    # ordenado por distancia, menor primero
    assert [m.ticker for m in resultado] == ["AAPL", "NVDA"]
    aapl = next(m for m in resultado if m.ticker == "AAPL")
    assert aapl.text == "tesis de julio, más parecida"


def test_dedup_por_ticker_rellena_n_tesis_con_el_total_pasado() -> None:
    items = [
        _memoria(1, "AAPL", "tesis de marzo", 0.30),
        _memoria(2, "AAPL", "tesis de julio", 0.10),
        _memoria(3, "NVDA", "única tesis de NVDA", 0.20),
    ]
    # El total "en total" puede ser mayor que las que cayeron en `items` (p.ej. AAPL tiene 5
    # tesis guardadas pero solo 2 aparecieron en este top-k).
    counts = {"AAPL": 5, "NVDA": 1}

    resultado = dedup_por_ticker(items, counts=counts)

    aapl = next(m for m in resultado if m.ticker == "AAPL")
    nvda = next(m for m in resultado if m.ticker == "NVDA")
    assert aapl.n_tesis == 5
    assert nvda.n_tesis == 1


def test_dedup_por_ticker_sin_counts_no_toca_n_tesis() -> None:
    items = [_memoria(1, "AAPL", "tesis", 0.10)]
    resultado = dedup_por_ticker(items)
    assert resultado[0].n_tesis is None
