"""Demo de la portada: orden por tamaño, mapa en hexadecimal y rutas públicas."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.liga import portada_demo, rutas_aprender
from app.liga.db import db_anon
from app.liga.estrategias import Contexto
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import NotasJev


def _paga(ticker, cap, **extra):
    return EmpresaFoto(ticker, nombre=f"{ticker} Inc", sector="Utilities", precio=10,
                       market_cap_usd=cap, dividend_yield_pct=4, payout_pct=50,
                       deuda_total=0, caja_total=1, ebitda=1, **extra)


def _contexto():
    empresas = (
        _paga("C", 5e9), _paga("B", 300e9), EmpresaFoto("D", precio=10),
        _paga("A", 300e9), EmpresaFoto("S", market_cap_usd=9e12),
        EmpresaFoto("E", nombre="E", precio=10, market_cap_usd=1.5e9),
        EmpresaFoto("F", precio=10, market_cap_usd=-3),
    )
    notas = {e.ticker: NotasJev(9, 8, 7, 6) for e in empresas}
    return Contexto(7, 11, False, empresas, notas)


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    portada_demo._cache.clear()
    monkeypatch.setattr(portada_demo.estrategias, "contexto_de_referencia", _contexto)
    monkeypatch.setattr(portada_demo, "_notas_del", lambda scan: "2026-11-01T00:00:00+00:00")
    monkeypatch.setattr(portada_demo, "_semana", lambda db: None)
    yield
    portada_demo._cache.clear()


def test_orden_por_capitalizacion_con_empate_por_ticker():
    ordenadas = portada_demo.ordenar(_contexto().empresas)
    assert [e.ticker for e in ordenadas] == ["A", "B", "C", "E", "D", "F"]


@pytest.mark.parametrize("pasan", [set(), {"A"}, {"A", "B", "C", "E"}, {"B", "E", "F"}])
def test_mapa_se_decodifica_como_el_frontend(pasan):
    ordenadas = portada_demo.ordenar(_contexto().empresas)
    mapa = portada_demo.codificar_mapa(ordenadas, pasan)
    assert len(mapa) == 2
    for i, e in enumerate(ordenadas):
        assert (int(mapa[i >> 2], 16) >> (3 - (i & 3))) & 1 == (e.ticker in pasan)


def test_mapa_exacto():
    ordenadas = portada_demo.ordenar(_contexto().empresas)
    assert portada_demo.codificar_mapa(ordenadas, {"A", "C", "F"}) == "a4"
    assert portada_demo.codificar_mapa(ordenadas[:1], {"A"}) == "8"


def test_portada_estilos_anillos_y_cinco():
    datos = portada_demo.portada(None, "es")
    assert (datos.foto_id, datos.total, datos.notas_del) == (
        7, 6, "2026-11-01T00:00:00+00:00")
    assert [(a.musd, a.rango) for a in datos.anillos] == [(100000, 2), (10000, 2), (1000, 4)]
    assert set(datos.estilos) == set(portada_demo.ESTILOS)
    div = datos.estilos["dividendo"]
    assert div.pasan == 3
    assert div.mapa == "e0"
    assert [c.ticker for c in div.cinco] == ["A", "B", "C"]
    assert [c.rango for c in div.cinco] == [0, 1, 2]
    assert div.cinco[0].nombre == "A Inc"
    assert div.cinco[0].nota == round(div.cinco[0].nota, 1) > 10
    assert [r.clave for r in div.reglas] == ["dividendo", "payout", "deuda"]
    assert all(r.detalle for r in div.reglas)
    assert div.reglas[0].params["dividendo_pct"] == 3


def test_nota_de_los_cinco_va_de_0_a_100():
    datos = portada_demo.portada(None, "es")
    assert all(0 <= c.nota <= 100 for e in datos.estilos.values() for c in e.cinco)


def test_idioma_desconocido_cae_a_es_y_se_cachea_por_idioma():
    es = portada_demo.portada(None, "fr")
    assert portada_demo.portada(None, "es") is es
    assert portada_demo.portada(None, "en") is not es
    assert len([k for k in portada_demo._cache if k[0] == "portada"]) == 2


def test_cache_caduca(monkeypatch):
    reloj = [0.0]
    monkeypatch.setattr(portada_demo.time, "monotonic", lambda: reloj[0])
    primera = portada_demo.portada(None, "es")
    assert portada_demo.portada(None, "es") is primera
    reloj[0] = 601
    assert portada_demo.portada(None, "es") is not primera


def test_empresa_de_rango():
    e = portada_demo.empresa_de_rango(2)
    assert (e.rango, e.ticker, e.nombre, e.musd, e.sector) == (2, "C", "C Inc", 5000, "Utilities")
    assert portada_demo.empresa_de_rango(4).musd is None
    assert portada_demo.empresa_de_rango(6) is None


@pytest.fixture
def cliente():
    app = FastAPI()
    app.include_router(rutas_aprender.router, prefix="/liga")
    app.dependency_overrides[db_anon] = lambda: iter([None])
    with TestClient(app) as c:
        yield c


def test_ruta_portada(cliente):
    r = cliente.get("/liga/aprender/portada?idioma=en")
    assert r.status_code == 200
    assert r.json()["total"] == 6 and r.json()["semana"] is None
    assert "max-age=600" in r.headers["Cache-Control"]


def test_ruta_portada_sin_datos_da_503(cliente, monkeypatch):
    def falla():
        raise RuntimeError("sin foto")

    monkeypatch.setattr(portada_demo.estrategias, "contexto_de_referencia", falla)
    assert cliente.get("/liga/aprender/portada").status_code == 503


def test_ruta_empresa(cliente):
    r = cliente.get("/liga/aprender/portada/empresa/1")
    assert r.json() == {"rango": 1, "ticker": "B", "nombre": "B Inc", "musd": 300000.0,
                        "sector": "Utilities"}
    assert "max-age=600" in r.headers["Cache-Control"]
    assert cliente.get("/liga/aprender/portada/empresa/6").status_code == 404
    assert cliente.get("/liga/aprender/portada/empresa/-1").status_code == 422
