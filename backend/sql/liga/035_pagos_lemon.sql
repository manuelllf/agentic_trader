-- liga_035 · Pagos con Lemon Squeezy. `eventos_pago` guarda la huella de cada webhook recibido (así
-- un reenvío no se aplica dos veces) y `compras_pago` la última versión de cada suscripción o pedido
-- (así un evento viejo no pisa uno nuevo). Solo escribe el sistema; el usuario lee sus compras.
create table liga.eventos_pago (
  clave text primary key,
  evento text not null,
  lemon_id text,
  recibido_en timestamptz not null default now(),
  procesado_en timestamptz,
  estado text not null check (estado in ('recibido', 'aplicado', 'ignorado', 'rechazado'))
);
create index ix_eventos_pago_lemon on liga.eventos_pago (lemon_id) where lemon_id is not null;

create table liga.compras_pago (
  lemon_id text primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  producto text not null check (producto in ('mensual', 'media_temporada', 'temporada', 'pack_liga')),
  estado text not null,
  actualizado_lemon timestamptz not null,
  actualizado_local timestamptz not null default now()
);
create index ix_compras_pago_usuario on liga.compras_pago (usuario_id);

alter table liga.eventos_pago enable row level security;
alter table liga.compras_pago enable row level security;

revoke all on liga.eventos_pago from authenticated, anon;
grant select on liga.compras_pago to authenticated;
create policy dueno_lee on liga.compras_pago for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_lee on liga.compras_pago for select to authenticated
  using ((select liga.es_admin()));
