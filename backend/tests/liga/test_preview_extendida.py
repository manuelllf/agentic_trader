from decimal import Decimal

import pytest

from app.liga import preview_seleccion as ruta
from app.liga.auth import Identidad
from app.liga.estrategias import Contexto
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import NotasJev


@pytest.fixture
def foto(monkeypatch):
    empresas = tuple(EmpresaFoto(t, precio=10, per=per, margen_operativo=margen,
                                sector=sector, market_cap_usd=cap * 1000000,
                                dividend_yield_pct=div, beta=1, crecimiento_ventas=.2)
                     for t, per, margen, sector, cap, div in (
                         ("AAA", 10, .3, "Technology", 300, 4),
                         ("BBB", 30, .3, "Healthcare", 2000, None),
                         ("CCC", 10, .1, "Financial Services", 10000, 0),
                         ("DDD", 30, .1, "Technology", 200000, 2)))
    ctx = Contexto(1, 2, False, empresas,
                   {e.ticker: NotasJev(Decimal(9), Decimal(6), Decimal(3), Decimal(0))
                    for e in empresas})
    monkeypatch.setattr(ruta.estrategias, "contexto_de_referencia", lambda: ctx)
    monkeypatch.setattr(ruta.estrategias, "respuestas_sistema", lambda *_: {})
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _: True)
    return ruta.PreviewSeleccionIn(
        reglas=[{"clave": "barata", "params": {"per": 20}},
                {"clave": "margen", "params": {"margen_pct": 20}}],
        pesos={"negocio": 40, "precio": 20, "deuda": 20, "pronto": 20, "pregunta": 0},
        n_empresas=3, reparto="igual", max_por_sector=0)


def preview(body):
    return ruta.previsualizar(body, Identidad(uid="fixture", aal="aal1", claims={}))


def test_vectores_y_perfil(foto, monkeypatch):
    llamadas = []
    seleccionar = ruta.seleccionar
    def contar(*args):
        llamadas.append(1)
        return seleccionar(*args)
    monkeypatch.setattr(ruta, "seleccionar", contar)
    salida = preview(foto)
    assert len(llamadas) == 1
    assert [(r["clave"], r["sola"], r["sin_ella"]) for r in salida.por_regla] == [
        ("barata", 2, 2), ("margen", 2, 2)]
    assert all(r["detalle"] for r in salida.por_regla)
    assert salida.elegidas[0].mejor == "negocio"
    assert salida.elegidas[0].nota == 60
    assert salida.perfil["cartera"]["per"] == 10
    assert salida.perfil["mercado"]["per"] == 20
    assert salida.perfil["mercado"]["dividendo_medio"] == 1.5
    assert salida.perfil["tamanos"]["pequenas"] == 1
    assert salida.avisos == [
        {"codigo": "caja", "huecos": 2, "pct": 66.6667},
        {"codigo": "sin_sector", "sector": "Financial Services", "cuota": 25},
        {"codigo": "pocas", "n": 1}]


def test_concentracion_suprime_sin_sector(foto):
    salida = preview(foto.model_copy(update={"reglas": [], "excluidas": ["BBB", "CCC"]}))
    assert any(a["codigo"] == "concentracion" and a["sector"] == "Technology"
               for a in salida.avisos)
    assert not any(a["codigo"] == "sin_sector" for a in salida.avisos)


def test_sin_ella_ignora_solo_la_regla_y_no_las_exclusiones(foto):
    salida = preview(foto.model_copy(update={"excluidas": ["AAA"]}))
    assert salida.por_regla[0]["sola"] == 2
    assert salida.por_regla[0]["sin_ella"] == 2
    assert salida.elegidas == []
    assert salida.perfil["cartera"]["per"] is None
    assert salida.avisos[0] == {"codigo": "caja", "huecos": 3, "pct": 100}
