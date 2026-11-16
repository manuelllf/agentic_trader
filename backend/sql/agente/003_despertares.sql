-- agente_003 · Despertares que programa el propio agente: un día de bolsa futuro con su motivo.
-- Los topes (pendientes, nuevos por semana, horizonte) los aplica el servicio desde su config.
set lock_timeout = '5s'; set statement_timeout = '30s';

create table agente.despertares (
  id bigint generated always as identity primary key,
  -- Día de bolsa en que despierta, en la revisión de después del cierre.
  fecha_ny date not null,
  motivo text not null check (length(btrim(motivo)) between 1 and 500),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'hecho', 'cancelado')),
  -- Fecha del ciclo que lo pidió: con ella se cuenta el cupo semanal, cancelados incluidos.
  programado_el date not null,
  programado_en_ejecucion bigint references agente.ejecuciones (id),
  cerrado_en_ejecucion bigint references agente.ejecuciones (id),
  cancelado_motivo text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text,
  check (fecha_ny > programado_el),
  check (estado <> 'cancelado' or length(btrim(coalesce(cancelado_motivo, ''))) > 0)
);
-- Un único despertar pendiente por día: dos el mismo día serían el mismo ciclo.
create unique index despertares_pendiente_dia on agente.despertares (fecha_ny)
  where estado = 'pendiente';
create index despertares_programado_el on agente.despertares (programado_el);

create trigger traza before update on agente.despertares
  for each row execute function agente.tocar_auditoria();
