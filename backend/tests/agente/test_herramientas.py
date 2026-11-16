"""Herramientas del agente: caminos importantes y fallos que protegen datos."""

from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import text

from app.agente import datos, herramientas, libro, vigia
from app.agente.herramientas import Contexto, ejecutar

HOY = date(2026, 6, 30)


def _barras(n: int, ultimo: str = "120") -> list[datos.Barra]:
    out = []
    for i in range(n):
        dia = HOY - timedelta(days=n - 1 - i)
        c = Decimal(ultimo) - Decimal(n - 1 - i) * Decimal("0.1")
        out.append(datos.Barra(dia, c, c, c, c, 1000, Decimal("0"), Decimal("1")))
    return out


def _sembrar(s, ticker: str, barras: list[datos.Barra]) -> None:
    libro.guardar_precios(s, ticker, [
        (b.dia, b.apertura, b.maximo, b.minimo, b.cierre, b.volumen) for b in barras])


def test_price_con_precios_sembrados(sesion_agente):
    _sembrar(sesion_agente, "AAA", _barras(260))
    r = ejecutar(sesion_agente, "price", {"ticker": " aaa "}, Contexto(hoy=HOY))
    assert r["ticker"] == "AAA"
    assert r["last_close"] == 120.0
    assert r["last_date"] == HOY.isoformat()
    assert r["change_1d"] == round(120 / 119.9 - 1, 4)
    assert r["ma50"] is not None and r["ma200"] is not None
    assert -1 < r["drawdown_from_1y_high"] <= 0


def test_price_sin_filas_usa_el_descargador(sesion_agente, monkeypatch):
    llamadas = []

    def falso(tickers, desde):
        llamadas.append((tickers, desde))
        return {"BBB": _barras(30, "50")}

    monkeypatch.setattr(herramientas, "_descargar", falso)
    r = ejecutar(sesion_agente, "price", {"ticker": "BBB"}, Contexto(hoy=HOY))
    assert llamadas == [(["BBB"], HOY - timedelta(days=400))]
    assert r["last_close"] == 50.0
    n = sesion_agente.execute(
        text("select count(*) from agente.precios where ticker = 'BBB'")).scalar_one()
    assert n == 30


def test_valuation_usa_el_ultimo_cierre_guardado(sesion_agente):
    _sembrar(sesion_agente, "AAA", _barras(5, "100"))
    r = ejecutar(sesion_agente, "valuation",
                 {"ticker": "AAA", "scenarios": [{"name": "base", "eps": 10, "pe": 20}],
                  "target_margin": 0.25}, Contexto(hoy=HOY))
    assert (r["price"], r["price_date"]) == (100.0, HOY.isoformat())
    assert r["expected_value_today"] == 124.18
    assert r["price_for_target_margin"] == round(124.18 * 0.75, 2)


def test_valuation_con_escenarios_rotos_devuelve_error(sesion_agente):
    _sembrar(sesion_agente, "AAA", _barras(5, "100"))
    r = ejecutar(sesion_agente, "valuation", {"ticker": "AAA", "scenarios": [{"eps": 1}]},
                 Contexto(hoy=HOY))
    assert r["error"].startswith("ValueError")


def test_fundamentals_corta_si_yahoo_no_contesta(sesion_agente, monkeypatch):
    import threading

    from app.agente.config import ajustes
    suelta = threading.Event()
    monkeypatch.setattr(ajustes, "timeout_yahoo_s", 0.2)

    def colgado(ticker):
        suelta.wait(5)
        return {}
    try:
        r = ejecutar(sesion_agente, "fundamentals", {"ticker": "AAA"},
                     Contexto(hoy=HOY, fundamentales=colgado))
    finally:
        suelta.set()
    assert r["error"].startswith("TimeoutError")


def test_solo_lectura_bloquea_las_que_escriben(sesion_agente):
    ctx = Contexto(hoy=HOY, solo_lectura=True)
    r = ejecutar(sesion_agente, "watch", {"ticker": "AAA", "reason": "r"}, ctx)
    assert r == {"error": "read-only run: tools that write are disabled"}
    assert "error" not in ejecutar(sesion_agente, "watchlist", {}, ctx)


def test_portfolio_con_libro_vacio(sesion_agente):
    libro.abrir_libro(sesion_agente, HOY)
    r = ejecutar(sesion_agente, "portfolio", {}, Contexto(hoy=HOY))
    assert r["cash"] == 5000.0 and r["positions"] == [] and r["mode"] == "normal"
    assert r["limits"]["max_posiciones"] == 5


def test_fundamentals_marca_dato_externo(sesion_agente):
    ctx = Contexto(hoy=HOY, fundamentales=lambda t: {"shortName": t, "trailingPE": 12.5})
    r = ejecutar(sesion_agente, "fundamentals", {"ticker": "CCC"}, ctx)
    assert r["external_data"] is True and r["source"] == "yahoo"
    assert r["trailingPE"] == 12.5


def test_card_write_dos_veces_sube_version_y_deja_evento(sesion_agente):
    ctx = Contexto(hoy=HOY)
    r1 = ejecutar(sesion_agente, "card_write",
                  {"ticker": "DDD", "content": {"tesis": "uno"}, "certainty": "conjetura"}, ctx)
    r2 = ejecutar(sesion_agente, "card_write",
                  {"ticker": "DDD", "content": {"tesis": "dos"}, "certainty": "confirmada"}, ctx)
    assert (r1["version"], r2["version"]) == (1, 2)
    lectura = ejecutar(sesion_agente, "card_read", {"ticker": "DDD"}, ctx)
    assert lectura["content"] == {"tesis": "dos"} and lectura["version"] == 2
    ev = sesion_agente.execute(text(
        "select origen, datos from agente.eventos where tipo = 'ficha_reescrita' "
        "and ticker = 'DDD'")).all()
    assert len(ev) == 1 and ev[0].origen == "memoria"
    assert ev[0].datos["version"] == 1 and ev[0].datos["contenido"] == {"tesis": "uno"}


