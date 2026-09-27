-- B8 · El SPY sale de precio_cierre (con dividendos): la copia en cada punto de la curva sobra.
-- Solo tras desplegar 710767b, que ya no la lee ni la escribe.
alter table public.equity_snapshots drop column spy_close;
