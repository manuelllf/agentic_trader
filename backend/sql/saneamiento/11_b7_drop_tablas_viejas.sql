-- 11: B7 fase final. Las métricas y los titulares de cada foto viven ya en su propia fila
-- (`fundamentals_snapshot.metricas` / `.titulares`), comparados valor a valor con estas dos tablas
-- antes de borrarlas. El histórico podado sigue en el archivo DuckDB (copia aparte en el volumen).
-- Sin CASCADE: si algo dependiera de ellas, esto falla en vez de arrastrarlo.
drop table public.fundamentals_snapshot_metric, public.fundamentals_snapshot_news;
