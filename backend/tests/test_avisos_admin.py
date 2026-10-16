from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from app import avisos_admin, correo
from app.config import settings

MOMENTO = datetime(2026, 10, 14, 20, 5, tzinfo=UTC)


@pytest.fixture
def buzon(monkeypatch) -> list:  # noqa: ANN001
    """Con clave y dos admins (es y en): recoge lo que se mandaría en vez de mandarlo."""
    monkeypatch.setattr(settings, "resend_api_key", "clave-de-prueba")
    monkeypatch.setattr(avisos_admin, "destinatarios",
                        lambda: [("ana@ejemplo.com", "es"), ("bob@ejemplo.com", "en")])
    enviados: list = []
    monkeypatch.setattr(correo, "enviar", lambda destino, asunto, texto, html=None:
                        enviados.append((destino, asunto, texto, html)) or True)
    return enviados


def test_omega_avisa_por_push_y_por_correo_en_el_idioma_de_cada_cuenta(monkeypatch, buzon) -> None:  # noqa: ANN001
    pushes = []
    resumen = {"total": 1, "ok": 1, "baja": 0, "error": 0, "endpoints": set()}
    monkeypatch.setattr("app.push.enviar_a_todos",
                        lambda db, **kw: pushes.append(kw) or resumen)
    monkeypatch.setattr("app.push.enviar_a_admins_liga", lambda *a, **kw:
                        {"total": 0, "ok": 0, "baja": 0, "error": 0, "endpoints": set()})
    n = avisos_admin.avisar(Mock(), "omega_nuevas", title="Omega: 2 señales nuevas",
                            body="AAOI, ASTS", url="/admin/omega", tag="agentic-omega",
                            filas=[("AAOI", "suelo"), ("ASTS", "zigzag")], count=2)
    assert n == resumen["ok"]
    assert pushes == [{"title": "Omega: 2 señales nuevas", "body": "AAOI, ASTS",
                       "url": "/admin/omega", "tag": "agentic-omega"}]
    (es_destino, es_asunto, es_texto, es_html), (en_destino, en_asunto, en_texto, _) = buzon
    assert (es_destino, es_asunto) == ("ana@ejemplo.com", "Omega: 2 señales nuevas")
    assert (en_destino, en_asunto) == ("bob@ejemplo.com", "Omega: 2 new signals")
    assert "AAOI (suelo), ASTS (zigzag)" in es_texto
    assert "AAOI (floor), ASTS (zigzag)" in en_texto
    assert "Ver en Vennett: https://vennett.app/admin/omega" in es_texto
    assert "https://vennett.app/correo/marca-correo.png" in es_html
    assert 'href="https://vennett.app/liga"' in es_html
    assert "https://vennett.app/cuenta/avisos" in es_html


def test_una_sola_senal_usa_el_singular(buzon) -> None:  # noqa: ANN001
    avisos_admin.por_correo("omega_nuevas", "/admin/omega", [("AAOI", "suelo")], count=1)
    assert [asunto for _, asunto, _, _ in buzon] == ["Omega: 1 señal nueva", "Omega: 1 new signal"]


def test_resuelta_traduce_el_motivo_y_formatea_el_resultado(buzon) -> None:  # noqa: ANN001
    avisos_admin.por_correo("omega_resueltas", "/admin/omega", ticker="ASTS", motivo="objetivo",
                            ret=12.34)
    (_, es_asunto, es_texto, _), (_, en_asunto, en_texto, _) = buzon
    assert es_asunto == "Omega: ASTS, objetivo alcanzado"
    assert "Resultado de la señal: +12,3 %." in es_texto
    assert en_asunto == "Omega: ASTS, target reached"
    assert "Signal result: +12.3%." in en_texto


def test_la_fecha_va_en_hora_de_nueva_york() -> None:
    asunto, texto, _ = avisos_admin.mensaje("omega_candidatos", "es", "/admin/omega",
                                            [("AAA", None)], MOMENTO, count=1)
    assert asunto == "Omega: 1 candidato nuevo"
    assert "14 de octubre de 2026, 16:05 (hora de Nueva York)" in texto
    _, texto_en, _ = avisos_admin.mensaje("omega_candidatos", "en", "/admin/omega", [], MOMENTO,
                                          count=3)
    assert "October 14, 2026, 16:05 New York time" in texto_en


def test_el_html_escapa_lo_que_llega_de_fuera() -> None:
    _, _, html = avisos_admin.mensaje("omega_nuevas", "es", "/admin/omega",
                                      [("<b>X</b>", "suelo")], MOMENTO, count=1)
    assert "<b>X</b>" not in html
    assert "&lt;b&gt;X&lt;/b&gt;" in html


def test_sin_clave_ni_siquiera_busca_destinatarios(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(avisos_admin, "destinatarios", lambda: pytest.fail("leyó destinatarios"))
    assert avisos_admin.por_correo("omega_nuevas", "/admin/omega", count=1) == 0


def test_si_falla_la_lectura_de_destinatarios_el_aviso_sigue(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(settings, "resend_api_key", "clave-de-prueba")

    def rota() -> list:
        raise RuntimeError("sin base de datos")

    monkeypatch.setattr(avisos_admin, "destinatarios", rota)
    assert avisos_admin.por_correo("omega_nuevas", "/admin/omega", count=1) == 0


def test_tipo_sin_canales_no_manda_nada(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr("app.push.send_to_all", lambda db, **kw: pytest.fail("push"))
    monkeypatch.setattr(avisos_admin, "por_correo", lambda *a, **k: pytest.fail("correo"))
    assert avisos_admin.avisar(None, "tipo_inventado", title="t", body="b", url="/x", tag="x") == 0
