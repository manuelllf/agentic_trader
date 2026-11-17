-- agente_007 · Universo de empresas cotizadas, para que `search_universe` las encuentre por nombre,
-- sector o industria. Solo identifica empresas: sus cifras se piden con `price` y `fundamentals`.
set lock_timeout = '5s'; set statement_timeout = '30s';

-- Una fila por empresa. Es una copia hecha una vez: `fuente_fecha` dice de qué día son los datos.
create table agente.universo (
  ticker text primary key check (ticker ~ '^[A-Z0-9.\-]{1,12}$'),
  nombre text not null,
  sector text,
  industria text,
  capitalizacion_usd numeric check (capitalizacion_usd is null or capitalizacion_usd >= 0),
  fuente_fecha date not null,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

create trigger traza before update on agente.universo
  for each row execute function agente.tocar_auditoria();

revoke all on agente.universo from public;
