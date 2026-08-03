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


# ---- caché persistente y reintentos ------------------------------------------

def _db_memoria():
    """Sesión SQLite en memoria con las tablas creadas (la caché vive en Meta)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app import models  # noqa: F401
    from app.db import Base

    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    return sessionmaker(bind=e)()


def test_un_dia_ya_cerrado_se_baja_UNA_vez_y_sobrevive_al_bloqueo(monkeypatch) -> None:
    """Lo que arregla el problema de fondo: la página de un día PASADO no cambia nunca, así que
    se guarda sin caducidad. Un 403 posterior ya no vacía la ventana — antes, un solo bloqueo
    dejaba el macro sin eventos y a la semana siguiente volvía a intentarlo desde cero."""
    db = _db_memoria()
    llamadas: list[str] = []

    def _fake(page: str, timeout: float = 15.0) -> str:
        llamadas.append(page)
        return "'''Business and economy'''\n*The Fed holds rates\n"

    monkeypatch.setattr(events, "_fetch_wikitext", _fake)
    primero = events.wikipedia_current_events(days=3, db=db)
    assert "Fed holds rates" in primero
    assert len(llamadas) == 3

    # Segunda pasada con Wikipedia CAÍDA del todo: la ventana sale ENTERA igualmente.
    monkeypatch.setattr(events, "_fetch_wikitext", lambda page, timeout=15.0: "")
    segundo = events.wikipedia_current_events(days=3, db=db)
    assert segundo.count("Fed holds rates") == 3       # 3 días servidos de caché, 0 peticiones
    assert len(llamadas) == 3                          # no se volvió a pedir nada


def test_sin_db_sigue_funcionando_sin_cachear(monkeypatch) -> None:
    """La caché es una mejora, no un requisito: sin sesión (tests, usos sueltos) baja todo."""
    llamadas: list[str] = []
    monkeypatch.setattr(events, "_fetch_wikitext",
                        lambda page, timeout=15.0: llamadas.append(page) or
                        "'''Business and economy'''\n*Fed holds\n")
    events.wikipedia_current_events(days=2)
    events.wikipedia_current_events(days=2)
    assert len(llamadas) == 4                          # sin caché, se repite


def test_un_403_no_se_reintenta(monkeypatch) -> None:
    """Un 403 es un bloqueo por política, no un fallo transitorio: reintentarlo siete veces por
    escaneo solo alarga el escaneo. Los 429/5xx sí se reintentan con espera creciente."""
    intentos: list[int] = []

    class _R:
        def __init__(self, code): self.status_code = code
        def json(self): return {}

    monkeypatch.setattr(events.time, "sleep", lambda _s: None)
    monkeypatch.setattr(events.httpx, "get",
                        lambda *a, **k: (intentos.append(1), _R(403))[1])
    assert events._fetch_wikitext("X") == ""
    assert len(intentos) == 1

    intentos.clear()
    monkeypatch.setattr(events.httpx, "get",
                        lambda *a, **k: (intentos.append(1), _R(429))[1])
    assert events._fetch_wikitext("X") == ""
    assert len(intentos) == events._RETRIES


def test_google_news_parsea_rss_deduplica_y_cachea(monkeypatch) -> None:
    """El fallback de GDELT: título del canal fuera, CDATA/entidades limpiadas, duplicados y
    vacíos tirados, cacheado 6 h igual que GDELT, y con `when:` en la query — sin él el feed
    ordena por relevancia y cuela titulares de años atrás (pasó en la primera prueba)."""
    db = _db_memoria()
    llamadas: list[int] = []
    captured: dict = {}

    rss = (
        "<?xml version='1.0'?><rss><channel>"
        "<title>Google News</title>"
        "<item><title>Fed holds rates - Reuters</title></item>"
        "<item><title><![CDATA[Oil &amp; gas spike - WSJ]]></title></item>"
        "<item><title>Fed holds rates - Reuters</title></item>"
        "<item><title></title></item>"
        "</channel></rss>"
    )

    class _R:
        status_code = 200
        content = rss.encode()
        text = rss

    def fake_get(url, params=None, **kw):  # noqa: ANN001, ANN003
        llamadas.append(1)
        captured.update(params or {})
        return _R()

    monkeypatch.setattr(events.httpx, "get", fake_get)
    out = events.google_news_headlines(db=db)
    assert "when:" in captured["q"]                    # ventana de frescura, no archivo
    assert out == ["Fed holds rates - Reuters", "Oil & gas spike - WSJ"]
    assert events.google_news_headlines(db=db) == out
    assert len(llamadas) == 1                          # la segunda salió de la caché


def test_gdelt_se_cachea_y_no_machaca_su_api(monkeypatch) -> None:
    """Su API gratuita va muy rate-limitada: pedirla en cada escaneo era la forma más segura
    de no obtener nada."""
    db = _db_memoria()
    llamadas: list[int] = []

    class _R:
        status_code = 200
        content = b"x"
        def json(self): return {"articles": [{"title": "Fed holds rates"}]}

    monkeypatch.setattr(events.httpx, "get", lambda *a, **k: (llamadas.append(1), _R())[1])
    assert events.gdelt_headlines(db=db) == ["Fed holds rates"]
    assert events.gdelt_headlines(db=db) == ["Fed holds rates"]
    assert len(llamadas) == 1                          # la segunda salió de la caché
