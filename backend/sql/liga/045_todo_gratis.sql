-- liga_045 · Liga gratis: publicar, crear ligas y consultar estrategias publicadas.
set lock_timeout = '5s'; set statement_timeout = '30s';

create or replace function liga.estrategias_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  uid uuid := (select auth.uid());
  moderacion boolean;
  en_juego integer;
  borradores integer;
begin
  if tg_op = 'UPDATE' then
    new.actualizada := now();
  end if;
  if new.estado not in ('apuntada', 'jugando') then
    new.opta_premio := false;
  end if;
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  moderacion := liga.authorize('moderacion.revisar');

  if tg_op = 'INSERT' then
    if new.oculta or new.estado <> 'borrador' or new.receta_id is not null then
      raise exception 'Una estrategia nueva nace borrador, visible y sin receta'
        using errcode = '42501';
    end if;
  else
    -- Quien no es el dueño (moderación) solo puede tocar `oculta`.
    if old.dueno_id is distinct from uid then
      if not moderacion or (to_jsonb(new) - 'oculta' - 'actualizada')
                          <> (to_jsonb(old) - 'oculta' - 'actualizada') then
        raise exception 'Solo el dueño edita su estrategia' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.oculta is distinct from old.oculta and not moderacion then
      raise exception 'Solo moderación puede ocultar una estrategia' using errcode = '42501';
    end if;
    if new.receta_id is distinct from old.receta_id and not exists (
         select 1 from liga.recetas r where r.id = new.receta_id and r.estrategia_id = new.id) then
      raise exception 'La receta no es de esta estrategia' using errcode = '42501';
    end if;
    if new.estado is distinct from old.estado and (old.estado, new.estado) not in (
         ('borrador', 'apuntada'), ('apuntada', 'borrador'),
         ('apuntada', 'retirada'), ('jugando', 'retirada')) then
      raise exception 'Cambio de estado no permitido: % → %', old.estado, new.estado
        using errcode = '42501';
    end if;
  end if;

  if new.estado = 'apuntada' and new.receta_id is null then
    raise exception 'Para apuntarla hace falta su receta' using errcode = '23514';
  end if;
  if new.estado in ('apuntada', 'jugando') and new.receta_id is not null and not exists (
       select 1 from liga.recetas r
       where r.id = new.receta_id and jsonb_array_length(r.reglas) > 0) then
    raise exception 'Para apuntarla hace falta al menos una regla' using errcode = '23514';
  end if;

  select count(*) filter (where e.estado in ('apuntada', 'jugando') and e.id <> new.id),
         count(*) filter (where e.estado = 'borrador' and e.id <> new.id)
    into en_juego, borradores
    from liga.estrategias e where e.dueno_id = uid;
  if new.estado in ('apuntada', 'jugando') and en_juego >= 1 then
    raise exception 'Solo puedes tener una estrategia en juego a la vez' using errcode = '23514';
  end if;
  if new.estado = 'borrador' and borradores >= 10 then
    raise exception 'Como mucho 10 borradores' using errcode = '23514';
  end if;

  if new.estado in ('apuntada', 'jugando') and not new.opta_premio and not exists (
       select 1 from liga.estrategias e
       where e.dueno_id = uid and e.opta_premio and e.id <> new.id) then
    new.opta_premio := true;
  end if;
  return new;
end $$;

create or replace function liga.ligas_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
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

create or replace function liga.puede_crear_liga() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((select auth.uid()) is not null, false);
$$;

create or replace function liga.puede_ver_posiciones(p_inscripcion bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from liga.inscripciones i
    join liga.estrategias e on e.id = i.estrategia_id
    join liga.jornadas j on j.id = i.jornada_id
    where i.id = p_inscripcion
      and (e.dueno_id = (select auth.uid())
           or (e.tipo = 'casa' and (j.estado = 'cerrada' or liga.es_pro()))
           or (e.tipo = 'usuario' and e.visibilidad = 'publicada' and not e.oculta)));
$$;

drop policy publicadas_pro on liga.recetas;
create policy publicadas on liga.recetas for select to authenticated
  using (exists (select 1 from liga.estrategias e
    where e.id = recetas.estrategia_id and e.tipo = 'usuario'
      and e.visibilidad = 'publicada' and not e.oculta));
