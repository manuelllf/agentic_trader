"""Búsqueda de noticias con la API de Brave: tiempo máximo, tope diario y gasto apuntado.
Sin `AGENTE_BRAVE_CLAVE` no hay buscador y la herramienta `news` lo dice."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente.config import ajustes
from app.agente.models import Gasto

URL = "https://api.search.brave.com/res/v1/news/search"
RESULTADOS = 6
PROVEEDOR = "brave"
# Antigüedad máxima que entiende Brave: día, semana, mes, año. Sin filtro devuelve noticias viejas
# que el agente podría tomar por actuales.
FRESCURAS = {"day": "pd", "week": "pw", "month": "pm", "year": "py"}
FRESCURA_DEFECTO = "month"

Buscar = Callable[[str, str], list[dict]]


class TopeDiario(ValueError):
    """Se han hecho ya las búsquedas permitidas hoy."""


def configurada() -> bool:
    return bool(ajustes.brave_clave)


def brave(consulta: str, frescura: str = FRESCURA_DEFECTO, n: int = RESULTADOS) -> list[dict]:
    """Una petición a Brave: {title, url, description, published}. Lanza si la API falla."""
    if frescura not in FRESCURAS:
        raise ValueError(f"freshness must be one of {', '.join(FRESCURAS)}")
    resp = httpx.get(URL, params={"q": consulta[:400], "count": n,
                                  "freshness": FRESCURAS[frescura]},
                     headers={"Accept": "application/json",
                              "X-Subscription-Token": ajustes.brave_clave},
                     timeout=ajustes.timeout_busqueda_s)
    resp.raise_for_status()
    out = []
    for r in (resp.json().get("results") or [])[:n]:
        if isinstance(r, dict) and r.get("url"):
            out.append({"title": r.get("title") or "", "url": r["url"],
                        "description": r.get("description") or "",
                        "published": r.get("page_age") or r.get("age") or None})
    return out


def hechas_hoy(s: Session, hoy: date) -> int:
    s.flush()
    return int(s.execute(text(
        "select coalesce(sum(unidades), 0) from agente.gasto "
        "where tipo = 'busqueda' and fecha_ny = :h"), {"h": hoy}).scalar_one())


def buscador(s: Session, hoy: date, ejecucion_id: int | None,
             pedir: Buscar = brave) -> Buscar | None:
    """Función para `Contexto.buscar`, o None si Brave no está configurado."""
    if not configurada():
        return None

    def buscar(consulta: str, frescura: str = FRESCURA_DEFECTO) -> list[dict]:
        if hechas_hoy(s, hoy) >= ajustes.busquedas_dia_max:
            raise TopeDiario(f"daily search limit reached ({ajustes.busquedas_dia_max})")
        resultados = pedir(consulta, frescura)
        s.add(Gasto(fecha_ny=hoy, tipo="busqueda", proveedor=PROVEEDOR, unidades=1,
                    coste_usd=ajustes.coste_busqueda_usd, ejecucion_id=ejecucion_id))
        s.flush()
        return resultados

    return buscar
