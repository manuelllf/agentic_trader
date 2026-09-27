-- B1 · Logprobs fuera de Postgres (docs/liguilla/cambios-bbdd.md).
-- Comprobado antes: las 424.361 filas están en DuckDB (/data/analytics.duckdb, anti-join a 0) y
-- en la copia pg_dump del 27-sep. La tabla vacía se queda por si vuelve E[score].
truncate table public.llm_call_logprob;
