"""Formar no depende de la IA: si está apagada, el tope se gasta o se acaba el tiempo, sigue con la
caché y dice por qué. Sin base de datos, con la lista de preguntas y la IA sustituidas."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.liga.procesos import formar


def _resultado(cortada: bool = False) -> SimpleNamespace:
    return SimpleNamespace(cortada=cortada)


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
        return _resultado()

    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", lambda *_a, **_k: None)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", responder)

    motivo = formar.rellenar_preguntas(None, preguntas)     # no lanza

    assert contestadas == ["¿Foso?"]               # la segunda cortó; la tercera ni se intentó
    assert motivo == "tope"


@pytest.mark.parametrize(("razon", "esperado"), [
    ("Apagado aquí", "sin_ia"), ("Falta ENABLE_LLM en Railway", "sin_ia"),
    ("Sin clave de Jev", "sin_ia"), ("Tope mensual mal configurado", "sin_ia"),
    (formar.ia_comun.RAZON_TOPE, "tope")])
def test_si_la_ia_no_esta_disponible_desde_el_principio_no_se_llama_a_nadie(
        preguntas, monkeypatch, razon: str, esperado: str) -> None:  # noqa: ANN001
    llamadas: list[str] = []
    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", lambda *_a, **_k: razon)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes",
                        lambda **kw: llamadas.append(kw["pregunta"]))

    assert formar.rellenar_preguntas(None, preguntas) == esperado
    assert llamadas == []


def test_se_comprueba_la_finalidad_de_la_formacion_y_no_la_de_los_usuarios(
        preguntas, monkeypatch) -> None:  # noqa: ANN001
    comprobadas: list[str] = []
    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible",
                        lambda finalidad, *_a, **_k: comprobadas.append(finalidad))
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", lambda **_kw: _resultado())
    formar.rellenar_preguntas(None, preguntas)
    assert comprobadas == ["formacion"]


def test_si_no_se_puede_ni_comprobar_la_ia_cuenta_como_no_disponible(
        preguntas, monkeypatch) -> None:  # noqa: ANN001
    def revienta(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise RuntimeError("la base no responde")

    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", revienta)
    assert formar.rellenar_preguntas(None, preguntas) == "sin_ia"


def test_si_todo_va_bien_no_hay_motivo(preguntas, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", lambda *_a, **_k: None)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", lambda **_kw: _resultado())
    assert formar.rellenar_preguntas(None, preguntas) is None


def test_si_se_acaba_el_tiempo_no_se_pregunta_mas_y_se_dice(preguntas, monkeypatch) -> None:  # noqa: ANN001
    contestadas: list[str] = []

    def responder(*, pregunta, **_kw):  # noqa: ANN003, ANN202
        contestadas.append(pregunta)
        return _resultado(cortada=len(contestadas) == 2)

    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", lambda *_a, **_k: None)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", responder)

    assert formar.rellenar_preguntas(None, preguntas) == "tiempo"
    assert contestadas == ["¿Foso?", "¿Deuda baja?"]      # la tercera ni se intenta


def test_todas_las_preguntas_comparten_la_misma_hora_limite_y_la_finalidad(  # noqa: ANN001
        preguntas, monkeypatch) -> None:
    vistas: list[tuple] = []
    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", lambda *_a, **_k: None)
    monkeypatch.setattr(formar.time, "monotonic", lambda: 1000.0)
    monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes",
                        lambda **kw: vistas.append((kw["finalidad"], kw["hasta"])) or _resultado())

    formar.rellenar_preguntas(None, preguntas, limite_s=90)

    assert vistas == [("formacion", 1090.0)] * 3


@pytest.mark.parametrize(("guardado", "esperado"), [
    (None, formar.LIMITE_PREGUNTAS_S), (300, 300), (True, formar.LIMITE_PREGUNTAS_S),
    (0, formar.LIMITE_PREGUNTAS_S), (-5, formar.LIMITE_PREGUNTAS_S),
    ("rápido", formar.LIMITE_PREGUNTAS_S), (2.5, formar.LIMITE_PREGUNTAS_S)])
def test_el_limite_de_tiempo_guardado_solo_vale_si_es_un_entero_positivo(
        guardado, esperado: int) -> None:  # noqa: ANN001
    class Base:
        def execute(self, *_a, **_k):  # noqa: ANN002, ANN003, ANN201
            return SimpleNamespace(scalar=lambda: guardado)

    assert formar.limite_preguntas_s(Base()) == esperado


def test_sin_preguntas_no_se_comprueba_ni_la_ia(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(formar, "_preguntas_de_las_estrategias", lambda db, ctx: {})

    def no_debe_llamarse(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise AssertionError("no hay preguntas: no debe tocar la IA")

    monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", no_debe_llamarse)
    ctx = type("Ctx", (), {"foto_id": 1, "empresas": ()})()
    assert formar.rellenar_preguntas(None, ctx) is None
