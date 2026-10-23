-- Registro de actividad de la liga para la pantalla pública: cambios de cartera de las estrategias
-- publicadas, en cada corte cerrado. El anónimo no lee liga.posiciones, así que va por función.
create function liga.actividad_publica(p_temporada bigint, p_limite integer)
  returns table (estrategia_id uuid, dia date, entradas text[], salidas text[])
  language sql stable security definer set search_path to ''
as $$
  with cortes as (
    select i.id as inscripcion_id, i.estrategia_id, j.dia_fin,
           lag(i.id) over (partition by i.estrategia_id order by j.dia_fin, j.id) as anterior_id
    from liga.inscripciones as i
    join liga.jornadas as j on j.id = i.jornada_id
    join liga.estrategias as e on e.id = i.estrategia_id
    where j.temporada_id = p_temporada and j.estado = 'cerrada'
      and e.tipo = 'usuario' and e.visibilidad = 'publicada' and not e.oculta
  ), carteras as (
    select inscripcion_id, array_agg(ticker order by ticker) as valores
    from liga.posiciones group by inscripcion_id
  )
  select c.estrategia_id, c.dia_fin,
         array(select t from unnest(actual.valores) as t
               where not (t = any(coalesce(anterior.valores, '{}')))) as entradas,
         array(select t from unnest(anterior.valores) as t
               where not (t = any(actual.valores))) as salidas
  from cortes as c
  join carteras as actual on actual.inscripcion_id = c.inscripcion_id
  join carteras as anterior on anterior.inscripcion_id = c.anterior_id
  where array_length(array(select t from unnest(actual.valores) as t
                           where not (t = any(anterior.valores))), 1) is not null
     or array_length(array(select t from unnest(anterior.valores) as t
                           where not (t = any(actual.valores))), 1) is not null
  order by c.dia_fin desc, c.estrategia_id
  limit p_limite
$$;

revoke all on function liga.actividad_publica(bigint, integer) from public;
grant execute on function liga.actividad_publica(bigint, integer) to anon, authenticated;
