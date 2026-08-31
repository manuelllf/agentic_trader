"""Tests del scraper HTTP directo de Yahoo (`app/screener/yahoo_scraper.py`, motor primario del
gather) y de su integración en `fundamentals.gather()` (scraper primario, yfinance de reserva).

Sin red real: una sesión falsa con `.get`/`.post` guionizados (mismo patrón de monkeypatching que
`test_capa_media_y_opa.py`/`test_fundamentals_cache.py`, solo que aquí se sustituye la sesión HTTP
en vez de `fund_mod.gather` entero)."""

from __future__ import annotations

import pytest

from app.screener import fundamentals as fund_mod
from app.screener import yahoo_scraper


class _FakeResponse:
    """Respuesta HTTP mínima que imita lo que usa este módulo de `curl_cffi`: `.status_code`,
    `.text`, `.url` y `.json()`."""

    def __init__(self, status_code=200, text="", url="", json_data=None):
        self.status_code = status_code
        self.text = text
        self.url = url
        self._json_data = json_data

    def json(self):
        if self._json_data is None:
            raise ValueError("respuesta falsa sin JSON")
        return self._json_data


class _FakeSession:
    """Sesión falsa: `.get`/`.post` consumen una lista guionizada de respuestas (o excepciones,
    para simular un fallo de red) en el ORDEN en que las llama el código bajo prueba."""

    def __init__(self, gets=None, posts=None):
        self._gets = list(gets or [])
        self._posts = list(posts or [])
        self.get_calls: list[tuple] = []
        self.post_calls: list[tuple] = []

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        item = self._gets.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        item = self._posts.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


# ---- consentir_y_crumb() ---------------------------------------------------------


def test_consentir_y_crumb_parsea_el_formulario_y_devuelve_el_crumb(monkeypatch) -> None:
    """Camino con muro de consentimiento: parsea los 4 campos ocultos, postea el "agree" y
    reutiliza la MISMA sesión para pedir el crumb."""
    html = (
        '<input type="hidden" name="sessionId" value="SESS1">'
        '<input type="hidden" name="csrfToken" value="CSRF1">'
        '<input type="hidden" name="originalDoneUrl" '
        'value="https://finance.yahoo.com/quote/AAPL/&#x3D;ok">'
        '<input type="hidden" name="namespace" value="NS1">'
    )
    r_pagina = _FakeResponse(status_code=200, text=html,
                             url="https://consent.yahoo.com/v2/collectConsent")
    r_post = _FakeResponse(status_code=200, text="")
    r_crumb = _FakeResponse(status_code=200, text="abc123crumb")
    fake = _FakeSession(gets=[r_pagina, r_crumb], posts=[r_post])
    monkeypatch.setattr(yahoo_scraper.creq, "Session", lambda impersonate=None: fake)

    s, crumb = yahoo_scraper.consentir_y_crumb()

    assert s is fake
    assert crumb == "abc123crumb"
    posteado = fake.post_calls[0][1]["data"]
    assert posteado == {"csrfToken": "CSRF1", "sessionId": "SESS1",
                        "originalDoneUrl": "https://finance.yahoo.com/quote/AAPL/=ok",
                        "namespace": "NS1", "agree": "agree"}


def test_consentir_y_crumb_sin_muro_no_postea_nada(monkeypatch) -> None:
    """Sin "consent.yahoo.com" en la URL (ej. IP no-EU) no hace falta el POST de consentimiento:
    pide el crumb directamente sobre la misma sesión."""
    r_pagina = _FakeResponse(status_code=200, text="", url="https://finance.yahoo.com/quote/AAPL/")
    r_crumb = _FakeResponse(status_code=200, text="directo123")
    fake = _FakeSession(gets=[r_pagina, r_crumb])
    monkeypatch.setattr(yahoo_scraper.creq, "Session", lambda impersonate=None: fake)

    s, crumb = yahoo_scraper.consentir_y_crumb()

    assert crumb == "directo123"
    assert fake.post_calls == []


def test_consentir_y_crumb_sin_muro_y_crumb_invalido_lanza_runtimeerror(monkeypatch) -> None:
    r_pagina = _FakeResponse(status_code=200, text="", url="https://finance.yahoo.com/quote/AAPL/")
    r_crumb = _FakeResponse(status_code=401, text="Invalid Crumb")
    fake = _FakeSession(gets=[r_pagina, r_crumb])
    monkeypatch.setattr(yahoo_scraper.creq, "Session", lambda impersonate=None: fake)

    with pytest.raises(RuntimeError):
        yahoo_scraper.consentir_y_crumb()


# ---- gather_scraper() -------------------------------------------------------------


def _qs_payload(*, sector="Technology", industry="Software", short_name="Acme Corp") -> dict:
    return {
        "quoteSummary": {
            "error": None,
            "result": [{
                "price": {"regularMarketPrice": {"raw": 123.45}, "shortName": short_name},
                "quoteType": {},
                "defaultKeyStatistics": {"forwardPE": {"raw": 15.2}},
                "assetProfile": {"sector": sector, "industry": industry},
                "summaryDetail": {"marketCap": {"raw": 5.0e9}, "fiftyTwoWeekLow": {"raw": 80.0},
                                  "fiftyTwoWeekHigh": {"raw": 150.0}},
                "financialData": {"targetHighPrice": {"raw": 200.0},
                                  "currentPrice": {"raw": 123.45}},
                "calendarEvents": {"earnings": {"earningsDate": [{"raw": 1750000000}],
                                                "isEarningsDateEstimate": True}},
            }],
        }
    }


