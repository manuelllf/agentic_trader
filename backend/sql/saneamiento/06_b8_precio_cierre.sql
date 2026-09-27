-- B8 · Precio de cierre canónico (docs/liguilla/cambios-bbdd.md).
-- Hechos en bruto por ticker y día de bolsa: el cierre tal como se negoció, el dividendo con fecha
-- ex ese día y el factor de split efectivo ese día. Nada ajustado: la rentabilidad, con o sin
-- dividendos, se calcula al leer. Solo tickers que estén en alguna cartera (libros y liga) y el
-- SPY, nunca el universo entero.
create table public.precio_cierre (
  ticker varchar(16) not null,
  dia date not null,
  cierre numeric(14,4) not null check (cierre > 0),
  dividendo numeric(12,6) not null default 0 check (dividendo >= 0),
  split numeric(10,6) not null default 1 check (split > 0),
  fuente varchar(16) not null,
  primary key (ticker, dia)
);
-- Sin lectura para anon ni authenticated: qué tickers hay aquí delataría carteras (la de la casa
-- no se enseña). Lo sirve el backend ya calculado.
alter table public.precio_cierre enable row level security;
