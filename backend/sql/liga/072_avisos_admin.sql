-- liga_072 · Avisos guardados del admin (la campana del panel). Cada aviso se guarda antes de salir
-- por push o correo; se guarda el tipo y sus datos, nunca el texto. Solo los inserta el backend.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table liga.avisos_admin (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo ~ '^[a-z0-9_]{1,64}$'),
  sala text not null check (sala in ('vennett', 'alpha', 'beta', 'omega', 'alphagentic')),
  datos jsonb not null default '{}'::jsonb check (octet_length(datos::text) <= 2000),
  leido_en timestamptz,
  leido_por uuid references auth.users (id) on delete set null,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null
);
create index avisos_admin_recientes on liga.avisos_admin (creado desc);

create trigger traza before update on liga.avisos_admin
  for each row execute function liga.tocar_auditoria();

alter table liga.avisos_admin enable row level security;
revoke all on table liga.avisos_admin from public, anon, authenticated;
grant select on table liga.avisos_admin to authenticated;
grant update (leido_en, leido_por) on table liga.avisos_admin to authenticated;

create policy admin_lee on liga.avisos_admin for select to authenticated
  using ((select liga.authorize('admin.salas'::liga.permiso)) and (select liga.aal2()));
create policy admin_marca on liga.avisos_admin for update to authenticated
  using ((select liga.authorize('admin.salas'::liga.permiso)) and (select liga.aal2()))
  with check ((select liga.authorize('admin.salas'::liga.permiso)) and (select liga.aal2()));
