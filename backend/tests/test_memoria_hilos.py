"""Tests puros de `dedup_por_ticker` (sin BD, sin red, sin embeddings).

El bug de hilos que este fichero comprobaba (`ProgrammingError: SQLite objects created in a
thread can only be used in that same thread`, singleton con conexión sqlite cacheada) ya no
puede reproducirse: al migrar a Postgres/pgvector (`app/memory/store.py`), cada método de
`MemoryStore` abre y cierra su propia conexión — no hay conexión compartida entre hilos que
proteger. Los tests de conexión concurrente se retiran; los de deduplicación (lógica pura de
Python, sin base de datos) se quedan tal cual.
"""

from __future__ import annotations

from app.memory.store import Memory, dedup_por_ticker


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
