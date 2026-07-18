"""Tests de las fuentes de eventos macro: filtro de secciones, fallos VISIBLES y solo inglés.

Todo puro/mockeado — aquí no se toca la red (los bordes HTTP reales son best-effort a posta).
"""

from __future__ import annotations

from app.screener import events


def test_user_agent_lleva_contacto() -> None:
    """La política de Wikimedia exige contacto en el UA; sin él responden 403 y los eventos
    llegan vacíos (pasó en prod y fue invisible durante semanas)."""
    assert "contact:" in events._UA["User-Agent"]


def test_macro_sections_filtra_geopolitica_y_macro() -> None:
    """Se quedan las 4 secciones de contexto geopolítico/macro; deportes y sucesos, fuera."""
    wt = (
        "'''Armed conflicts and attacks'''\n*Attack near the [[Strait of Hormuz]]\n"
        "'''Sports'''\n*Local cup final\n"
        "'''Business and economy'''\n*The [[Federal Reserve|Fed]] holds rates\n"
        "'''Law and crime'''\n*Bank robbery downtown\n"
        "'''International relations'''\n*Summit held in [[Geneva]]\n"
        "'''Politics and elections'''\n*[[United Kingdom|UK]] snap election called\n"
    )
    out = events._macro_sections_only(wt)
    assert "Strait of Hormuz" in out
    assert "Fed holds rates" in out
    assert "Geneva" in out
    assert "UK snap election" in out
    assert "cup final" not in out
    assert "robbery" not in out


def test_fetch_wikitext_no_200_devuelve_vacio_y_avisa(monkeypatch, caplog) -> None:
    """Un 403 (bloqueo por UA/policy) no es excepción: sin este warning el macro se queda sin
    eventos EN SILENCIO. Debe devolver '' y dejar rastro en los logs."""
    class _Resp:
        status_code = 403

    monkeypatch.setattr(events.httpx, "get", lambda *a, **k: _Resp())
    with caplog.at_level("WARNING"):
        out = events._fetch_wikitext("Portal:Current_events/2026_July_17")
    assert out == ""
    assert any("403" in r.getMessage() for r in caplog.records)


def test_gdelt_pide_solo_ingles_y_deduplica(monkeypatch) -> None:
    """La query fija `sourcelang:eng` (sin él GDELT mezcla idiomas) y los titulares repetidos
    o vacíos se tiran."""
    captured: dict = {}

    class _Resp:
        status_code = 200
        content = b"x"

        def json(self):
            return {"articles": [{"title": "Fed holds"}, {"title": "Fed holds"},
                                 {"title": "Oil spikes"}, {"title": ""}]}

    def fake_get(url, params=None, **kw):  # noqa: ANN001, ANN003
        captured.update(params or {})
        return _Resp()

    monkeypatch.setattr(events.httpx, "get", fake_get)
    out = events.gdelt_headlines()
    assert "sourcelang:eng" in captured["query"]
    assert out == ["Fed holds", "Oil spikes"]
