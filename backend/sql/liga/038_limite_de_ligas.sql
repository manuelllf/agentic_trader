-- liga_038 · Crear ligas tiene tope: Pro incluye dos y cada pase de liga vigente, una.
-- Unirse sigue gratis. Cuenta las ligas que ya se tienen, también las de un derecho caducado.
set lock_timeout = '5s'; set statement_timeout = '30s';

create function liga.ligas_incluidas(p_usuario uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (case when liga.tiene_pro(p_usuario) then 2 else 0 end)
       + (select count(*)::integer from liga.pases_liga
          where usuario_id = p_usuario and desde <= now() and (hasta is null or hasta > now()));
$$;
revoke execute on function liga.ligas_incluidas(uuid) from public;
grant execute on function liga.ligas_incluidas(uuid) to authenticated;

create or replace function liga.ligas_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not liga.puede_crear_liga() then
      raise exception 'Crear ligas privadas es de Pro o de quien tiene un pase de liga'
        using errcode = '42501';
    end if;
    if (select count(*) from liga.ligas_privadas where dueno_id = (select auth.uid()))
       >= liga.ligas_incluidas((select auth.uid())) then
      raise exception 'Ya tienes todas tus ligas incluidas' using errcode = '42501';
    end if;
    if new.oculta then
      raise exception 'Una liga nueva nace visible' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.dueno_id is distinct from (select auth.uid())
     and (to_jsonb(new) - 'oculta') <> (to_jsonb(old) - 'oculta') then
    raise exception 'Solo el dueño edita su liga' using errcode = '42501';
  end if;
  if new.oculta is distinct from old.oculta and not liga.authorize('moderacion.revisar') then
    raise exception 'Solo moderación puede ocultar una liga' using errcode = '42501';
  end if;
  return new;
end $$;
