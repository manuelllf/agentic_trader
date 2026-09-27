-- B4 · La foto con identidad y publicación atómica (docs/liguilla/cambios-bbdd.md).
-- Cada captura lanzada desde Alpha nace `capturando` y se cierra de golpe con una sola sentencia
-- (`completa`, `cortada` o `fallida`). Quien necesite una foto entera filtra `completa` y nunca ve
-- una a medias. Las capturas sueltas de un escaneo y las anteriores a esto quedan con foto_id NULL.
create table public.foto (
  id bigint generated always as identity primary key,
  alcance text not null check (alcance in ('nasdaq', 'global')),
  inicio timestamptz not null default now(),
  fin timestamptz,
  estado text not null default 'capturando'
    check (estado in ('capturando', 'completa', 'cortada', 'fallida')),
  pedidos integer check (pedidos >= 0),
  capturados integer check (capturados >= 0),
  constraint foto_fin_segun_estado check ((estado = 'capturando') = (fin is null))
);
alter table public.foto enable row level security;

-- Solo una foto capturando a la vez (el proceso ya lo impide; la BD también).
create unique index ux_foto_una_capturando on public.foto ((true)) where estado = 'capturando';

alter table public.fundamentals_snapshot add column foto_id bigint references public.foto (id);
create index ix_fundamentals_snapshot_foto on public.fundamentals_snapshot (foto_id, ticker)
  where foto_id is not null;
