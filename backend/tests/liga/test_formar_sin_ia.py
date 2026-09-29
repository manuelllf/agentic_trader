"""Formar contesta las preguntas propias con la IA del sistema, pero nunca depende de ella: si está
apagada, el tope mensual se gastó antes de empezar o se gasta a mitad, la jornada se forma igual
con lo que haya en caché. Sin base de datos: se sustituyen la lista de preguntas y la IA."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.liga.procesos import formar


@pytest.fixture
def preguntas(monkeypatch):  # noqa: ANN001, ANN201
    monkeypatch.setattr(formar, "_preguntas_de_las_estrategias",
                        lambda db, ctx: {"¿Foso?": {"AAA", "BBB"}, "¿Deuda baja?": {"CCC"},
                                         "¿Crece?": {"DDD"}})
    return type("Ctx", (), {"foto_id": 1, "empresas": ()})()


def test_si_el_tope_se_gasta_a_mitad_el_resto_sigue_con_la_cache(preguntas, monkeypatch) -> None:  # noqa: ANN001
    contestadas: list[str] = []

    def responder(*, pregunta, **_kw):  # noqa: ANN003, ANN202
        if len(contestadas) == 1:
            raise HTTPException(503, "Tope mensual de IA alcanzado.")
        contestadas.append(pregunta)

    monkeypatch.setattr(formar.ia_comun, "verificar_disponible", lambda *_a, **_k: None)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", responder)

    formar.rellenar_preguntas(None, preguntas)     # no lanza

    assert contestadas == ["¿Foso?"]               # la segunda cortó; la tercera ni se intentó


@pytest.mark.parametrize("motivo", ["IA apagada", "Tope mensual gastado", "Sistema no alcanzable"])
def test_si_la_ia_no_esta_disponible_desde_el_principio_no_se_llama_a_nadie(
        preguntas, monkeypatch, motivo: str) -> None:  # noqa: ANN001
    llamadas: list[str] = []

    def no_disponible(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise HTTPException(503, motivo)

    monkeypatch.setattr(formar.ia_comun, "verificar_disponible", no_disponible)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes",
                        lambda **kw: llamadas.append(kw["pregunta"]))

    formar.rellenar_preguntas(None, preguntas)

    assert llamadas == []


def test_sin_preguntas_no_se_comprueba_ni_la_ia(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(formar, "_preguntas_de_las_estrategias", lambda db, ctx: {})

    def no_debe_llamarse(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("no hay preguntas: no debe tocar la IA")

    monkeypatch.setattr(formar.ia_comun, "verificar_disponible", no_debe_llamarse)
    formar.rellenar_preguntas(None, type("Ctx", (), {"foto_id": 1, "empresas": ()})())