_CHART_PAYLOAD = {
    "chart": {
        "error": None,
        "result": [{
            "timestamp": [1700000000, 1700086400],
            "indicators": {"quote": [{"close": [120.0, 121.0]}],
                           "adjclose": [{"adjclose": [119.5, 120.5]}]},
        }],
    }
}

_NEWS_PAYLOAD = {
    "data": {"tickerStream": {"stream": [
        {"content": {"title": "Acme sube tras resultados",
                     "summary": "La compañía reportó ingresos por encima de lo esperado."}},
    ]}}
}


def test_gather_scraper_construye_namedata_con_exito() -> None:
    fake = _FakeSession(
        gets=[_FakeResponse(status_code=200, json_data=_qs_payload()),
              _FakeResponse(status_code=200, json_data=_CHART_PAYLOAD)],
        posts=[_FakeResponse(status_code=200, json_data=_NEWS_PAYLOAD)],
    )

    data, motivo = yahoo_scraper.gather_scraper(fake, "crumb123", "ACME")

    assert motivo is None
    assert data is not None
    assert data.ticker == "ACME"
    assert data.sector == "Technology"
    assert data.industry == "Software"
    assert data.name == "Acme Corp"
    assert data.market_cap == 5.0e9
    assert data.target_high == 200.0
    assert data.price == 123.45
    assert "P/E (forward): 15.20" in data.fundamentals_text
    assert "52w range $80.00-$150.00" in data.technical_text
    assert len(data.news) == 1
    assert "Acme sube tras resultados" in data.news[0]


def test_gather_scraper_sin_datos_no_lanza_y_no_reintenta(monkeypatch) -> None:
    """200 OK pero sin sector/marketCap/shortName: "sin datos" genuino, se devuelve tal cual sin
    excepción — y sin llegar siquiera a pedir histórico/noticias."""
    payload = {"quoteSummary": {"error": None, "result": [{
        "price": {}, "quoteType": {}, "defaultKeyStatistics": {}, "assetProfile": {},
        "summaryDetail": {}, "financialData": {},
    }]}}
    fake = _FakeSession(gets=[_FakeResponse(status_code=200, json_data=payload)])

    data, motivo = yahoo_scraper.gather_scraper(fake, "crumb", "ZZZZ")

    assert data is None
    assert motivo is not None and "quoteSummary" in motivo
    assert fake.get_calls == fake.get_calls[:1]   # ni un segundo GET (histórico) llegó a pedirse


def test_gather_scraper_http_no_200_lanza_transporterror() -> None:
    fake = _FakeSession(gets=[_FakeResponse(status_code=500, text="boom")])

    with pytest.raises(yahoo_scraper.TransportError):
        yahoo_scraper.gather_scraper(fake, "crumb", "ACME")


def test_gather_scraper_excepcion_de_red_lanza_transporterror() -> None:
    fake = _FakeSession(gets=[ConnectionError("sin red")])

    with pytest.raises(yahoo_scraper.TransportError):
        yahoo_scraper.gather_scraper(fake, "crumb", "ACME")


# ---- fundamentals.gather(): scraper primario / yfinance de reserva ---------------


class _TickerFalso:
    """`yf.Ticker` de mentira, mismo patrón que `test_fundamentals_cache.py`."""

    def __init__(self, ticker):
        self.info = {"sector": "Technology", "marketCap": 5e9, "shortName": "ACME Inc"}
        self.news = []

    def history(self, **kwargs):
        import pandas as pd
        return pd.DataFrame()


def test_gather_con_transporterror_del_scraper_cae_a_yfinance(monkeypatch) -> None:
    """Con sesión de scraper disponible pero un fallo de TRANSPORTE puntual, `gather()` reintenta
    el MISMO ticker por yfinance puro (mockeado aquí) y aun así devuelve un resultado usable."""
    monkeypatch.setattr(fund_mod, "_scraper_session", lambda: (object(), "crumb"))

    def _falla(s, crumb, ticker, query_symbol=None, db=None):
        raise yahoo_scraper.TransportError("crumb caducado a mitad de escaneo")

    monkeypatch.setattr(yahoo_scraper, "gather_scraper", _falla)
    monkeypatch.setattr(fund_mod.yf, "Ticker", _TickerFalso)

    data, motivo = fund_mod.gather("ACME")

    assert motivo is None
    assert data is not None
    assert data.ticker == "ACME"
    assert data.sector == "Technology"


def test_gather_sin_sesion_de_scraper_no_lo_invoca_y_usa_yfinance(monkeypatch) -> None:
    """Consentimiento fallido al arrancar el proceso (`_scraper_session()` → None): `gather()` no
    intenta el scraper NI UNA VEZ, va directo a yfinance puro — el fallback total."""
    monkeypatch.setattr(fund_mod, "_scraper_session", lambda: None)

    def _no_deberia_llamarse(s, crumb, ticker):
        raise AssertionError("no debería invocarse el scraper sin sesión disponible")

    monkeypatch.setattr(yahoo_scraper, "gather_scraper", _no_deberia_llamarse)
    monkeypatch.setattr(fund_mod.yf, "Ticker", _TickerFalso)

    data, motivo = fund_mod.gather("ACME")

    assert motivo is None
    assert data is not None
    assert data.ticker == "ACME"
