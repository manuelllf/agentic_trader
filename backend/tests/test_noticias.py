"""Noticias por empresa desde Google News: nombre de búsqueda, filtros, ventana y fallos."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest

from app.screener import noticias


class _Resp:
    def __init__(self, status: int, cuerpo: str = "") -> None:
        self.status_code = status
        self.content = cuerpo.encode("utf-8")


def _item(titulo: str, hace_dias: float, fuente: str = "Reuters") -> str:
    fecha = format_datetime(datetime.now(UTC) - timedelta(days=hace_dias), usegmt=True)
    return (f"<item><title>{titulo} - {fuente}</title><pubDate>{fecha}</pubDate>"
            f"<source url='https://x.test'>{fuente}</source></item>")


def _feed(*items: str) -> str:
    return "<rss><channel><title>Google News</title>" + "".join(items) + "</channel></rss>"


@pytest.fixture(autouse=True)
def _sin_esperas(monkeypatch):  # noqa: ANN001
    monkeypatch.setattr(noticias._ritmo, "esperar", lambda rps: None)
    noticias.reiniciar()


def _servir(monkeypatch, *respuestas: _Resp):  # noqa: ANN001
    vistas: list[dict] = []
    cola = list(respuestas)

    def _get(url, params=None, **kw):  # noqa: ANN001, ANN003
        vistas.append(params)
        r = cola.pop(0) if len(cola) > 1 else cola[0]
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(noticias.httpx, "get", _get)
    return vistas


@pytest.mark.parametrize("nombre,esperado", [
    ("Apple Inc.", "Apple"),
    ("DoubleVerify Holdings, Inc.", "DoubleVerify"),
    ("The Baldwin Insurance Group, In", "Baldwin Insurance"),
    ("Roku, Inc.", "Roku"),
    ("Block, Inc.", "Block"),
    ("Vertex Pharmaceuticals Incorpor", "Vertex Pharmaceuticals"),
    ("Teledyne Technologies Incorpora", "Teledyne Technologies"),
    ("Holdings", "Holdings"),
    ("", ""),
    (None, ""),
])
def test_nombre_de_busqueda_sin_articulo_ni_terminacion_legal(nombre, esperado) -> None:  # noqa: ANN001
    assert noticias.nombre_busqueda(nombre) == esperado


def test_consulta_con_ventana_de_dias_o_con_fechas() -> None:
    assert noticias._consulta("Roku", None, None, 14) == '"Roku" when:14d'
    assert noticias._consulta("DV", None, None, 14) == '"DV" (stock OR shares) when:14d'
    q = noticias._consulta("Roku", date(2026, 10, 1), date(2026, 10, 31), 14)
    assert q == '"Roku" after:2026-10-01 before:2026-11-01'


def test_deja_solo_titulares_de_la_empresa_dentro_de_la_ventana(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(200, _feed(
        _item("Roku sues over $22 billion takeover", 3),
        _item("Roku, Inc. (ROKU) Stock Price, News, Quote & History", 1, "Yahoo Finance"),
        _item("Newsmax unwinds a deal", 2),                       # no nombra a la empresa
        _item("Roku cuts guidance", 40),                           # fuera de ventana
        _item("Roku CEO steps down", 5, "Stock Titan"),            # fuente descartada
        _item("Roku rises as analysts raise estimates", 6, "Men's Journal"),
        _item("Roku sues over $22 billion takeover", 4, "Bloomberg"),  # repetido
        _item("Streamer news today (ROKU)", 7),                    # entra por el ticker
    )))

    out = noticias.titulares("ROKU", "Roku, Inc.")

    assert [x[11:] for x in out] == [
        "Roku sues over $22 billion takeover - Reuters",
        "Roku rises as analysts raise estimates - Men's Journal",
        "Streamer news today (ROKU) - Reuters",
    ]
    assert out[0].startswith(f"{(datetime.now(UTC) - timedelta(days=3)):%Y-%m-%d} ")
    assert noticias.resumen()["con_noticias"] == 1


def test_nombre_corriente_solo_admite_titulares_de_empresa(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(200, _feed(
        _item("Solo bitcoin miner wins a block reward", 1, "The Block"),
        _item("Block cuts 10% of staff in third layoff", 2),
        _item("Block, Inc. (XYZ) hits a new high", 3),
        _item("Early Black Friday deals on Block party speakers", 1),
    )))

    out = noticias.titulares("XYZ", "Block, Inc.")

    assert [x[11:] for x in out] == [
        "Block cuts 10% of staff in third layoff - Reuters",
        "Block, Inc. (XYZ) hits a new high - Reuters",
    ]


def test_nombre_de_varias_palabras_no_exige_contexto(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(200, _feed(_item("Baldwin Insurance Group shareholder alert", 1),
                                          _item("Baldwin Insurance opens a new office", 2))))

    assert len(noticias.titulares("BWIN", "The Baldwin Insurance Group, In")) == 2


def test_respeta_el_maximo_de_titulares(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(200, _feed(*[_item(f"Roku stock move {i}", i + 1)
                                            for i in range(12)])))
    assert len(noticias.titulares("ROKU", "Roku, Inc.", max_items=3)) == 3


def test_con_fechas_explicitas_acota_por_ellas(monkeypatch) -> None:  # noqa: ANN001
    hoy = datetime.now(UTC).date()
    vistas = _servir(monkeypatch, _Resp(200, _feed(
        _item("Roku stock dentro", 2), _item("Roku stock fuera", 20))))

    out = noticias.titulares("ROKU", "Roku", desde=hoy - timedelta(days=5), hasta=hoy)

    assert len(out) == 1 and "dentro" in out[0]
    assert "after:" in vistas[0]["q"] and "when:" not in vistas[0]["q"]


def test_reintenta_un_429_y_acaba_dando_titulares(monkeypatch) -> None:  # noqa: ANN001
    vistas = _servir(monkeypatch, _Resp(429), _Resp(200, _feed(_item("Roku stock gana", 1))))

    out = noticias.titulares("ROKU", "Roku")

    assert len(out) == 1 and len(vistas) == 2
    assert noticias.resumen()["fallos"] == {}


def test_un_fallo_persistente_se_cuenta_y_se_avisa(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(503))
    for _ in range(25):
        assert noticias.titulares("ROKU", "Roku") == []

    r = noticias.resumen()
    assert r["fallos"] == {"HTTP 503": 25} and r["con_noticias"] == 0
    assert "0/25" in noticias.incidencia()


def test_un_error_de_red_no_lanza_y_queda_contado(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, httpx.ConnectTimeout("lento"))

    assert noticias.titulares("ROKU", "Roku") == []
    assert noticias.resumen()["fallos"] == {"ConnectTimeout": 1}


def test_sin_nombre_no_hay_peticion(monkeypatch) -> None:  # noqa: ANN001
    vistas = _servir(monkeypatch, _Resp(200, _feed()))

    assert noticias.titulares("ZZZ", None) == []
    assert vistas == [] and noticias.resumen()["sin_nombre"] == 1


def test_empresa_sin_noticias_no_es_un_fallo(monkeypatch) -> None:  # noqa: ANN001
    _servir(monkeypatch, _Resp(200, _feed()))
    for _ in range(25):
        noticias.titulares("ROKU", "Roku")
    noticias.reiniciar()
    _servir(monkeypatch, _Resp(200, _feed(_item("Roku stock gana", 1))))
    for _ in range(20):
        noticias.titulares("ROKU", "Roku")

    assert noticias.incidencia() is None