def _con_precios(monkeypatch, tickers_con_datos):
    """Yahoo falso: solo devuelve barras para los tickers indicados."""
    def falso(tickers, desde):
        return {t: [1] for t in tickers if t in tickers_con_datos}
    monkeypatch.setattr(herramientas, "_descargar", falso)


def test_watch_rechaza_un_ticker_sin_precios(sesion_agente, monkeypatch):
    _con_precios(monkeypatch, {"EEE"})
    ctx = Contexto(hoy=HOY)
    r = ejecutar(sesion_agente, "watch", {"ticker": "ZZZQ", "reason": "inventado"}, ctx)
    assert r["error"].startswith("ValueError") and "ZZZQ" in r["error"]
    lista = ejecutar(sesion_agente, "watchlist", {}, ctx)["watching"]
    assert all(x["ticker"] != "ZZZQ" for x in lista)


def test_watch_con_niveles_legibles_por_el_vigia(sesion_agente, monkeypatch):
    _con_precios(monkeypatch, {"EEE"})
    ctx = Contexto(hoy=HOY)
    niveles = [{"price": 95.5, "direction": "down", "reason": "rompe soporte"},
               {"price": 130, "direction": "up", "reason": "objetivo"}]
    r = ejecutar(sesion_agente, "watch",
                 {"ticker": "EEE", "reason": "vigilar", "levels": niveles}, ctx)
    assert r["watching"] is True
    lista = ejecutar(sesion_agente, "watchlist", {}, ctx)["watching"]
    guardado = next(x for x in lista if x["ticker"] == "EEE")
    leidos = vigia.niveles_desde_json("EEE", guardado["levels"])
    assert [(n.precio, n.direccion, n.motivo) for n in leidos] == [
        (Decimal("95.5"), "abajo", "rompe soporte"), (Decimal("130"), "arriba", "objetivo")]
    ejecutar(sesion_agente, "unwatch", {"ticker": "EEE", "reason": "ya no"}, ctx)
    lista = ejecutar(sesion_agente, "watchlist", {}, ctx)["watching"]
    assert all(x["ticker"] != "EEE" for x in lista)


def test_news_sin_buscador_y_con_buscador_sin_duplicar(sesion_agente):
    assert ejecutar(sesion_agente, "news", {"query": "x"}, Contexto(hoy=HOY)) == {
        "error": "web search not configured"}
    resultados = [{"title": "Sube", "url": "https://www.ejemplo.com/a", "description": "d" * 700}]
    frescuras: list[str] = []
    ctx = Contexto(hoy=HOY, buscar=lambda q, f: frescuras.append(f) or resultados)
    for _ in range(2):
        r = ejecutar(sesion_agente, "news", {"query": "x"}, ctx)
        assert r["external_data"] is True and len(r["results"]) == 1
    assert r["freshness"] == "month" and r["results"][0]["published"] is None
    assert len(r["results"][0]["summary"]) == 240
    ejecutar(sesion_agente, "news", {"query": "x", "freshness": "week"}, ctx)
    assert frescuras == ["month", "month", "week"]
    mal = ejecutar(sesion_agente, "news", {"query": "x", "freshness": "hoy"}, ctx)
    assert "freshness must be one of" in mal["error"] and len(frescuras) == 3
    fila = sesion_agente.execute(text(
        "select fuente, length(resumen) as n from agente.noticias "
        "where url = 'https://www.ejemplo.com/a'")).all()
    assert len(fila) == 1 and fila[0].fuente == "www.ejemplo.com" and fila[0].n == 500


def test_ejecutar_nunca_lanza(sesion_agente, monkeypatch):
    ctx = Contexto(hoy=HOY)
    assert "error" in ejecutar(sesion_agente, "no_existe", {}, ctx)
    assert "error" in ejecutar(sesion_agente, "price", {"ticker": "A B;C"}, ctx)
    assert "missing" in ejecutar(sesion_agente, "price", {}, ctx)["error"]

    def roto(tickers, desde):
        raise RuntimeError("sin red")

    monkeypatch.setattr(herramientas, "_descargar", roto)
    r = ejecutar(sesion_agente, "price", {"ticker": "ZZZ"}, ctx)
    assert r == {"error": "RuntimeError: sin red"}
    # La sesión sigue utilizable tras el fallo.
    assert sesion_agente.execute(text("select 1")).scalar_one() == 1


def test_salida_se_recorta_a_4000(sesion_agente):
    ctx = Contexto(hoy=HOY)
    ejecutar(sesion_agente, "card_write",
             {"ticker": "FFF", "content": {"tesis": "x" * 6000}, "certainty": "conjetura"}, ctx)
    r = ejecutar(sesion_agente, "card_read", {"ticker": "FFF"}, ctx)
    assert r["truncated"] is True and len(r["data"]) == 4000
    assert len(json.dumps(r)) < 4100
    assert "card_write" in herramientas.describir()
    assert "[WRITES]" in herramientas.describir()
