"""Tests de `MemoryStore`: filtro por ticker en `recall`, `search` e `history_for`.

La memoria vectorial vive en Postgres/pgvector (ver `app/memory/store.py`) — estos tests
necesitan una base Postgres real y se saltan enteros si no hay `TEST_DATABASE_URL` configurada.
A PROPÓSITO nunca caen sobre `settings.database_url` (la de producción): escribir tesis de
mentira en la memoria real del agente está prohibido (ver memoria de sesión "no-fake-data") —
por eso exigen una URL de test aparte en vez de reutilizar la de la app.

Cada test limpia sus propias filas al final (`kind` único por test), así que una `TEST_DATABASE_URL`
apuntando a un proyecto Postgres real y compartido no acumula basura entre corridas.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app.memory.store import MemoryStore

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="Necesita TEST_DATABASE_URL (Postgres con pgvector) — nunca la BD de producción.",
)


@pytest.fixture
def store():
    s = MemoryStore(database_url=TEST_DATABASE_URL)
    kind = f"test-{uuid.uuid4().hex[:8]}"
    try:
        yield s, kind
    finally:
        import psycopg

        with psycopg.connect(s._dsn) as conn, conn.cursor() as cur:  # noqa: SLF001
            cur.execute("DELETE FROM memories WHERE kind = %s", (kind,))
            conn.commit()
        s.close()


def test_history_for_orden_cronologico_inverso(store) -> None:
    s, kind = store
    s.remember("primera tesis", kind=kind, ticker="NVDA")
    s.remember("segunda tesis", kind=kind, ticker="NVDA")
    s.remember("tercera tesis", kind=kind, ticker="NVDA")
    s.remember("tesis de otro ticker", kind=kind, ticker="AAPL")

    recuerdos = [m for m in s.history_for("NVDA", limit=50) if m.kind == kind]
    assert [m.text for m in recuerdos] == ["tercera tesis", "segunda tesis", "primera tesis"]
    assert all(m.ticker == "NVDA" for m in recuerdos)


def test_history_for_respeta_el_limite(store) -> None:
    s, kind = store
    for i in range(5):
        s.remember(f"tesis {i}", kind=kind, ticker="TSLA")

    recuerdos = s.history_for("TSLA", limit=2)
    assert len(recuerdos) == 2
    assert recuerdos[0].text == "tesis 4"
    assert recuerdos[1].text == "tesis 3"


def test_history_for_ticker_sin_recuerdos_devuelve_vacio(store) -> None:
    s, kind = store
    s.remember("tesis de AAPL", kind=kind, ticker="AAPL")
    assert s.history_for("MSFT-DE-MENTIRA-QUE-NO-EXISTE") == []


def test_history_for_no_carga_el_embedder(store) -> None:
    """Propiedad central: una consulta exacta no debe forzar fastembed."""
    s, kind = store
    s.remember("tesis de NVDA", kind=kind, ticker="NVDA")
    s.history_for("NVDA")
    assert s._embedder is None  # noqa: SLF001


def test_recall_filtra_por_ticker_antes_del_k(store) -> None:
    """Reproduce el bug medido en producción: sin filtrar antes, un ticker con recuerdos
    reales podía recibir lista vacía porque sus vecinos más cercanos eran de otras empresas."""
    s, kind = store
    for i in range(10):
        s.remember(f"AAPL tiene un momentum fuerte en el trimestre {i}", kind=kind, ticker="AAPL")
    s.remember("NVDA depende de la demanda de centros de datos de IA", kind=kind, ticker="NVDA")

    resultados = s.recall("demanda de centros de datos de IA", k=3, ticker="NVDA")

    assert len(resultados) == 1
    assert resultados[0].ticker == "NVDA"


def test_search_no_filtra_por_ticker(store) -> None:
    s, kind = store
    s.remember("tesis de AAPL sobre márgenes", kind=kind, ticker="AAPL")
    s.remember("tesis de NVDA sobre centros de datos", kind=kind, ticker="NVDA")

    resultados = s.search("tesis sobre márgenes y centros de datos", k=10)

    tickers = {m.ticker for m in resultados if m.kind == kind}
    assert tickers == {"AAPL", "NVDA"}
