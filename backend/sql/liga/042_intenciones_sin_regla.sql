-- liga_042 · Lo que piden los usuarios y el conversor no traduce a una regla exacta (aproximada o no
-- disponible), guardado sin usuario ni frase para decidir qué añadir al catálogo. Solo lo escribe el
-- sistema; la cuenta no lee la tabla, solo la consola de admin.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table liga.intenciones_sin_regla (
  id bigint generated always as identity primary key,
  intencion text not null check (length(intencion) between 1 and 160),
  tipo text not null check (tipo in ('aproximada', 'no_disponible')),
  regla text,
  idioma text not null check (idioma in ('es', 'en')),
  creado_en timestamptz not null default now(),
  creado_por uuid default auth.uid()          -- NULL: la escribe el sistema, sin cuenta
);
create index ix_intenciones_sin_regla_creado on liga.intenciones_sin_regla (creado_en);

alter table liga.intenciones_sin_regla enable row level security;
grant select on liga.intenciones_sin_regla to authenticated;
create policy admin on liga.intenciones_sin_regla for select to authenticated
  using ((select liga.es_admin()));
