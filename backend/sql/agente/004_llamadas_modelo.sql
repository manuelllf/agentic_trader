-- agente_004 · Registro de cada llamada al modelo: qué se le envió, qué respondió y cómo razonó.
-- Solo se añade: es la prueba de por qué el agente decidió lo que decidió.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table agente.llamadas_modelo (
  id bigint generated always as identity primary key,
  ejecucion_id bigint references agente.ejecuciones (id),
  -- 'agente' es el bucle con herramientas; el resto son las llamadas de una sola vuelta.
  etapa text not null check (etapa ~ '^[a-z_]{1,40}$'),
  -- Vuelta dentro de la ejecución y la etapa, desde 1.
  paso integer not null check (paso >= 1),
  modelo text not null,
  -- Solo lo nuevo de esta vuelta: el contexto entero se repite en cada una y no se guarda.
  enviado jsonb not null default '[]'::jsonb,
  respuesta text,
  razonamiento text,
  herramientas_pedidas jsonb not null default '[]'::jsonb,
  coste_usd numeric check (coste_usd >= 0),
  latencia_ms integer check (latencia_ms >= 0),
  ok boolean not null default true,
  error text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);
create index llamadas_modelo_ejecucion on agente.llamadas_modelo (ejecucion_id, id);

create trigger solo_anadir before update or delete on agente.llamadas_modelo
  for each row execute function agente.solo_anadir();

revoke all on agente.llamadas_modelo from public;
