-- liga_056 · Vistas del panel de admin: altas por semana y su avance, visitas por día y las cuatro
-- consultas fijas. Solo leen lo que ya se guarda y solo devuelven filas a un admin.
set lock_timeout = '5s'; set statement_timeout = '30s';

-- Si la cuenta tiene un borrador del editor; los borradores solo los lee su dueño por RLS.
create function liga.tiene_borrador(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from liga.borradores b where b.usuario_id = p_id)
     and (select liga.es_admin());
$$;
revoke execute on function liga.tiene_borrador(uuid) from public, anon;
grant execute on function liga.tiene_borrador(uuid) to authenticated;

-- Cada semana de alta (lunes, hora de Madrid) y cuántas de esas cuentas llegaron a cada paso.
create view liga.v_admin_cohortes with (security_invoker = true) as
select date_trunc('week', p.creado at time zone 'Europe/Madrid')::date as semana,
       count(*) as altas,
       count(*) filter (where exists (
         select 1 from liga.estrategias e where e.dueno_id = p.id and e.tipo = 'usuario'))
         as con_estrategia,
       count(*) filter (where exists (
         select 1 from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
         where e.dueno_id = p.id and e.tipo = 'usuario')) as apuntadas,
       count(*) filter (where exists (
         select 1 from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
         where e.dueno_id = p.id and e.tipo = 'usuario' and i.estado in ('formada', 'cerrada')))
         as jugaron
from liga.perfiles p
where (select liga.es_admin())
group by 1;

-- Visitas y cuentas distintas por día, en hora de Madrid.
create view liga.v_admin_visitas_dia with (security_invoker = true) as
select (v.inicio at time zone 'Europe/Madrid')::date as dia,
       count(*) as visitas,
       count(distinct v.usuario_id) as cuentas
from liga.visitas v
where (select liga.es_admin())
group by 1;

-- Cuentas sin ninguna estrategia propia (el umbral de días lo aplica la API).
create view liga.v_admin_sin_estrategia with (security_invoker = true) as
select p.id, p.alias, p.creado,
       (select count(*) from liga.visitas v where v.usuario_id = p.id) as visitas,
       (select max(v.inicio) from liga.visitas v where v.usuario_id = p.id) as ultima_visita,
       liga.tiene_borrador(p.id) as borrador
from liga.perfiles p
where (select liga.es_admin())
  and not exists (select 1 from liga.estrategias e where e.dueno_id = p.id and e.tipo = 'usuario');

-- Última visita de cada cuenta que ha entrado alguna vez (el umbral de días lo aplica la API).
create view liga.v_admin_inactivas with (security_invoker = true) as
select p.id, p.alias, p.creado, max(v.inicio) as ultima_visita, count(v.id) as visitas
from liga.perfiles p join liga.visitas v on v.usuario_id = p.id
where (select liga.es_admin())
group by p.id, p.alias, p.creado;

-- Estrategias de usuario que no se han apuntado nunca a ninguna jornada.
create view liga.v_admin_nunca_apuntadas with (security_invoker = true) as
select e.id, e.nombre, e.estado, e.creada, p.alias
from liga.estrategias e left join liga.perfiles p on p.id = e.dueno_id
where (select liga.es_admin()) and e.tipo = 'usuario'
  and not exists (select 1 from liga.inscripciones i where i.estrategia_id = e.id);

-- Reglas de la receta vigente de las estrategias apuntadas o jugando, por número de estrategias.
create view liga.v_admin_reglas_usadas with (security_invoker = true) as
select regla->>'clave' as clave, count(distinct e.id) as estrategias
from liga.estrategias e
join liga.recetas r on r.id = e.receta_id
cross join lateral jsonb_array_elements(r.reglas) as regla
where (select liga.es_admin()) and e.tipo = 'usuario' and e.estado in ('apuntada', 'jugando')
group by 1;

revoke all on liga.v_admin_cohortes, liga.v_admin_visitas_dia, liga.v_admin_sin_estrategia,
  liga.v_admin_inactivas, liga.v_admin_nunca_apuntadas, liga.v_admin_reglas_usadas
  from public, anon;
grant select on liga.v_admin_cohortes, liga.v_admin_visitas_dia, liga.v_admin_sin_estrategia,
  liga.v_admin_inactivas, liga.v_admin_nunca_apuntadas, liga.v_admin_reglas_usadas
  to authenticated;
