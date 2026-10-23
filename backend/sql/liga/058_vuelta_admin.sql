set lock_timeout = '5s'; set statement_timeout = '30s';

create view liga.v_admin_vuelta with (security_invoker = true) as
with primeras as (
  select e.dueno_id as usuario_id,
         min(j.dia_inicio)::timestamp as primera
  from liga.estrategias e
  join liga.inscripciones i on i.estrategia_id = e.id
  join liga.jornadas j on j.id = i.jornada_id
  where e.tipo = 'usuario' and i.estado in ('formada', 'cerrada')
  group by e.dueno_id
), cuentas as (
  select p.creado, f.primera,
         ((f.primera + interval '14 days') at time zone 'Europe/Madrid') <= now() as madura_2,
         ((f.primera + interval '21 days') at time zone 'Europe/Madrid') <= now() as madura_3,
         exists (select 1 from liga.visitas v where v.usuario_id = p.id
                 and v.inicio >= ((f.primera + interval '7 days') at time zone 'Europe/Madrid')
                 and v.inicio < ((f.primera + interval '14 days') at time zone 'Europe/Madrid')) as visita_2,
         exists (select 1 from liga.visitas v where v.usuario_id = p.id
                 and v.inicio >= ((f.primera + interval '14 days') at time zone 'Europe/Madrid')
                 and v.inicio < ((f.primera + interval '21 days') at time zone 'Europe/Madrid')) as visita_3
  from liga.perfiles p left join primeras f on f.usuario_id = p.id
  where (select liga.es_admin())
)
select date_trunc('week', creado at time zone 'Europe/Madrid')::date as semana,
       count(primera)::integer as jugaron,
       (count(*) filter (where madura_2))::integer as base_2,
       (count(*) filter (where madura_2 and visita_2))::integer as vuelven_2,
       (count(*) filter (where madura_3))::integer as base_3,
       (count(*) filter (where madura_3 and visita_3))::integer as vuelven_3
from cuentas
group by 1;

revoke all on liga.v_admin_vuelta from public, anon;
grant select on liga.v_admin_vuelta to authenticated;
