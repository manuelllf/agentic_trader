"""Reglas puras del acertijo, sin conexiones de base de datos."""

from datetime import UTC, date, datetime

import pytest

from app.criptico.logica import comprobar, hoy_madrid, normalizar


@pytest.mark.parametrize(("entrada", "esperada"), [
    ("áÉíÓúüñ", "AEIOUUN"),
    (" acción de bolsa ", "ACCIONDEBOLSA"),
    ("a-1.b_!?", "AB"),
    ("", ""),
    ("a\u0301ccio\u0301n", "ACCION"),
])
def test_normalizar(entrada: str, esperada: str) -> None:
    assert normalizar(entrada) == esperada


@pytest.mark.parametrize(("letras", "respuesta", "correcta"), [
    (" ácción ", "ACCION", True),
    ("accion", "ACCIÓN", True),
    ("ac cio n", "ACCION", True),
    ("ACCIO", "ACCION", False),
    ("ACCIONES", "ACCION", False),
    ("ACCIOS", "ACCION", False),
    ("", "ACCION", False),
])
def test_comprobar(letras: str, respuesta: str, correcta: bool) -> None:
    assert comprobar(letras, respuesta) is correcta


@pytest.mark.parametrize(("instante", "esperada"), [
    ("2026-01-15T22:59:59+00:00", date(2026, 1, 15)),
    ("2026-01-15T23:00:00+00:00", date(2026, 1, 16)),
    ("2026-07-15T21:59:59+00:00", date(2026, 7, 15)),
    ("2026-07-15T22:00:00+00:00", date(2026, 7, 16)),
])
def test_hoy_madrid(instante: str, esperada: date) -> None:
    assert hoy_madrid(datetime.fromisoformat(instante)) == esperada


def test_hoy_madrid_reloj(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.criptico import logica

    class Reloj(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 7, 15, 22, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(logica, "datetime", Reloj)
    assert hoy_madrid() == date(2026, 7, 16)
