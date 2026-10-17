-- liga_050 · Foto de alertas y cinco huecos de Omega en la liga.
create table liga.omega_alertas (
  senal_id bigint primary key,
  ticker text not null,
  nace_en timestamptz not null,
  estado_origen text,
  market_cap_usd numeric,
  capturada_en timestamptz not null default now(),
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado_en timestamptz,
  actualizado_por uuid
);
alter table liga.omega_alertas enable row level security;
create policy admin on liga.omega_alertas for select
  to authenticated using (liga.es_admin());
grant select on liga.omega_alertas to authenticated;
create trigger traza before update on liga.omega_alertas
  for each row execute function liga.tocar_auditoria();

do $$
begin
  if not exists (select 1 from liga.jornadas where id = 1 and numero = 1 and estado = 'formada'
                 for update) then
    raise exception 'Jornada 1 no formada: no se toca nada';
  end if;
  insert into liga.auditoria (accion, objeto, detalle)
    select 'omega.respaldo_recalculo', 'jornada:1', coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
    from liga.omega_operaciones o where jornada_id = 1;
  delete from liga.omega_operaciones where jornada_id = 1;
end;
$$;

create unique index omega_operaciones_una_abierta
  on liga.omega_operaciones (jornada_id, numero) where salida_dia is null;
alter table liga.omega_operaciones drop constraint omega_operaciones_numero_check;
alter table liga.omega_operaciones add constraint omega_operaciones_numero_check
  check (numero between 1 and 5);

comment on table liga.omega_operaciones is
  'Cinco huecos independientes, sin capital.';
