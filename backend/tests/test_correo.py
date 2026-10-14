from __future__ import annotations

import httpx
import pytest

from app import correo
from app.config import settings


class _Respuesta:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


@pytest.fixture
def con_clave(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(settings, "resend_api_key", "clave-de-prueba")


def test_sin_clave_no_llama_a_resend(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(correo, "_post", lambda payload, clave: pytest.fail("llamó a Resend"))
    assert correo.enviar("ana@ejemplo.com", "Asunto", "Texto") is False


def test_envia_texto_y_html_al_destino(monkeypatch, con_clave) -> None:  # noqa: ANN001
    llamadas = []
    monkeypatch.setattr(correo, "_post",
                        lambda payload, clave: llamadas.append((payload, clave)) or _Respuesta(200))
    assert correo.enviar("ana@ejemplo.com", "Omega: 2 señales nuevas", "AAOI, ASTS", "<p>x</p>")
    payload, clave = llamadas[0]
    assert clave == "clave-de-prueba"
    assert payload == {"from": settings.correo_remitente, "to": ["ana@ejemplo.com"],
                       "subject": "Omega: 2 señales nuevas", "text": "AAOI, ASTS",
                       "html": "<p>x</p>"}


def test_sin_html_solo_va_el_texto(monkeypatch, con_clave) -> None:  # noqa: ANN001
    llamadas = []
    monkeypatch.setattr(correo, "_post",
                        lambda payload, clave: llamadas.append(payload) or _Respuesta(200))
    correo.enviar("ana@ejemplo.com", "Asunto", "Texto")
    assert "html" not in llamadas[0]


def test_rechazo_de_resend_devuelve_false(monkeypatch, con_clave) -> None:  # noqa: ANN001
    monkeypatch.setattr(correo, "_post", lambda payload, clave: _Respuesta(422, '{"message": "x"}'))
    assert correo.enviar("ana@ejemplo.com", "Asunto", "Texto") is False


def test_error_de_red_no_lanza(monkeypatch, con_clave) -> None:  # noqa: ANN001
    def caida(payload, clave):  # noqa: ANN001, ANN202
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(correo, "_post", caida)
    assert correo.enviar("ana@ejemplo.com", "Asunto", "Texto") is False
