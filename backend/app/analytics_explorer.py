"""Explorador de universo: filtro combinable (sector, país, mercado, market cap, PER...) sobre
las fotos de fundamentales ya capturadas (DuckDB, sincronizado a diario desde Postgres — ver
`app.analytics_sync`). Solo lectura, nada se persiste — es para mirar situaciones de mercado e
histórico, no para preparar un escaneo (ese universo sigue siendo el de siempre).

Los valores del filtro se LIGAN como parámetros reales de DuckDB (`execute(sql, params)`), nunca
interpolados en el texto — a diferencia de las 4 consultas fijas de `api/routes.py`, aquí el
valor lo escribe el usuario, así que no basta con el `int`/regex que bastaba allí.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Percentiles que se calculan sobre lo filtrado — mismo campo, tres cortes.
_DISTRIBUCION_CAMPOS = ("market_cap_usd", "price", "pe_trailing", "pe_forward")


@dataclass
class Filtros:
    """Todo opcional: sin nada puesto, la consulta es "todo lo capturado, última foto por
    ticker". `alcance` distingue universo de escaneo (NASDAQ) de universo global (HuggingFace) —
    `None` no filtra por esto, mezcla los dos (a propósito: mismo motivo por el que `pe-sector`
    SÍ filtra, aquí es el usuario quien decide, no una consulta fija con una sola intención)."""

    fecha_desde: str | None = None
    fecha_hasta: str | None = None
    alcance: bool | None = None          # `es_dataset`: True = global, False = escaneo, None = ambos
    sectores: list[str] = field(default_factory=list)
    industrias: list[str] = field(default_factory=list)
    paises: list[str] = field(default_factory=list)
    mercados: list[str] = field(default_factory=list)     # exchange
    q: str | None = None                  # ticker o nombre, texto libre
    market_cap_min: float | None = None
    market_cap_max: float | None = None
    price_min: float | None = None
    price_max: float | None = None
    pe_trailing_min: float | None = None
    pe_trailing_max: float | None = None
    pe_forward_min: float | None = None
    pe_forward_max: float | None = None
    cerca_max_pct: float | None = None    # % máx. de distancia al high_52w (10 = dentro del 10%)


def _validar_fecha(f: str | None, campo: str) -> None:
    if f is not None and not _FECHA_RE.fullmatch(f):
        raise ValueError(f"{campo} debe tener forma YYYY-MM-DD")


def _rango(col: str, lo: float | None, hi: float | None, clauses: list[str], params: list) -> None:
    if lo is not None:
        clauses.append(f"{col} >= ?")
        params.append(lo)
    if hi is not None:
        clauses.append(f"{col} <= ?")
        params.append(hi)


def _in_list(col: str, valores: list[str], clauses: list[str], params: list) -> None:
    valores = [v for v in valores if v]
    if not valores:
        return
    marcas = ", ".join("?" for _ in valores)
    clauses.append(f"{col} in ({marcas})")
    params.extend(valores)


def construir_snapshot_where(f: Filtros) -> tuple[str, list]:
    """WHERE + parámetros para la CTE `snap` (todo lo que vive en `fundamentals_snapshot`,
    ANTES del join a `universe_ticker`). Devuelve `("1=1", [])` sin filtros, nunca cadena vacía
    — así siempre se puede anteponer `and` sin comprobar si es la primera cláusula."""
    _validar_fecha(f.fecha_desde, "fecha_desde")
    _validar_fecha(f.fecha_hasta, "fecha_hasta")

    clauses: list[str] = []
    params: list = []
    if f.fecha_desde:
        clauses.append("captured_at >= ?::timestamp")
        params.append(f.fecha_desde)
    if f.fecha_hasta:
        # Hasta el FINAL de ese día — comparar contra la fecha a secas dejaría fuera lo
        # capturado esa misma tarde (captured_at lleva hora).
        clauses.append("captured_at < ?::timestamp + interval 1 day")
        params.append(f.fecha_hasta)
    if f.alcance is not None:
        clauses.append("es_dataset = ?")
        params.append(f.alcance)
    _in_list("sector", f.sectores, clauses, params)
    _in_list("industry", f.industrias, clauses, params)
    if f.q:
        clauses.append("(ticker ilike ? or name ilike ?)")
        comodin = f"%{f.q}%"
        params.extend([comodin, comodin])
    _rango("market_cap_usd", f.market_cap_min, f.market_cap_max, clauses, params)
    _rango("price", f.price_min, f.price_max, clauses, params)
    _rango("pe_trailing", f.pe_trailing_min, f.pe_trailing_max, clauses, params)
    _rango("pe_forward", f.pe_forward_min, f.pe_forward_max, clauses, params)
    if f.cerca_max_pct is not None:
        # % por debajo del máximo de 52 semanas — NULL si high_52w es 0/ausente, se descarta solo.
        clauses.append(
            "(high_52w - price) / nullif(high_52w, 0) * 100 <= ? "
            "and high_52w is not null and price is not null"
        )
        params.append(f.cerca_max_pct)
    return (" and ".join(clauses) if clauses else "1=1"), params


def construir_universo_where(f: Filtros) -> tuple[str, list]:
    """WHERE + parámetros para lo que solo vive en `universe_ticker` (país, mercado) — se aplica
    DESPUÉS del join, porque esos campos no existen en `fundamentals_snapshot`."""
    clauses: list[str] = []
    params: list = []
    _in_list("country", f.paises, clauses, params)
    _in_list("exchange", f.mercados, clauses, params)
    return (" and ".join(clauses) if clauses else "1=1"), params


def _query_base(f: Filtros) -> tuple[str, list]:
    snap_where, snap_params = construir_snapshot_where(f)
    uni_where, uni_params = construir_universo_where(f)
    sql = f"""
        with snap as (
            select distinct on (ticker) ticker, captured_at, name, sector, industry, currency,
                   price, market_cap_usd, pe_trailing, pe_forward, high_52w, low_52w
            from fundamentals_snapshot
            where {snap_where}
            order by ticker, captured_at desc
        ),
        u as (
            select distinct on (ticker) ticker, country, exchange
            from universe_ticker
            order by ticker, synced_at desc
        )
        select snap.*, u.country, u.exchange
        from snap left join u on u.ticker = snap.ticker
        where {uni_where}
    """
    return sql, snap_params + uni_params


def query_contar(f: Filtros) -> tuple[str, list]:
    """Recuento + distribuciones (mediana y percentiles 25/75) sobre lo filtrado."""
    base_sql, params = _query_base(f)
    percentiles = ", ".join(
        f"median({c}) as {c}_p50, "
        f"quantile_cont({c}, 0.25) as {c}_p25, "
        f"quantile_cont({c}, 0.75) as {c}_p75"
        for c in _DISTRIBUCION_CAMPOS
    )
    sql = f"with filtrado as ({base_sql}) select count(*) as total, {percentiles} from filtrado"
    return sql, params


def query_tickers(f: Filtros, limit: int, offset: int) -> tuple[str, list]:
    """Tabla paginada de resultados, ordenada por market cap (los nombres grandes primero,
    misma intuición que un screener financiero cualquiera)."""
    base_sql, params = _query_base(f)
    sql = (
        f"with filtrado as ({base_sql}) select * from filtrado "
        "order by market_cap_usd desc nulls last limit ? offset ?"
    )
    return sql, [*params, limit, offset]


def query_total(f: Filtros) -> tuple[str, list]:
    """Total de filas SIN paginar — para que `query_tickers` sepa cuántas páginas hay."""
    base_sql, params = _query_base(f)
    return f"with filtrado as ({base_sql}) select count(*) as total from filtrado", params


def _abrir(db_path: str):  # noqa: ANN001
    """Mismo patrón que `_run_analytics_query` en `api/routes.py`: fichero DuckDB persistente,
    solo lectura, una conexión por llamada (no hay servidor detrás, es un fichero en disco)."""
    import os

    import duckdb

    if not os.path.exists(db_path):
        raise FileNotFoundError(
            "Analítica sin sincronizar todavía — lanza POST /admin/sync-analytics primero."
        )
    return duckdb.connect(db_path, read_only=True)


def _limpio(v):  # noqa: ANN001, ANN201
    """DuckDB-vía-pandas devuelve NaN/NaT para NULL, no None — JSON no entiende NaN. Mismo
    problema, ningún otro sitio del código lo tenía porque `_run_analytics_query` nunca
    devolvía columnas con huecos reales (agregados con `group by`, siempre completos)."""
    if v is None:
        return None
    if isinstance(v, float) and v != v:   # NaN != NaN, más barato que importar math/pandas aquí
        return None
    return v.isoformat() if hasattr(v, "isoformat") else v


def contar(db_path: str, f: Filtros) -> dict:
    """Recuento + distribuciones — una sola fila con todo dentro."""
    sql, params = query_contar(f)
    con = _abrir(db_path)
    try:
        fila = con.execute(sql, params).df().to_dict("records")[0]
    finally:
        con.close()
    total = int(fila.pop("total"))
    distribuciones = {}
    for campo in _DISTRIBUCION_CAMPOS:
        p50 = _limpio(fila[f"{campo}_p50"])
        if p50 is None:
            continue
        distribuciones[campo] = {
            "p25": _limpio(fila[f"{campo}_p25"]), "p50": p50, "p75": _limpio(fila[f"{campo}_p75"]),
        }
    return {"total": total, "distribuciones": distribuciones}


def tickers(db_path: str, f: Filtros, limit: int, offset: int) -> dict:
    """Página de resultados + total real (no el tamaño de esta página)."""
    sql, params = query_tickers(f, limit, offset)
    total_sql, total_params = query_total(f)
    con = _abrir(db_path)
    try:
        filas = con.execute(sql, params).df().to_dict("records")
        total = int(con.execute(total_sql, total_params).fetchone()[0])
    finally:
        con.close()
    items = [{k: _limpio(v) for k, v in fila.items()} for fila in filas]
    return {"items": items, "total": total}


def opciones(db_path: str) -> dict[str, list[str]]:
    """Valores para poblar los desplegables del filtro."""
    con = _abrir(db_path)
    try:
        return {
            clave: [r[0] for r in con.execute(sql).fetchall()]
            for clave, sql in query_opciones().items()
        }
    finally:
        con.close()


def query_opciones() -> dict[str, str]:
    """Valores distintos para poblar los desplegables del filtro (sector/industria de
    `fundamentals_snapshot`, país/mercado de `universe_ticker`) — sin filtrar por lo demás
    puesto: mismo criterio que un buscador de filtros normal, no facetado."""
    return {
        "sectores": (
            "select distinct sector from fundamentals_snapshot "
            "where sector is not null and trim(sector) not in ('', 'n/d') order by 1"
        ),
        "industrias": (
            "select distinct industry from fundamentals_snapshot "
            "where industry is not null and trim(industry) not in ('', 'n/d') order by 1"
        ),
        "paises": (
            "select distinct country from universe_ticker "
            "where country is not null and trim(country) != '' order by 1"
        ),
        "mercados": (
            "select distinct exchange from universe_ticker "
            "where exchange is not null and trim(exchange) != '' order by 1"
        ),
    }
