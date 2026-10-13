-- liga_043 · Datos de hoy para una estrategia: como mucho una actualización por semana y cuenta, y las
-- notas y respuestas de hoy como caché compartida de un día, sin datos personales. El día 1 y la foto
-- no leen nada de esto. Las notas y respuestas se borran a los 8 días desde el propio proceso.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table liga.actualizaciones (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  estado text not null check (estado in ('en_curso', 'hecha', 'fallida')),
  total int not null check (total between 1 and 300),
  hechas int not null default 0,
  pregunta_hash text check (pregunta_hash ~ '^[0-9a-f]{64}$'),
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  constraint hechas_en_rango check (hechas between 0 and total)
);
create index ix_actualizaciones_usuario on liga.actualizaciones (usuario_id, creado_en desc);
create trigger tocar before update on liga.actualizaciones
  for each row execute function liga.tocar_auditoria();

create table liga.notas_frescas (
  ticker varchar(16) not null,
  dia date not null,                          -- día de mercado en Nueva York
  jev_fundamentals smallint not null,
  jev_valuation smallint not null,
  jev_financing smallint not null,
  jev_catalyst smallint not null,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  primary key (ticker, dia)
);

create table liga.respuestas_frescas (
  pregunta_hash text not null check (pregunta_hash ~ '^[0-9a-f]{64}$'),
  ticker varchar(16) not null,
  dia date not null,
  si boolean not null,
  seguridad text not null check (seguridad in ('alta', 'media', 'baja')),
  llm_call_id bigint,
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  primary key (pregunta_hash, ticker, dia)
);

alter table liga.actualizaciones enable row level security;
alter table liga.notas_frescas enable row level security;
alter table liga.respuestas_frescas enable row level security;

grant select, insert on liga.actualizaciones to authenticated;
create policy propias on liga.actualizaciones for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy crear on liga.actualizaciones for insert to authenticated
  with check (usuario_id = (select auth.uid()));
create policy admin on liga.actualizaciones for select to authenticated
  using ((select liga.es_admin()));

grant select on liga.notas_frescas, liga.respuestas_frescas to authenticated;
create policy admin on liga.notas_frescas for select to authenticated
  using ((select liga.es_admin()));
create policy admin on liga.respuestas_frescas for select to authenticated
  using ((select liga.es_admin()));
