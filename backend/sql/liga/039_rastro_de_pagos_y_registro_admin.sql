-- liga_039 · Los pagos llevan rastro de creación y de cambio. El registro de webhooks lo lee solo el admin.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table liga.eventos_pago add column if not exists creado_por uuid default auth.uid()
  references auth.users (id) on delete set null;

alter table liga.compras_pago add column if not exists creado timestamptz not null default now();
alter table liga.compras_pago add column if not exists creado_por uuid default auth.uid()
  references auth.users (id) on delete set null;
alter table liga.compras_pago add column if not exists actualizado_por uuid
  references auth.users (id) on delete set null;
drop trigger if exists traza on liga.compras_pago;
create trigger traza before update on liga.compras_pago
  for each row execute function liga.tocar_auditoria('actualizado_local', 'actualizado_por');

grant select on liga.eventos_pago to authenticated;
create policy admin_lee on liga.eventos_pago for select to authenticated
  using ((select liga.es_admin()));
