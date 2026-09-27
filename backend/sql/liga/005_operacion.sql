-- liga_005 · Operación: ajustes, auditoría y reportes. Plan §13, §14 y §18.
-- Sin tabla de «jobs»: el estado de cada proceso es el del dominio (jornadas.estado, foto.estado,
-- scan_runs) y los procesos viven en código, controlados desde su sala.

-- Interruptores y parámetros de la liga (registro abierto, IA por finalidad, topes de gasto…).
create table liga.ajustes (
  clave text primary key check (clave ~ '^[a-z][a-z0-9_.]{2,59}$'),
  valor jsonb not null,
  actualizado timestamptz not null default now(),
  actualizado_por uuid references auth.users (id) on delete set null
);

create table liga.auditoria (
  id bigint generated always as identity primary key,
  actor_id uuid,                       -- sin FK: el rastro sobrevive a la baja de quien actuó
  accion text not null check (length(accion) between 3 and 60),
  objeto text check (length(objeto) <= 120),
  detalle jsonb not null default '{}',
  creada timestamptz not null default now()
);
create index ix_auditoria_creada on liga.auditoria (creada);
create trigger solo_anadir before update or delete on liga.auditoria
  for each row execute function liga.solo_anadir();

create table liga.reportes (
  id bigint generated always as identity primary key,
  autor_id uuid default auth.uid() references auth.users (id) on delete set null,
  tipo text not null check (tipo in ('alias', 'estrategia', 'liga', 'pregunta')),
  objeto_id text not null check (length(objeto_id) between 1 and 64),
  motivo text not null check (length(motivo) between 1 and 400),
  estado text not null default 'abierto' check (estado in ('abierto', 'resuelto', 'descartado')),
  creado timestamptz not null default now(),
  resuelto_por uuid references auth.users (id) on delete set null,
  resuelto timestamptz
);
create index ix_reportes_abiertos on liga.reportes (creado) where estado = 'abierto';
create index ix_reportes_autor on liga.reportes (autor_id);

alter table liga.ajustes enable row level security;
alter table liga.auditoria enable row level security;
alter table liga.reportes enable row level security;

-- ajustes: solo el admin (los públicos salen por la API ya filtrados).
grant select, insert, update on liga.ajustes to authenticated;
create policy admin on liga.ajustes for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

-- auditoría: la lee el admin; la escribe el sistema.
grant select on liga.auditoria to authenticated;
create policy admin_lee on liga.auditoria for select to authenticated
  using ((select liga.es_admin()));

-- reportes: cada uno manda y ve los suyos; moderación los lee y resuelve.
grant select on liga.reportes to authenticated;
grant insert (tipo, objeto_id, motivo) on liga.reportes to authenticated;
grant update (estado, resuelto_por, resuelto) on liga.reportes to authenticated;
create policy autor_lee on liga.reportes for select to authenticated
  using (autor_id = (select auth.uid()));
create policy autor_manda on liga.reportes for insert to authenticated
  with check (autor_id = (select auth.uid()) and (select liga.authorize('liga.jugar')));
create policy moderacion_lee on liga.reportes for select to authenticated
  using ((select liga.authorize('moderacion.revisar')));
create policy moderacion_resuelve on liga.reportes for update to authenticated
  using ((select liga.authorize('moderacion.revisar')))
  with check ((select liga.authorize('moderacion.revisar')));
create policy admin on liga.reportes for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

revoke execute on all functions in schema liga from public;
