-- B2 rápido · Universo global sin la tanda repetida (docs/liguilla/cambios-bbdd.md).
-- Las tandas del 26-ago y del 1-sep traen las mismas 54.037 filas del dataset (mismos tickers,
-- nombres, mercados, ISIN, sector y país); la del 1-sep tiene además 29 símbolos de Yahoo más
-- resueltos. Todos los lectores usan la última tanda.
delete from public.universe_ticker where synced_at < '2026-08-31';

-- Aparte y fuera de transacción: devuelve el espacio al momento (bloquea la tabla unos segundos).
-- vacuum full public.universe_ticker;
