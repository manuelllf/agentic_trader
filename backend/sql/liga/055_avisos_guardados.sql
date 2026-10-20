-- liga_055 · Avisos guardados de cada cuenta (el panel de la campana) y su zona horaria. Cada aviso
-- se guarda antes de salir por push o correo; se guarda el tipo y sus datos, nunca el texto. No se
-- borran: caducan y dejan de enseñarse.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table liga.avisos (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('cartera_lista', 'quitadas_vaciadas', 'sin_pregunta',
                                     'cambios_cierran', 'empieza', 'resumen_semanal',
                                     'resumen_cierre')),
  datos jsonb not null default '{}'::jsonb check (octet_length(datos::text) <= 2000),
  caduca timestamptz not null,
  leido_en timestamptz,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null
);
create index avisos_usuario_vigentes on liga.avisos (usuario_id, caduca, creado desc);

create trigger traza before update on liga.avisos
  for each row execute function liga.tocar_auditoria();

alter table liga.avisos enable row level security;
revoke all on table liga.avisos from public, anon, authenticated;
grant select on table liga.avisos to authenticated;
grant update (leido_en) on table liga.avisos to authenticated;

create policy propia_lee on liga.avisos for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy propia_marca on liga.avisos for update to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));

-- La zona horaria del navegador (IANA, p. ej. Europe/Madrid); vacía: Madrid.
alter table liga.perfiles_privados add column if not exists zona_horaria text
  check (zona_horaria is null or (length(zona_horaria) between 1 and 64
         and zona_horaria ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$'));
grant select (zona_horaria), update (zona_horaria) on liga.perfiles_privados to authenticated;
