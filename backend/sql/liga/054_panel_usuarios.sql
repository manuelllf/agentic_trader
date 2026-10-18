-- liga_054 · Panel de usuarios: una fila por cuenta para el admin y el email solo con función de admin.
-- Todo sale de lo que ya se guarda: sin tablas, columnas ni índices nuevos. Dinero en numeric.

create view liga.v_panel_usuarios with (security_invoker = true) as
select
  p.id,
  p.alias,
  p.oculto,
  p.creado,
  array(select r.rol::text from liga.roles_usuario r where r.usuario_id = p.id order by r.rol)
    as roles,
  not exists (select 1 from liga.roles_usuario r
              where r.usuario_id = p.id and r.rol = 'usuario') as suspendido,
  exists (select 1 from liga.planes_usuario pl where pl.usuario_id = p.id and pl.plan = 'pro'
          and pl.desde <= clock_timestamp()
          and (pl.hasta is null or pl.hasta > clock_timestamp())) as pro,
  (select pl.hasta from liga.planes_usuario pl where pl.usuario_id = p.id and pl.plan = 'pro'
     and pl.desde <= clock_timestamp() and (pl.hasta is null or pl.hasta > clock_timestamp())
     order by pl.desde desc limit 1) as plan_hasta,
  exists (select 1 from liga.pases_liga pa where pa.usuario_id = p.id
          and pa.desde <= clock_timestamp()
          and (pa.hasta is null or pa.hasta > clock_timestamp())) as pase_liga,
  (select pa.hasta from liga.pases_liga pa where pa.usuario_id = p.id
     and pa.desde <= clock_timestamp() and (pa.hasta is null or pa.hasta > clock_timestamp())
     order by pa.desde desc limit 1) as pase_hasta,
  pp.edad,
  pp.edad_declarada_en,
  pp.baja_solicitada,
  coalesce(s.saldo, 0) as saldo,
  vis.total as visitas_total,
  vis.ultimos_7 as visitas_7d,
  vis.ultima_visita,
  vis.ultima_actividad,
  round(coalesce(vis.segundos_30, 0))::bigint as tiempo_30d_seg,
  ia.total_usd as ia_mes_usd,
  ia.llamadas as ia_mes_llamadas,
  ia.cache as ia_mes_cache,
  ia.conversor_usd as ia_mes_conversor_usd,
  ia.conversor_llamadas as ia_mes_conversor_llamadas,
  ia.pregunta_usd as ia_mes_pregunta_usd,
  ia.pregunta_llamadas as ia_mes_pregunta_llamadas,
  ia.lectura_usd as ia_mes_lectura_usd,
  ia.lectura_llamadas as ia_mes_lectura_llamadas,
  (select coalesce(sum((a.detalle->>'coste_usd')::numeric), 0) from liga.auditoria a
     where a.actor_id = p.id and a.accion like 'ia.%') as ia_historico_usd,
  cob.pregunta_usd as cobrado_mes_pregunta_usd,
  cob.lectura_usd as cobrado_mes_lectura_usd,
  cob.pregunta_usd + cob.lectura_usd as cobrado_mes_usd,
  (select count(*) from liga.estrategias e where e.dueno_id = p.id) as estrategias,
  (select count(*) from liga.estrategias e where e.dueno_id = p.id and e.estado = 'jugando')
    as estrategias_jugando,
  (select count(*) from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
     where e.dueno_id = p.id) as inscripciones,
  (select count(*) from liga.ligas_privadas l where l.dueno_id = p.id) as ligas_propias,
  (select count(*) from liga.miembros_liga m where m.usuario_id = p.id) as ligas_miembro,
  (select count(*) from liga.reportes r where r.autor_id = p.id) as reportes_hechos,
  (select count(*) from liga.reportes r where r.tipo = 'alias' and r.objeto_id = p.id::text)
    as reportes_recibidos,
  exists (select 1 from liga.consentimientos c where c.usuario_id = p.id
          and c.documento = 'terminos' and c.version = liga.version_terminos())
    as terminos_aceptado_vigente,
  (select min(c.aceptado) from liga.consentimientos c where c.usuario_id = p.id
     and c.documento = 'terminos' and c.version = liga.version_terminos())
    as terminos_aceptado_en
from liga.perfiles p
left join liga.perfiles_privados pp on pp.id = p.id
left join liga.v_saldo s on s.usuario_id = p.id
left join lateral (
  select count(*) as total,
         count(*) filter (where v.inicio >= now() - interval '7 days') as ultimos_7,
         max(v.inicio) as ultima_visita,
         max(v.ultima_actividad) as ultima_actividad,
         sum(extract(epoch from v.ultima_actividad - v.inicio))
           filter (where v.inicio >= now() - interval '30 days') as segundos_30
  from liga.visitas v where v.usuario_id = p.id
) vis on true
left join lateral (
  select count(*) as llamadas,
         count(*) filter (where a.detalle->>'cache' = 'true') as cache,
         count(*) filter (where a.accion = 'ia.conversor') as conversor_llamadas,
         count(*) filter (where a.accion = 'ia.pregunta') as pregunta_llamadas,
         count(*) filter (where a.accion = 'ia.lectura') as lectura_llamadas,
         coalesce(sum((a.detalle->>'coste_usd')::numeric), 0) as total_usd,
         coalesce(sum((a.detalle->>'coste_usd')::numeric)
           filter (where a.accion = 'ia.conversor'), 0) as conversor_usd,
         coalesce(sum((a.detalle->>'coste_usd')::numeric)
           filter (where a.accion = 'ia.pregunta'), 0) as pregunta_usd,
         coalesce(sum((a.detalle->>'coste_usd')::numeric)
           filter (where a.accion = 'ia.lectura'), 0) as lectura_usd
  from liga.auditoria a
  where a.actor_id = p.id and a.accion like 'ia.%'
    and a.creada >= date_trunc('month', now())
) ia on true
left join lateral (
  select coalesce(-sum(m.importe) filter (where m.motivo = 'prueba'), 0) * 0.01 as pregunta_usd,
         coalesce(-sum(m.importe) filter (where m.motivo = 'lectura'), 0) * 0.01 as lectura_usd
  from liga.creditos_movimientos m
  where m.usuario_id = p.id and m.importe < 0
    and m.creado >= date_trunc('month', now())
) cob on true
where (select liga.es_admin());

revoke all on liga.v_panel_usuarios from public, anon;
grant select on liga.v_panel_usuarios to authenticated;

create function liga.email_de_usuario(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email::text from auth.users u
  where u.id = p_id and (select liga.es_admin());
$$;

revoke execute on function liga.email_de_usuario(uuid) from public, anon;
grant execute on function liga.email_de_usuario(uuid) to authenticated;
