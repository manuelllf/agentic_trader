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
    r = ejecutar(sesion_agente, "price", {"ticker": " aaa "}, Contexto(hoy=HOY))["companies"][0]
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
    assert r["companies"][0]["last_close"] == 50.0
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
    # En un lote, la empresa que no contesta lleva su error y no tumba a las demás.
    assert r["companies"][0]["error"].startswith("TimeoutError")


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
    assert r["companies"][0]["trailingPE"] == 12.5


def test_price_y_fundamentals_por_lotes(sesion_agente):
    from app.agente.models import Fundamentales

    _sembrar(sesion_agente, "AAA", _barras(30, "50"))
    _sembrar(sesion_agente, "BBB", _barras(30, "80"))
    sesion_agente.add(Fundamentales(ticker="AAA", fecha_ny=HOY, datos={"forwardPE": 11.0}))
    leidas: list[str] = []
    ctx = Contexto(hoy=HOY, fundamentales=lambda t: leidas.append(t) or {"forwardPE": 30.0})
    precios = ejecutar(sesion_agente, "price", {"tickers": ["aaa", "BBB", "AAA"]}, ctx)
    assert [c["last_close"] for c in precios["companies"]] == [50.0, 80.0]
    f = ejecutar(sesion_agente, "fundamentals", {"tickers": ["AAA", "BBB"]}, ctx)["companies"]
    # AAA sale de la carga del día; BBB no estaba guardada y se pide a la fuente.
    assert (f[0]["forwardPE"], f[0]["data_date"]) == (11.0, HOY.isoformat())
    assert f[1]["forwardPE"] == 30.0 and leidas == ["BBB"]
    demasiadas = {"tickers": [f"T{i}" for i in range(21)]}
    assert ejecutar(sesion_agente, "price", demasiadas, ctx) == {
        "error": "at most 20 tickers per call"}
    assert "invalid tickers" in ejecutar(sesion_agente, "price", {"tickers": ["A;B"]}, ctx)["error"]


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


def test_screen_mira_solo_la_lista_de_seguimiento(sesion_agente):
    from app.agente.models import Seguimiento

    sesion_agente.add_all([Seguimiento(ticker="AAA", motivo="m"),
                           Seguimiento(ticker="BBB", motivo="m")])
    sesion_agente.flush()
    _sembrar(sesion_agente, "AAA", _barras(260))
    _sembrar(sesion_agente, "BBB", _barras(260))
    _sembrar(sesion_agente, "ZZZ", _barras(260))  # precios guardados pero no seguida: no entra
    ctx = Contexto(hoy=HOY)
    r = ejecutar(sesion_agente, "screen", {"sort": "rsi"}, ctx)
    assert r["universe"] == 2 and r["shown"] == 2
    assert sorted(x.split()[0] for x in r["rows"]) == ["AAA", "BBB"]
    # Los precios salen siempre; sin carga del día, los fundamentales van como n/a.
    assert all("n/a" not in " ".join(x.split()[:5]) for x in r["rows"])
    assert r["fundamentals_date"] is None
    assert "error" in ejecutar(sesion_agente, "screen", {"sort": "precio"}, ctx)


def _universo(s) -> None:
    from app.agente.models import Seguimiento, Universo

    base = date(2026, 9, 28)
    s.add_all([
        Universo(ticker="NVDA", nombre="NVIDIA Corporation", sector="Technology",
                 industria="Semiconductors", capitalizacion_usd=5_500_000_000_000,
                 fuente_fecha=base),
        Universo(ticker="TSM", nombre="Taiwan Semiconductor", sector="Technology",
                 industria="Semiconductors", capitalizacion_usd=1_000_000_000_000,
                 fuente_fecha=base),
        Universo(ticker="MSFT", nombre="Microsoft Corporation", sector="Technology",
                 industria="Software - Infrastructure", capitalizacion_usd=3_800_000_000_000,
                 fuente_fecha=base),
        Universo(ticker="META", nombre="Meta Platforms, Inc.", sector="Communication Services",
                 industria="Internet Content & Information", capitalizacion_usd=1_800_000_000_000,
                 fuente_fecha=base),
        Universo(ticker="NOIND", nombre="Sin Industria", fuente_fecha=base),
        Seguimiento(ticker="NVDA", motivo="m"),
    ])
    s.flush()


