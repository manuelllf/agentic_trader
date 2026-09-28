-- Avisos de error: cuando algo falla, la persona puede pulsar «Reportar» y queda una nota para el
-- admin, con el código que vio (sale igual en el registro del servidor) y, si quiere, lo que
-- estaba haciendo. Solo escribe el backend (con límite por persona/IP); solo lee y resuelve el
-- admin. El contexto es técnico y pequeño (pantalla, navegador), nunca datos de la cuenta.
create table liga.avisos_error (
  id              bigint        generated always as identity primary key,
  codigo          text          check (codigo is null or length(codigo) <= 20),
  usuario_id      uuid          references auth.users (id) on delete set null,  -- null: sin sesión
  pantalla        text          not null check (length(pantalla) between 1 and 200),
  mensaje         text          not null check (length(mensaje) between 1 and 500),
  nota            text          check (nota is null or length(nota) <= 1000),
  contexto        jsonb         not null default '{}'::jsonb
                                check (octet_length(contexto::text) <= 2000),
  estado          text          not null default 'abierto' check (estado in ('abierto', 'resuelto')),
  creado          timestamptz   not null default now(),
  creado_por      uuid          references auth.users (id) on delete set null,
  actualizado_en  timestamptz,
  actualizado_por uuid          references auth.users (id) on delete set null
);
comment on table liga.avisos_error is
  'Errores que la gente reporta desde la web (o que llegan con su código). Solo admin.';
create index ix_avisos_error_estado on liga.avisos_error (estado, creado);

alter table liga.avisos_error enable row level security;
grant select, update (estado) on liga.avisos_error to authenticated;   -- nunca a anon
create policy admin on liga.avisos_error
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
-- Sin policy de insert: solo el backend (proceso de sistema) escribe.

create trigger traza before update on liga.avisos_error
  for each row execute function liga.tocar_auditoria();
