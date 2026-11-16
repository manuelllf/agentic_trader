"""Tubería de Brave: sin clave no hay buscador; con clave, tope diario y gasto apuntado. Sin red."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import busqueda, herramientas
from app.agente.config import ajustes

HOY = date(2026, 11, 17)


def test_sin_clave_no_hay_buscador_y_la_herramienta_lo_dice(
        sesion_agente: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "brave_clave", "")
    assert busqueda.buscador(sesion_agente, HOY, None) is None
    r = herramientas.ejecutar(sesion_agente, "news", {"query": "ASML"},
                              herramientas.Contexto(hoy=HOY))
    assert r == {"error": "web search not configured"}


def test_cada_busqueda_se_apunta_y_hay_tope_diario(sesion_agente: Session,
                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "brave_clave", "clave")
    monkeypatch.setattr(ajustes, "busquedas_dia_max", 2)
    monkeypatch.setattr(ajustes, "coste_busqueda_usd", Decimal("0.003"))
    pedidas: list[str] = []

    def falso(q: str, frescura: str) -> list[dict]:
        pedidas.append(q)
        return [{"title": "t", "url": f"https://x.test/{q}", "description": "d"}]
    buscar = busqueda.buscador(s, HOY, None, pedir=falso)
    assert buscar is not None
    ctx = herramientas.Contexto(hoy=HOY, buscar=buscar)
    assert herramientas.ejecutar(s, "news", {"query": "a"}, ctx)["results"][0]["source"] == "x.test"
    herramientas.ejecutar(s, "news", {"query": "b"}, ctx)
    tercera = herramientas.ejecutar(s, "news", {"query": "c"}, ctx)
    assert "daily search limit" in tercera["error"]
    assert pedidas == ["a", "b"]
    s.flush()
    fila = s.execute(text("select count(*), sum(coste_usd) from agente.gasto "
                          "where tipo = 'busqueda'")).one()
    assert (fila[0], fila[1]) == (2, Decimal("0.006"))


def test_brave_manda_la_clave_y_lee_los_resultados(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "brave_clave", "secreta")
    visto: dict = {}

    def get(url: str, **kw: object) -> httpx.Response:
        visto.update(url=url, **kw)
        return httpx.Response(200, request=httpx.Request("GET", url), json={"results": [
            {"title": "Uno", "url": "https://a.test/1", "description": "d1",
             "page_age": "2026-11-14T09:00:00"},
            {"title": "Sin enlace"}]})
    monkeypatch.setattr(httpx, "get", get)
    assert busqueda.brave("ASML results") == [
        {"title": "Uno", "url": "https://a.test/1", "description": "d1",
         "published": "2026-11-14T09:00:00"}]
    assert visto["params"]["freshness"] == "pm"
    busqueda.brave("ASML results", "week")
    assert visto["params"]["freshness"] == "pw"
    with pytest.raises(ValueError, match="freshness"):
        busqueda.brave("ASML results", "siglo")
    assert visto["url"] == busqueda.URL
    assert visto["headers"]["X-Subscription-Token"] == "secreta"
    assert visto["timeout"] == ajustes.timeout_busqueda_s
