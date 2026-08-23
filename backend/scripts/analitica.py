"""Consultas analíticas sobre la BD de producción con DuckDB (`postgres_scanner`).

DuckDB lee Postgres directamente — una sola fuente de verdad, sin copiar datos a ningún sitio
ni mantener dos esquemas en sincronía. Nada de Clickhouse: el volumen real cabe de sobra.

Requiere el extra `analytics` (`uv sync --extra analytics --extra postgres`) y una
`DATABASE_URL` de Postgres. Read-only.

Uso (desde backend/):
    uv run python scripts/analitica.py                 # todas las consultas base
    uv run python scripts/analitica.py pe_por_sector   # solo una
    uv run python scripts/analitica.py --sql "select 1" # una consulta suelta
"""

from __future__ import annotations

import os
import sys

# La consola de Windows va en cp1252 y DuckDB dibuja sus planes con caracteres de caja: sin esto
# un EXPLAIN revienta el script entero con UnicodeEncodeError.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Consultas base. Se apoyan en las tablas nuevas de la fase de observabilidad
# (`llm_call`, `fundamentals_snapshot`) además de las de siempre.
CONSULTAS: dict[str, str] = {
    "coste_por_etapa": """
        select stage,
               count(*)                                     as llamadas,
               round(sum(cost_usd)::numeric, 4)             as usd,
               round(avg(latency_ms))                       as ms_medios,
               round(100.0 * sum(prompt_cache_hit_tokens)
                     / nullif(sum(prompt_cache_hit_tokens
                                  + prompt_cache_miss_tokens), 0), 1) as cache_hit_pct,
               sum(case when not ok then 1 else 0 end)      as fallos
        from pg.llm_call
        group by stage
        order by usd desc
    """,
    # La mediana propia del sector, calculada sobre el MISMO campo con el que se puntúa
    # (`trailingPE` de yfinance) — no un agregado de una fuente externa (ver C.4 del plan).
    "pe_por_sector": """
        with ultima as (
            select distinct on (ticker) ticker, sector, pe_trailing
            from pg.fundamentals_snapshot
            where pe_trailing is not null and pe_trailing > 0
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
    # La pregunta de C.1: ¿el embudo se estrecha hacia los que están cerca de máximos?
    "distancia_al_maximo_por_etapa": """
        with ultima as (
            select distinct on (ticker) ticker, price, high_52w, captured_at
            from pg.fundamentals_snapshot
            where price is not null and high_52w > 0
            order by ticker, captured_at desc
        ),
        embudo as (
            select a.ticker,
                   case when a.funded then 'cartera'
                        when a.selected then 'seleccionado'
                        when a.reached_deep then 'profundo'
                        else 'prescoreado' end as etapa
            from pg.scan_audit a
            where a.scan_at = (select max(scan_at) from pg.scan_audit)
        )
        select e.etapa,
               count(*)                                                   as nombres,
               round(avg(100.0 * (1 - u.price / u.high_52w))::numeric, 1) as pct_bajo_maximo
        from embudo e join ultima u using (ticker)
        group by e.etapa
        order by pct_bajo_maximo
    """,
    # El ruido medido del prescore (~5,5 puntos de sd) visto desde la confianza persistida.
    "confianza_prescore": """
        select round(confidence::numeric, 1) as confianza,
               count(*)                      as llamadas
        from pg.llm_call
        where stage = 'prescore' and confidence is not null
        group by 1
        order by 1
    """,
}


def conectar(database_url: str):  # noqa: ANN201
    import duckdb

    con = duckdb.connect()
    con.execute("install postgres; load postgres;")
    # El driver de SQLAlchemy no lo entiende libpq: se quita el "+psycopg" del esquema.
    dsn = database_url.replace("postgresql+psycopg://", "postgresql://")
    con.execute(f"attach '{dsn}' as pg (type postgres, read_only)")
    return con


def main() -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith(("postgresql", "postgres")):
        print("DATABASE_URL tiene que apuntar a Postgres para esto.")
        return 1

    args = sys.argv[1:]
    con = conectar(url)
    if args and args[0] == "--sql":
        print(con.execute(args[1]).df().to_string(index=False))
        return 0

    nombres = args or list(CONSULTAS)
    for nombre in nombres:
        sql = CONSULTAS.get(nombre)
        if sql is None:
            print(f"No existe la consulta '{nombre}'. Hay: {', '.join(CONSULTAS)}")
            return 1
        print(f"\n-- {nombre} " + "-" * (60 - len(nombre)))
        try:
            print(con.execute(sql).df().to_string(index=False))
        except Exception as exc:  # noqa: BLE001 — una consulta rota no tira las demás
            print(f"  (falló: {exc})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
