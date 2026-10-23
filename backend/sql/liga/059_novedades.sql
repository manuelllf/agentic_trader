-- Hoja «Desde tu última visita»: cuándo cerró la cuenta las novedades por última vez y las
-- lecturas propias que necesita backend/app/liga/novedades.py.
alter table liga.perfiles_privados add column novedades_vistas_en timestamptz;

comment on column liga.perfiles_privados.novedades_vistas_en is
  'Cuándo cerró la cuenta la hoja de novedades por última vez; null si nunca.';

-- Inicio de la última visita terminada de la cuenta (liga.visitas solo la lee el admin).
create function liga.visita_anterior() returns timestamptz
  language sql stable security definer set search_path to ''
as $$
  select v.inicio from liga.visitas as v
  where v.usuario_id = (select auth.uid())
    and v.ultima_actividad < clock_timestamp() - interval '30 minutes'
  order by v.inicio desc
  limit 1
$$;

-- Desde cuándo mirar las novedades: la última vez que se cerró la hoja o, si nunca, la última visita.
create function liga.novedades_desde() returns timestamptz
  language sql stable security definer set search_path to ''
as $$
  select coalesce(
    (select p.novedades_vistas_en from liga.perfiles_privados as p
     where p.id = (select auth.uid())),
    liga.visita_anterior())
$$;

create function liga.marcar_novedades_vistas() returns void
  language plpgsql security definer set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authenticated identity required' using errcode = '28000';
  end if;
  update liga.perfiles_privados
     set novedades_vistas_en = now(),
         actualizado_en = now(),
         actualizado_por = (select auth.uid())
   where id = (select auth.uid());
end;
$$;

-- Cambios de cartera de las estrategias propias desde una fecha (la auditoría solo la lee el admin).
create function liga.mis_cambios_desde(p_desde timestamptz)
  returns table (estrategia_id uuid, accion text, ticker text, jornada_id bigint, creada timestamptz)
  language sql stable security definer set search_path to ''
as $$
  select e.id, a.accion, a.detalle ->> 'ticker', (a.detalle ->> 'jornada_id')::bigint, a.creada
  from liga.auditoria as a
  join liga.estrategias as e on a.objeto = 'estrategia:' || e.id::text
  where e.dueno_id = (select auth.uid())
    and a.accion in ('cambios.quitar', 'cambios.recuperar', 'cambios.volver')
    and a.creada > p_desde
  order by a.creada, a.id
$$;

-- Precios de cierre de las empresas que la cuenta tiene en cartera y del índice de referencia, para
-- una ventana de fechas. public.precio_cierre solo la lee el admin.
create function liga.cierres_de_mis_posiciones(p_desde date, p_hasta date)
  returns table (ticker text, dia date, cierre numeric, dividendo numeric, split numeric)
  language sql stable security definer set search_path to ''
as $$
  select c.ticker, c.dia, c.cierre, c.dividendo, c.split
  from public.precio_cierre as c
  where c.dia between p_desde and p_hasta
    and (c.ticker = 'SPY' or c.ticker in (
      select p.ticker from liga.posiciones as p
      join liga.inscripciones as i on i.id = p.inscripcion_id
      join liga.estrategias as e on e.id = i.estrategia_id
      where e.dueno_id = (select auth.uid())))
  order by c.ticker, c.dia
$$;

revoke all on function liga.visita_anterior(), liga.novedades_desde(),
  liga.marcar_novedades_vistas(), liga.mis_cambios_desde(timestamptz),
  liga.cierres_de_mis_posiciones(date, date) from public, anon;
grant execute on function liga.visita_anterior(), liga.novedades_desde(),
  liga.marcar_novedades_vistas(), liga.mis_cambios_desde(timestamptz),
  liga.cierres_de_mis_posiciones(date, date) to authenticated;
