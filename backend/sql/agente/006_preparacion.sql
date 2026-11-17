-- agente_006 · Preparación antes del despertar: precios y fundamentales de la watchlist ya guardados.
-- Así el agente despierta con los datos cargados y `screen` le enseña las empresas enteras.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table agente.ejecuciones drop constraint ejecuciones_tarea_check;
alter table agente.ejecuciones add constraint ejecuciones_tarea_check
  check (tarea in ('vigia_previo', 'ejecucion', 'preparacion', 'despertar', 'consolidacion'));

-- Una fila por empresa, sobrescrita cada día: el histórico que importa ya está en los precios.
create table agente.fundamentales (
  ticker text primary key check (ticker ~ '^[A-Z0-9.\-]{1,12}$'),
  -- Día de Nueva York en que se descargaron.
  fecha_ny date not null,
  -- Lo que devuelve la fuente, tal cual: es dato externo, no instrucciones.
  datos jsonb not null,
  fuente text not null default 'yahoo',
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

create trigger traza before update on agente.fundamentales
  for each row execute function agente.tocar_auditoria();

revoke all on agente.fundamentales from public;