def test_search_universe_busca_por_nombre_sector_e_industria(sesion_agente):
    _universo(sesion_agente)
    ctx = Contexto(hoy=HOY)

    def buscar(**a):
        return ejecutar(sesion_agente, "search_universe", a, ctx)

    assert [x["ticker"] for x in buscar(query="nvid")["results"]] == ["NVDA"]
    assert [x["ticker"] for x in buscar(query="MSF")["results"]] == ["MSFT"]  # por ticker
    # La industria separa lo que el sector junta: NVDA y MSFT son Technology, no lo mismo.
    assert [x["ticker"] for x in buscar(industry="semicond")["results"]] == ["NVDA", "TSM"]
    assert [x["ticker"] for x in buscar(sector="technology")["results"]] == ["NVDA", "MSFT", "TSM"]
    solo_software = buscar(sector="technology", industry="software")["results"]
    assert [x["ticker"] for x in solo_software] == ["MSFT"]
    r = buscar(industry="semicond", limit=1)
    assert (r["matches"], r["shown"], r["as_of"]) == (2, 1, "2026-09-28")
    nvda = r["results"][0]
    assert (nvda["watching"], nvda["market_cap_usd_bn"]) == (True, 5500.0)
    assert nvda["industry"] == "Semiconductors"
    assert buscar(industry="semicond")["results"][1]["watching"] is False


def test_search_universe_los_comodines_no_son_comodines(sesion_agente):
    _universo(sesion_agente)
    r = ejecutar(sesion_agente, "search_universe", {"query": "%"}, Contexto(hoy=HOY))
    assert (r["matches"], r["results"]) == (0, [])


def test_search_universe_sin_argumentos_lista_sectores_e_industrias(sesion_agente):
    _universo(sesion_agente)
    r = ejecutar(sesion_agente, "search_universe", {}, Contexto(hoy=HOY))
    assert r["sectors"]["Technology"] == ["Semiconductors (2)", "Software - Infrastructure (1)"]
    assert r["sectors"]["Communication Services"] == ["Internet Content & Information (1)"]


def test_los_parametros_opcionales_los_dice_la_descripcion(sesion_agente):
    ctx = Contexto(hoy=HOY)
    # `query` es opcional en search_universe pero obligatoria en news.
    assert "missing parameters: query" in ejecutar(sesion_agente, "news", {}, ctx)["error"]
    assert "error" not in ejecutar(sesion_agente, "search_universe", {}, ctx)


def test_screen_no_presenta_como_actual_un_cierre_viejo(sesion_agente):
    from app.agente.models import Seguimiento

    sesion_agente.add_all([Seguimiento(ticker="AAA", motivo="m"),
                           Seguimiento(ticker="OLD", motivo="m")])
    sesion_agente.flush()
    _sembrar(sesion_agente, "AAA", _barras(260))
    # Sus cierres acaban hace 20 días: su precio ya no sirve para decidir.
    _sembrar(sesion_agente, "OLD", [b for b in _barras(260) if b.dia <= HOY - timedelta(days=20)])
    r = ejecutar(sesion_agente, "screen", {}, Contexto(hoy=HOY))
    assert [x.split()[0] for x in r["rows"]] == ["AAA"]
    assert r["stale_close"] == [f"OLD (último cierre {(HOY - timedelta(days=20)).isoformat()})"]


def test_screen_devuelve_las_102_con_sus_fundamentales_en_una_sola_respuesta(sesion_agente):
    from app.agente.models import Fundamentales, Seguimiento

    tickers = [f"T{i:03d}XY" for i in range(102)]
    sesion_agente.add_all([Seguimiento(ticker=t, motivo="m") for t in tickers])
    # Valores largos a propósito: es el peor caso de tamaño de la respuesta.
    completos = {"forwardPE": 123.456, "operatingMargins": -0.98765, "revenueGrowth": -0.98765,
                 "debtToEquity": 1234.567, "next_earnings_date": "2027-01-27 00:00:00",
                 "dividendYield_pct": 12.34, "marketCap": 1_000_000_000,
                 "freeCashflow": -123_000_000}
    sesion_agente.add_all([Fundamentales(ticker=t, fecha_ny=HOY, datos=completos) for t in tickers])
    sesion_agente.flush()
    for t in tickers:
        _sembrar(sesion_agente, t, _barras(260))
    r = ejecutar(sesion_agente, "screen", {}, Contexto(hoy=HOY))
    assert "truncated" not in r
    assert r["universe"] == 102 and r["shown"] == 102 and len(r["rows"]) == 102
    assert r["without_price_history"] == [] and r["fundamentals_date"] == HOY.isoformat()
    campos = r["rows"][0].split()
    assert len(campos) == len(r["columns"].split())
    assert campos[5:] == ["123.5", "-98.8", "-98.8", "1234.6", "2027-01-27", "12.3", "-12.3"]
