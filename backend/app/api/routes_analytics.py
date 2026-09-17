"""Analitica columnar (DuckDB leyendo Postgres sincronizado, solo lectura): coste/latencia
por etapa, mediana de PE por sector, confianza del prescore, y el explorador de universo."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import utc_iso

router = APIRouter()          # exige require_auth (montado en app/api/routes.py)


_ANALYTICS_QUERIES: dict[str, str] = {
    "coste-etapa": """
        select stage,
               count(*)                                     as llamadas,
               round(sum(cost_usd)::numeric, 4)             as usd,
               round(avg(latency_ms))                       as ms_medios,
               round(100.0 * sum(prompt_cache_hit_tokens)
                     / nullif(sum(prompt_cache_hit_tokens
                                  + prompt_cache_miss_tokens), 0), 1) as cache_hit_pct,
               sum(case when not ok then 1 else 0 end)      as fallos
        from llm_call
        {where}
        group by stage
        order by usd desc
    """,
    # `es_dataset = false`: SOLO la foto del universo de escaneo. Sin este filtro entraban los
    # ~34.000 del universo global y la mediana pasaba a ser la del mundo entero (Technology:
    # 33,9 con NASDAQ, 28,6 mezclado) — otra pregunta distinta, no la que responde este panel.
    "pe-sector": """
        with ultima as (
            select distinct on (ticker) ticker, sector, pe_trailing
            from fundamentals_snapshot
            where pe_trailing is not null and pe_trailing > 0
              and es_dataset = false
              and coalesce(lower(trim(sector)), '') not in ('', 'n/d', 'none', 'null')
            {and_fecha}
            order by ticker, captured_at desc
        )
        select sector,
               count(*)                                       as nombres,
               round(median(pe_trailing)::numeric, 2)         as mediana_pe
        from ultima
        group by sector
        having count(*) >= 6
        order by mediana_pe desc
    """,
    "pe-sector-fechas": """
        select distinct strftime(captured_at::date, '%Y-%m-%d') as fecha
        from fundamentals_snapshot
        where pe_trailing is not null and pe_trailing > 0 and es_dataset = false
        order by fecha desc
        limit 60
    """,
    "confianza-prescore": """
        select round(confidence::numeric, 1) as confianza,
               count(*)                      as llamadas
        from llm_call
        where stage = 'prescore' and confidence is not null
        {and_scan}
        group by 1
        order by 1
    """,
}


def _run_analytics_query(nombre: str, scan_run_id: int | None = None,
                         fecha: str | None = None) -> list[dict]:
    """Abre el fichero DuckDB persistente (columnar de verdad, sincronizado desde Postgres por
    `app.analytics_sync.sync()` — ver ese módulo y `POST /admin/sync-analytics`) en modo
    solo-lectura y ejecuta una de las consultas predefinidas. Los datos son tan frescos como la
    última sincronización, no en vivo — trade-off aceptado: esta analítica no necesita el
    segundo exacto, y a cambio no depende de Postgres estar despierto para responder.

    `scan_run_id` filtra `coste-etapa`/`confianza-prescore` a un único escaneo — sin él, agregan
    TODA la vida de `llm_call` (todos los escaneos históricos mezclados). `pe-sector` lo ignora:
    no depende de escaneo, usa el snapshot más reciente por ticker (o el de `fecha` si se pide).
    El valor llega tipado `int` desde FastAPI (`Query(None)`), así que es seguro interpolarlo en
    el SQL de DuckDB; `fecha` se valida a mano (YYYY-MM-DD) por el mismo motivo."""
    import os
    import re

    import duckdb

    from app.analytics_sync import default_path

    db_path = default_path()
    if not os.path.exists(db_path):
        raise HTTPException(
            503, "Analítica sin sincronizar todavía — lanza POST /admin/sync-analytics primero.")
    sql = _ANALYTICS_QUERIES[nombre]
    if "{where}" in sql:
        clause = f"where scan_run_id = {int(scan_run_id)}" if scan_run_id is not None else ""
        sql = sql.format(where=clause)
    elif "{and_scan}" in sql:
        clause = f"and scan_run_id = {int(scan_run_id)}" if scan_run_id is not None else ""
        sql = sql.format(and_scan=clause)
    elif "{and_fecha}" in sql:
        if fecha is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
            raise HTTPException(400, "fecha inválida, formato YYYY-MM-DD")
        clause = f"and captured_at::date = '{fecha}'" if fecha is not None else ""
        sql = sql.format(and_fecha=clause)
    con = duckdb.connect(db_path, read_only=True)
    try:
        return con.execute(sql).df().to_dict("records")
    finally:
        con.close()


@router.get("/analytics/pe-sector")
def analytics_pe_sector(fecha: str | None = Query(None)) -> dict:
    """Mediana de `trailingPE` (yfinance) por sector, sobre el último snapshot de cada ticker del
    UNIVERSO DE ESCANEO — el mismo campo y el mismo universo con los que se puntúa, no un
    agregado de una fuente externa ni del universo global. `fecha` (YYYY-MM-DD, ver
    /analytics/pe-sector/fechas) fija el snapshot de ese día en vez del más reciente."""
    try:
        return {"items": _run_analytics_query("pe-sector", fecha=fecha)}
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — Postgres caído/ATTACH roto: mensaje legible, no 500
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/pe-sector/fechas")
def analytics_pe_sector_fechas() -> dict:
    """Fechas con snapshot disponible (hasta 60, más reciente primero) — para el navegador de
    `/analytics/pe-sector?fecha=`."""
    try:
        filas = _run_analytics_query("pe-sector-fechas")
        return {"items": [str(f["fecha"]) for f in filas]}
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/coste-etapa")
def analytics_coste_etapa(scan_run_id: int | None = Query(None)) -> dict:
    """Coste, latencia media y % de acierto de caché de las llamadas LLM, agrupado por etapa
    del embudo (macro/prescore/mid/deep/constructor). Sin `scan_run_id`, agrega TODA la vida de
    la tabla (todos los escaneos históricos mezclados); con él, un único escaneo."""
    try:
        return {"items": _run_analytics_query("coste-etapa", scan_run_id)}
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/confianza-prescore")
def analytics_confianza_prescore(scan_run_id: int | None = Query(None)) -> dict:
    """Distribución de la confianza persistida del prescore (el ruido medido, ~5,5 puntos de sd,
    visto desde lo que el propio LLM dice que sabe). Sin `scan_run_id`, agrega TODA la vida de
    la tabla; con él, un único escaneo."""
    try:
        return {"items": _run_analytics_query("confianza-prescore", scan_run_id)}
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/scans")
def analytics_scans(db: Session = Depends(get_db)) -> dict:
    """Últimos 50 escaneos (id, fecha, cadencia), para el navegador de `coste-etapa` y
    `confianza-prescore` por escaneo concreto. Consulta normal contra Postgres vía SQLAlchemy,
    no DuckDB — no hace falta para leer `scan_runs`."""
    from app.models import ScanRun

    rows = db.query(ScanRun).order_by(ScanRun.scan_at.desc()).limit(50).all()
    return {"items": [
        {"id": r.id, "at": utc_iso(r.scan_at), "cadence": r.cadence} for r in rows
    ]}


def _filtros_explorador(
    fecha_desde: str | None, fecha_hasta: str | None, alcance: str | None,
    sector: list[str], industria: list[str], pais: list[str], mercado: list[str],
    q: str | None, market_cap_min: float | None, market_cap_max: float | None,
    price_min: float | None, price_max: float | None,
    pe_trailing_min: float | None, pe_trailing_max: float | None,
    pe_forward_min: float | None, pe_forward_max: float | None,
    cerca_max_pct: float | None,
):
    """`alcance` llega como texto ("global"/"escaneo"/vacío) desde la URL — se traduce aquí al
    `bool | None` que espera `Filtros`, así el resto de la capa de datos no sabe de query params."""
    from app.analytics_explorer import Filtros

    mapa_alcance = {"global": True, "escaneo": False, None: None, "": None}
    if alcance not in mapa_alcance:
        raise HTTPException(400, "alcance debe ser 'global', 'escaneo' o vacío")
    try:
        return Filtros(
            fecha_desde=fecha_desde or None, fecha_hasta=fecha_hasta or None,
            alcance=mapa_alcance[alcance], sectores=sector, industrias=industria,
            paises=pais, mercados=mercado, q=q or None,
            market_cap_min=market_cap_min, market_cap_max=market_cap_max,
            price_min=price_min, price_max=price_max,
            pe_trailing_min=pe_trailing_min, pe_trailing_max=pe_trailing_max,
            pe_forward_min=pe_forward_min, pe_forward_max=pe_forward_max,
            cerca_max_pct=cerca_max_pct,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/analytics/explorar/opciones")
def analytics_explorar_opciones() -> dict:
    """Sectores/industrias/países/mercados con al menos una foto capturada — para poblar los
    desplegables del filtro, sin filtrar por lo demás puesto (mismo criterio que un buscador de
    filtros normal, no facetado)."""
    from app.analytics_explorer import opciones as opciones_fn
    from app.analytics_sync import default_path

    try:
        return opciones_fn(default_path())
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/explorar/contar")
def analytics_explorar_contar(
    fecha_desde: str | None = Query(None), fecha_hasta: str | None = Query(None),
    alcance: str | None = Query(None), sector: list[str] = Query([]),
    industria: list[str] = Query([]), pais: list[str] = Query([]), mercado: list[str] = Query([]),
    q: str | None = Query(None), market_cap_min: float | None = Query(None),
    market_cap_max: float | None = Query(None), price_min: float | None = Query(None),
    price_max: float | None = Query(None), pe_trailing_min: float | None = Query(None),
    pe_trailing_max: float | None = Query(None), pe_forward_min: float | None = Query(None),
    pe_forward_max: float | None = Query(None), cerca_max_pct: float | None = Query(None),
) -> dict:
    """Recuento en vivo + distribuciones (mediana, p25, p75) sobre el filtro pedido — el mismo
    patrón que ya usa el picker de foto global (`contar()` antes de gastar), aplicado a explorar
    el mercado en vez de a dimensionar una captura."""
    from app.analytics_explorer import contar as contar_fn
    from app.analytics_sync import default_path

    f = _filtros_explorador(
        fecha_desde, fecha_hasta, alcance, sector, industria, pais, mercado, q,
        market_cap_min, market_cap_max, price_min, price_max,
        pe_trailing_min, pe_trailing_max, pe_forward_min, pe_forward_max, cerca_max_pct,
    )
    try:
        return contar_fn(default_path(), f)
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc


@router.get("/analytics/explorar/tickers")
def analytics_explorar_tickers(
    fecha_desde: str | None = Query(None), fecha_hasta: str | None = Query(None),
    alcance: str | None = Query(None), sector: list[str] = Query([]),
    industria: list[str] = Query([]), pais: list[str] = Query([]), mercado: list[str] = Query([]),
    q: str | None = Query(None), market_cap_min: float | None = Query(None),
    market_cap_max: float | None = Query(None), price_min: float | None = Query(None),
    price_max: float | None = Query(None), pe_trailing_min: float | None = Query(None),
    pe_trailing_max: float | None = Query(None), pe_forward_min: float | None = Query(None),
    pe_forward_max: float | None = Query(None), cerca_max_pct: float | None = Query(None),
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
) -> dict:
    """Tabla paginada de resultados del mismo filtro que `/contar` — pensada para picotear
    nombres concretos una vez el recuento ya dice que la búsqueda tiene sentido."""
    from app.analytics_explorer import tickers as tickers_fn
    from app.analytics_sync import default_path

    f = _filtros_explorador(
        fecha_desde, fecha_hasta, alcance, sector, industria, pais, mercado, q,
        market_cap_min, market_cap_max, price_min, price_max,
        pe_trailing_min, pe_trailing_max, pe_forward_min, pe_forward_max, cerca_max_pct,
    )
    try:
        return tickers_fn(default_path(), f, limit, offset)
    except ImportError:
        raise HTTPException(503, "DuckDB no está instalado (extra `analytics` del backend).")
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"No se pudo consultar la analítica: {exc}") from exc

