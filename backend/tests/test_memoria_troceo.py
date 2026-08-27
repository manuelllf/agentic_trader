"""`_chunk()`: pura, sin Postgres ni fastembed — separada de `test_memoria_busqueda.py`
(que sí necesita `TEST_DATABASE_URL` y prueba el roundtrip real contra pgvector)."""

from __future__ import annotations

from app.memory.store import _chunk


def test_texto_corto_es_un_solo_chunk_sin_tocar() -> None:
    texto = "tesis corta de toda la vida"
    assert _chunk(texto) == [texto]


def test_texto_largo_se_trocea_en_varias_ventanas() -> None:
    texto = " ".join(f"palabra{i}" for i in range(250))
    chunks = _chunk(texto, words_per_chunk=90, overlap=15)
    assert len(chunks) > 1
    # Cada chunk cabe en la ventana (salvo redondeo del último).
    assert all(len(c.split()) <= 90 for c in chunks)
    # Nada se pierde: la última palabra del texto original aparece en el último chunk.
    assert "palabra249" in chunks[-1]


def test_los_chunks_se_solapan() -> None:
    texto = " ".join(f"palabra{i}" for i in range(200))
    chunks = _chunk(texto, words_per_chunk=90, overlap=15)
    primero = set(chunks[0].split())
    segundo = set(chunks[1].split())
    solape = primero & segundo
    assert len(solape) == 15   # exactamente el overlap pedido, ni una idea cortada en seco


def test_texto_justo_en_el_limite_no_se_trocea() -> None:
    texto = " ".join(f"p{i}" for i in range(90))
    assert _chunk(texto, words_per_chunk=90, overlap=15) == [texto]
