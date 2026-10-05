-- migraciones-liga: 022
-- migraciones-saneamiento: 11
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: liga; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA liga;


--
-- Name: SCHEMA liga; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA liga IS 'Producto liguilla. Lo lee y escribe el backend con la identidad de cada usuario (RLS).';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone',
    'recovery_code'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: permiso; Type: TYPE; Schema: liga; Owner: -
--

CREATE TYPE liga.permiso AS ENUM (
    'liga.jugar',
    'moderacion.revisar',
    'admin.liga',
    'admin.salas'
);


--
-- Name: plan; Type: TYPE; Schema: liga; Owner: -
--

CREATE TYPE liga.plan AS ENUM (
    'gratis',
    'pro'
);


--
-- Name: rol; Type: TYPE; Schema: liga; Owner: -
--

CREATE TYPE liga.rol AS ENUM (
    'usuario',
    'moderador',
    'admin'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: aal2(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.aal2() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;


--
-- Name: alta_usuario(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.alta_usuario() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  regalo numeric;
  nombre text;
  abierto boolean;
  registro_publico boolean;
begin
  registro_publico := new.raw_user_meta_data ? 'alias'
    or new.raw_user_meta_data ? 'terminos_version';
  if registro_publico or new.email_confirmed_at is null then
    select coalesce((select a.valor = 'true'::jsonb from liga.ajustes a
      where a.clave = 'liga.registro.abierto'), false) into abierto;
    if not abierto then
      raise exception 'El registro está cerrado' using errcode = '42501';
    end if;
    nombre := lower(trim(new.raw_user_meta_data ->> 'alias'));
    if nombre is null or nombre !~ '^[a-z0-9_.]{3,20}$' or nombre in ('admin', 'vennett') then
      raise exception 'Nombre de usuario no válido' using errcode = '23514';
    end if;
    if (new.raw_user_meta_data ->> 'terminos_version') is distinct from '1' then
      raise exception 'Acepta los términos' using errcode = '23514';
    end if;
  else
    nombre := 'jugador_' || left(replace(new.id::text, '-', ''), 12);
  end if;
  insert into liga.perfiles (id, alias) values (new.id, nombre);
  insert into liga.perfiles_privados (id) values (new.id);
  insert into liga.roles_usuario (usuario_id, rol) values (new.id, 'usuario');
  if registro_publico then
    insert into liga.consentimientos (usuario_id, documento, version)
      values (new.id, 'terminos', '1'), (new.id, 'privacidad', '1');
  end if;
  if new.email_confirmed_at is not null then
    select coalesce((select (a.valor #>> '{}')::numeric from liga.ajustes a
      where a.clave = 'creditos.bienvenida' and jsonb_typeof(a.valor) = 'number'), 15) into regalo;
    if regalo > 0 then
      perform liga.cargar_creditos(new.id, regalo, 'regalo', 'bienvenida');
    end if;
  end if;
  return new;
end $$;


--
-- Name: authorize(liga.permiso); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.authorize(p liga.permiso) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from liga.roles_usuario r
    join liga.permisos_rol pr on pr.rol = r.rol
    where r.usuario_id = (select auth.uid()) and pr.permiso = p);
$$;


--
-- Name: baja_usuario(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.baja_usuario() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update liga.estrategias
     set estado = case when estado in ('apuntada', 'jugando') then 'retirada' else estado end,
         visibilidad = 'privada'
   where dueno_id = old.id and tipo = 'usuario';
  return old;
end $$;


--
-- Name: cargar_creditos(uuid, numeric, text, text, uuid, bigint, uuid); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.cargar_creditos(p_usuario uuid, p_importe numeric, p_motivo text, p_idempotencia text, p_prueba uuid DEFAULT NULL::uuid, p_lectura bigint DEFAULT NULL::bigint, p_por uuid DEFAULT NULL::uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  saldo numeric(12,4);
begin
  perform pg_advisory_xact_lock(hashtextextended('liga.creditos:' || p_usuario::text, 0));
  if exists (select 1 from liga.creditos_movimientos
             where usuario_id = p_usuario and idempotencia = p_idempotencia) then
    select coalesce(sum(importe), 0) into saldo
      from liga.creditos_movimientos where usuario_id = p_usuario;
    return saldo;
  end if;
  select coalesce(sum(importe), 0) into saldo
    from liga.creditos_movimientos where usuario_id = p_usuario;
  if saldo + p_importe < 0 then
    raise exception 'Saldo insuficiente: quedan % y hacen falta %', saldo, -p_importe
      using errcode = '23514';
  end if;
  insert into liga.creditos_movimientos
    (usuario_id, importe, motivo, prueba_id, lectura_id, idempotencia, creado_por)
    values (p_usuario, p_importe, p_motivo, p_prueba, p_lectura, p_idempotencia, p_por);
  return saldo + p_importe;
end $$;


--
-- Name: custom_access_token_hook(jsonb); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.custom_access_token_hook(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  rol_mayor liga.rol;
  pro boolean;
begin
  select r.rol into rol_mayor from liga.roles_usuario r where r.usuario_id = uid
    order by case r.rol when 'admin' then 3 when 'moderador' then 2 else 1 end desc limit 1;
  select exists (
    select 1 from liga.planes_usuario p
    where p.usuario_id = uid and p.plan = 'pro'
      and p.desde <= now() and (p.hasta is null or p.hasta > now())) into pro;
  claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(rol_mayor::text), 'null'::jsonb));
  claims := jsonb_set(claims, '{plan}', to_jsonb(case when pro then 'pro' else 'gratis' end));
  return jsonb_set(event, '{claims}', claims);
end $$;


--
-- Name: dueno_se_une(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.dueno_se_une() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into liga.miembros_liga (liga_id, usuario_id) values (new.id, new.dueno_id)
    on conflict do nothing;
  return new;
end $$;


--
-- Name: es_admin(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.es_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select liga.authorize('admin.liga') and liga.aal2();
$$;


--
-- Name: es_miembro(uuid); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.es_miembro(p_liga uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from liga.miembros_liga m
                 where m.liga_id = p_liga and m.usuario_id = (select auth.uid()));
$$;


--
-- Name: es_pro(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.es_pro() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from liga.planes_usuario
    where usuario_id = (select auth.uid()) and plan = 'pro'
      and desde <= now() and (hasta is null or hasta > now()));
$$;


--
-- Name: estrategias_candado(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.estrategias_candado() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.estado in ('apuntada', 'jugando', 'borrador') and new.dueno_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('liga.estrategias:' || new.dueno_id::text, 0));
  end if;
  return new;
end $$;


--
-- Name: estrategias_guarda(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.estrategias_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  uid uuid := (select auth.uid());
  moderacion boolean;
  pro boolean;
  tope integer;
  en_juego integer;
  borradores integer;
begin
  if tg_op = 'UPDATE' then
    new.actualizada := now();
  end if;
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  moderacion := liga.authorize('moderacion.revisar');
  pro := liga.es_pro();

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

  if new.visibilidad = 'publicada' and not pro then
    raise exception 'Publicar es de Pro' using errcode = '42501';
  end if;
  if new.estado = 'apuntada' and new.receta_id is null then
    raise exception 'Para apuntarla hace falta su receta' using errcode = '23514';
  end if;
  if new.estado in ('apuntada', 'jugando') and new.receta_id is not null and not exists (
       select 1 from liga.recetas r
       where r.id = new.receta_id and jsonb_array_length(r.reglas) > 0) then
    raise exception 'Para apuntarla hace falta al menos una regla' using errcode = '23514';
  end if;

  tope := case when pro then 3 else 1 end;
  select count(*) filter (where e.estado in ('apuntada', 'jugando') and e.id <> new.id),
         count(*) filter (where e.estado = 'borrador' and e.id <> new.id)
    into en_juego, borradores
    from liga.estrategias e where e.dueno_id = uid;
  if new.estado in ('apuntada', 'jugando') and en_juego >= tope then
    raise exception 'Tu plan permite % en juego a la vez', tope using errcode = '23514';
  end if;
  if new.estado = 'borrador' and borradores >= 10 then
    raise exception 'Como mucho 10 borradores' using errcode = '23514';
  end if;
  return new;
end $$;


--
-- Name: inscripciones_guarda(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.inscripciones_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.receta_id is null and not exists (
       select 1 from liga.estrategias e where e.id = new.estrategia_id and e.tipo = 'casa') then
    raise exception 'Solo los equipos de la casa se inscriben sin receta' using errcode = '23502';
  end if;
  return new;
end $$;


--
-- Name: ligas_guarda(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.ligas_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not liga.es_pro() then
      raise exception 'Crear ligas privadas es de Pro' using errcode = '42501';
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


--
-- Name: perfiles_guarda(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.perfiles_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if new.alias = 'admin' and new.alias is distinct from old.alias then
    raise exception 'Ese alias está reservado' using errcode = '23514';
  end if;
  if new.oculto is distinct from old.oculto and not liga.authorize('moderacion.revisar') then
    raise exception 'Solo moderación puede ocultar un perfil' using errcode = '42501';
  end if;
  if new.alias is distinct from old.alias and old.id is distinct from (select auth.uid()) then
    raise exception 'Solo el dueño cambia su alias' using errcode = '42501';
  end if;
  return new;
end $$;


--
-- Name: puede_ver_posiciones(bigint); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.puede_ver_posiciones(p_inscripcion bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
    where i.id = p_inscripcion
      and (e.dueno_id = (select auth.uid())
           or (e.tipo = 'usuario' and e.visibilidad = 'publicada' and not e.oculta
               and liga.es_pro())));
$$;


--
-- Name: recetas_guarda(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.recetas_guarda() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if not exists (select 1 from liga.estrategias e
                 where e.id = new.estrategia_id and e.dueno_id = (select auth.uid())
                   and e.tipo = 'usuario') then
    raise exception 'La receta tiene que ser de una estrategia tuya' using errcode = '42501';
  end if;
  if new.pregunta is not null and not liga.es_pro() then
    raise exception 'La pregunta propia es de Pro' using errcode = '42501';
  end if;
  return new;
end $$;


--
-- Name: solo_anadir(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.solo_anadir() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  existe boolean;
begin
  if tg_op = 'DELETE' and tg_nargs = 2 then
    execute format('select exists (select 1 from %s where id = $1)', tg_argv[0])
      into existe using (to_jsonb(old) ->> tg_argv[1])::uuid;
    if not existe then
      return old;
    end if;
  end if;
  raise exception '%.% es de solo añadir', tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $_$;


--
-- Name: tocar_auditoria(); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.tocar_auditoria() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  col_ts  text := coalesce(tg_argv[0], 'actualizado_en');
  col_por text := coalesce(tg_argv[1], 'actualizado_por');
  -- coalesce con app.actor: si algún día se escribe en liga desde una sesión de sistema de las
  -- salas (mismo patrón que public.tocar_auditoria), auth.uid() sale null y cae en esa.
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor', true), '')::uuid);
begin
  new := jsonb_populate_record(new, jsonb_build_object(col_ts, now(), col_por, actor));
  return new;
end
$$;


--
-- Name: FUNCTION tocar_auditoria(); Type: COMMENT; Schema: liga; Owner: -
--

COMMENT ON FUNCTION liga.tocar_auditoria() IS 'BEFORE UPDATE: actualizado_en=now(), actualizado_por=actor (o los nombres que le pasen por tg_argv). NULL en el actor = lo hizo el sistema.';


--
-- Name: unirse_liga(text); Type: FUNCTION; Schema: liga; Owner: -
--

CREATE FUNCTION liga.unirse_liga(p_codigo text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  uid uuid := (select auth.uid());
  l liga.ligas_privadas;
  n integer;
begin
  if uid is null or not liga.authorize('liga.jugar') then
    raise exception 'Necesitas una cuenta activa' using errcode = '42501';
  end if;
  if not liga.es_pro() then
    raise exception 'Las ligas privadas son de Pro' using errcode = '42501';
  end if;
  select * into l from liga.ligas_privadas
    where codigo = upper(btrim(p_codigo)) and not oculta for update;
  if not found then
    raise exception 'Ese código no es de ninguna liga' using errcode = 'P0002';
  end if;
  if exists (select 1 from liga.miembros_liga where liga_id = l.id and usuario_id = uid) then
    return l.id;
  end if;
  select count(*) into n from liga.miembros_liga where liga_id = l.id;
  if n >= l.cupo then
    raise exception 'La liga está completa (% de %)', n, l.cupo using errcode = '23514';
  end if;
  insert into liga.miembros_liga (liga_id, usuario_id) values (l.id, uid);
  return l.id;
end $$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: tocar_auditoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tocar_auditoria() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  col_created_by text := coalesce(tg_argv[0], 'created_by');
  col_updated_at text := coalesce(tg_argv[1], 'updated_at');
  col_updated_by text := coalesce(tg_argv[2], 'updated_by');
  actor uuid := nullif(current_setting('app.actor', true), '')::uuid;
  ya_puesto uuid;
begin
  if tg_op = 'INSERT' then
    execute format('select ($1).%I', col_created_by) into ya_puesto using new;
    new := jsonb_populate_record(new, jsonb_build_object(col_created_by, coalesce(ya_puesto, actor)));
    return new;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(col_updated_at, now(), col_updated_by, actor));
  return new;
end
$_$;


--
-- Name: FUNCTION tocar_auditoria(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.tocar_auditoria() IS 'BEFORE INSERT OR UPDATE: created_by=actor (solo si venía null) / updated_at=now(), updated_by=actor. NULL en el actor = lo hizo el sistema.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: mfa_recovery_code_sets; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_recovery_code_sets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    mfa_factor_id uuid NOT NULL,
    failed_verification_count integer DEFAULT 0 NOT NULL,
    verification_locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_recovery_code_sets_failed_verification_count_check CHECK ((failed_verification_count >= 0))
);


--
-- Name: mfa_recovery_codes; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_recovery_codes (
    id uuid NOT NULL,
    mfa_recovery_code_set_id uuid NOT NULL,
    code_hash text NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: scim_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.scim_tokens (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    token_hash text NOT NULL,
    prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    CONSTRAINT scim_tokens_expires_at_future CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT scim_tokens_revoked_after_created CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT scim_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: scim_users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.scim_users (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    user_id uuid,
    resource jsonb NOT NULL,
    user_name text GENERATED ALWAYS AS (lower((resource ->> 'userName'::text))) STORED NOT NULL,
    external_id text GENERATED ALWAYS AS ((resource ->> 'externalId'::text)) STORED,
    active boolean GENERATED ALWAYS AS (COALESCE(((resource ->> 'active'::text))::boolean, true)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: ajustes; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.ajustes (
    clave text NOT NULL,
    valor jsonb NOT NULL,
    actualizado timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_por uuid,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    CONSTRAINT ajustes_clave_check CHECK ((clave ~ '^[a-z][a-z0-9_.]{2,59}$'::text))
);


--
-- Name: auditoria; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.auditoria (
    id bigint NOT NULL,
    actor_id uuid,
    accion text NOT NULL,
    objeto text,
    detalle jsonb DEFAULT '{}'::jsonb NOT NULL,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditoria_accion_check CHECK (((length(accion) >= 3) AND (length(accion) <= 60))),
    CONSTRAINT auditoria_objeto_check CHECK ((length(objeto) <= 120))
);


--
-- Name: auditoria_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.auditoria ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.auditoria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: avisos_error; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.avisos_error (
    id bigint NOT NULL,
    codigo text,
    usuario_id uuid,
    pantalla text NOT NULL,
    mensaje text NOT NULL,
    nota text,
    contexto jsonb DEFAULT '{}'::jsonb NOT NULL,
    estado text DEFAULT 'abierto'::text NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid,
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT avisos_error_codigo_check CHECK (((codigo IS NULL) OR (length(codigo) <= 20))),
    CONSTRAINT avisos_error_contexto_check CHECK ((octet_length((contexto)::text) <= 2000)),
    CONSTRAINT avisos_error_estado_check CHECK ((estado = ANY (ARRAY['abierto'::text, 'resuelto'::text]))),
    CONSTRAINT avisos_error_mensaje_check CHECK (((length(mensaje) >= 1) AND (length(mensaje) <= 500))),
    CONSTRAINT avisos_error_nota_check CHECK (((nota IS NULL) OR (length(nota) <= 1000))),
    CONSTRAINT avisos_error_pantalla_check CHECK (((length(pantalla) >= 1) AND (length(pantalla) <= 200)))
);


--
-- Name: TABLE avisos_error; Type: COMMENT; Schema: liga; Owner: -
--

COMMENT ON TABLE liga.avisos_error IS 'Errores que la gente reporta desde la web (o que llegan con su código). Solo admin.';


--
-- Name: avisos_error_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.avisos_error ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.avisos_error_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: consentimientos; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.consentimientos (
    id bigint NOT NULL,
    usuario_id uuid DEFAULT auth.uid() NOT NULL,
    documento text NOT NULL,
    version text NOT NULL,
    aceptado timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consentimientos_documento_check CHECK ((documento = ANY (ARRAY['terminos'::text, 'privacidad'::text]))),
    CONSTRAINT consentimientos_version_check CHECK (((length(version) >= 1) AND (length(version) <= 20)))
);


--
-- Name: consentimientos_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.consentimientos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.consentimientos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: creditos_movimientos; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.creditos_movimientos (
    id bigint NOT NULL,
    usuario_id uuid NOT NULL,
    importe numeric(12,4) NOT NULL,
    motivo text NOT NULL,
    prueba_id uuid,
    lectura_id bigint,
    idempotencia text NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid,
    CONSTRAINT creditos_movimientos_idempotencia_check CHECK (((length(idempotencia) >= 8) AND (length(idempotencia) <= 80))),
    CONSTRAINT creditos_movimientos_importe_check CHECK ((importe <> (0)::numeric)),
    CONSTRAINT creditos_movimientos_motivo_check CHECK ((motivo = ANY (ARRAY['recarga'::text, 'regalo'::text, 'pro_mensual'::text, 'demo'::text, 'ajuste'::text, 'prueba'::text, 'lectura'::text, 'reserva'::text, 'devolucion'::text])))
);


--
-- Name: creditos_movimientos_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.creditos_movimientos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.creditos_movimientos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: estrategias; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.estrategias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dueno_id uuid DEFAULT auth.uid(),
    tipo text DEFAULT 'usuario'::text NOT NULL,
    casa_clave text,
    nombre text NOT NULL,
    forma text NOT NULL,
    dibujo text NOT NULL,
    color1 text NOT NULL,
    color2 text NOT NULL,
    iniciales text,
    visibilidad text DEFAULT 'privada'::text NOT NULL,
    declara_posiciones text,
    destacable boolean DEFAULT false NOT NULL,
    estado text DEFAULT 'borrador'::text NOT NULL,
    cada_dia_1 text DEFAULT 'revisar'::text NOT NULL,
    oculta boolean DEFAULT false NOT NULL,
    receta_id bigint,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    actualizada timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_por uuid,
    CONSTRAINT casa_coherente CHECK (((tipo = 'casa'::text) = (casa_clave IS NOT NULL))),
    CONSTRAINT casa_sin_dueno CHECK (((tipo = 'usuario'::text) OR (dueno_id IS NULL))),
    CONSTRAINT estrategias_cada_dia_1_check CHECK ((cada_dia_1 = ANY (ARRAY['revisar'::text, 'mantener'::text]))),
    CONSTRAINT estrategias_casa_clave_check CHECK ((casa_clave = ANY (ARRAY['alpha'::text, 'omega'::text, 'lambda'::text]))),
    CONSTRAINT estrategias_color1_check CHECK ((color1 ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT estrategias_color2_check CHECK ((color2 ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT estrategias_declara_posiciones_check CHECK ((declara_posiciones = ANY (ARRAY['si'::text, 'no'::text]))),
    CONSTRAINT estrategias_dibujo_check CHECK ((dibujo = ANY (ARRAY['liso'::text, 'mitades'::text, 'diagonal'::text, 'franja'::text]))),
    CONSTRAINT estrategias_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'apuntada'::text, 'jugando'::text, 'retirada'::text]))),
    CONSTRAINT estrategias_forma_check CHECK ((forma = ANY (ARRAY['circulo'::text, 'escudo'::text, 'hexagono'::text]))),
    CONSTRAINT estrategias_iniciales_check CHECK ((iniciales ~ '^[A-ZÑ0-9]{1,2}$'::text)),
    CONSTRAINT estrategias_nombre_check CHECK (((length(nombre) >= 1) AND (length(nombre) <= 28))),
    CONSTRAINT estrategias_tipo_check CHECK ((tipo = ANY (ARRAY['usuario'::text, 'casa'::text]))),
    CONSTRAINT estrategias_visibilidad_check CHECK ((visibilidad = ANY (ARRAY['privada'::text, 'publicada'::text]))),
    CONSTRAINT publicada_declara CHECK (((visibilidad = 'privada'::text) OR (declara_posiciones IS NOT NULL)))
);


--
-- Name: inscripciones; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.inscripciones (
    id bigint NOT NULL,
    jornada_id integer NOT NULL,
    estrategia_id uuid NOT NULL,
    receta_id bigint,
    n_pasan integer,
    estado text DEFAULT 'inscrita'::text NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT inscripciones_estado_check CHECK ((estado = ANY (ARRAY['inscrita'::text, 'formada'::text, 'sin_empresas'::text, 'cerrada'::text]))),
    CONSTRAINT inscripciones_n_pasan_check CHECK ((n_pasan >= 0))
);


--
-- Name: inscripciones_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.inscripciones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.inscripciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: jornadas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.jornadas (
    id integer NOT NULL,
    temporada_id smallint NOT NULL,
    numero smallint NOT NULL,
    dia_base date NOT NULL,
    dia_inicio date NOT NULL,
    dia_fin date NOT NULL,
    cierre_inscripcion timestamp with time zone NOT NULL,
    estado text DEFAULT 'programada'::text NOT NULL,
    foto_id bigint,
    scan_run_id bigint,
    sp_rentabilidad numeric(10,4),
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT jornada_cerrada_con_sp CHECK (((estado <> 'cerrada'::text) OR (sp_rentabilidad IS NOT NULL))),
    CONSTRAINT jornada_fechas CHECK (((dia_base < dia_inicio) AND (dia_inicio <= dia_fin))),
    CONSTRAINT jornadas_estado_check CHECK ((estado = ANY (ARRAY['programada'::text, 'formada'::text, 'cerrada'::text]))),
    CONSTRAINT jornadas_numero_check CHECK (((numero >= 1) AND (numero <= 24)))
);


--
-- Name: jornadas_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.jornadas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.jornadas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lecturas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.lecturas (
    id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    foto_id bigint NOT NULL,
    texto text NOT NULL,
    fuentes jsonb DEFAULT '[]'::jsonb NOT NULL,
    llm_call_id bigint,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    CONSTRAINT lecturas_fuentes_check CHECK ((jsonb_typeof(fuentes) = 'array'::text)),
    CONSTRAINT lecturas_texto_check CHECK ((length(texto) <= 20000))
);


--
-- Name: lecturas_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.lecturas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.lecturas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ligas_privadas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.ligas_privadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dueno_id uuid DEFAULT auth.uid() NOT NULL,
    nombre text NOT NULL,
    codigo text NOT NULL,
    cupo smallint DEFAULT 50 NOT NULL,
    oculta boolean DEFAULT false NOT NULL,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT ligas_privadas_codigo_check CHECK ((codigo ~ '^[A-HJ-NP-Z2-9]{8}$'::text)),
    CONSTRAINT ligas_privadas_cupo_check CHECK (((cupo >= 2) AND (cupo <= 200))),
    CONSTRAINT ligas_privadas_nombre_check CHECK (((length(nombre) >= 1) AND (length(nombre) <= 40)))
);


--
-- Name: miembros_liga; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.miembros_liga (
    liga_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    unido timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid()
);


--
-- Name: omega_operaciones; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.omega_operaciones (
    id bigint NOT NULL,
    jornada_id integer NOT NULL,
    numero smallint NOT NULL,
    senal_id bigint,
    ticker text NOT NULL,
    entrada_dia date NOT NULL,
    entrada_precio numeric(14,4) NOT NULL,
    market_cap_usd numeric(20,2),
    salida_dia date,
    salida_precio numeric(14,4),
    motivo text,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid,
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT omega_operaciones_motivo_check CHECK ((motivo = ANY (ARRAY['objetivo'::text, 'tiempo'::text]))),
    CONSTRAINT omega_operaciones_numero_check CHECK (((numero >= 1) AND (numero <= 4))),
    CONSTRAINT omega_operaciones_salida_coherente CHECK ((((salida_dia IS NULL) = (salida_precio IS NULL)) AND ((salida_dia IS NULL) = (motivo IS NULL))))
);


--
-- Name: TABLE omega_operaciones; Type: COMMENT; Schema: liga; Owner: -
--

COMMENT ON TABLE liga.omega_operaciones IS 'Huecos virtuales de Omega en la liga (500 $ cada uno): una fila por operación. Solo admin (D4, igual que liga.posiciones de la casa): el nombre que eligió el método no es público.';


--
-- Name: omega_operaciones_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.omega_operaciones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.omega_operaciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: perfiles; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.perfiles (
    id uuid NOT NULL,
    alias text NOT NULL,
    oculto boolean DEFAULT false NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT alias_formato CHECK ((alias ~ '^[a-z0-9_.]{3,20}$'::text)),
    CONSTRAINT alias_reservado CHECK ((alias <> ALL (ARRAY['administrador'::text, 'alpha'::text, 'beta'::text, 'omega'::text, 'lambda'::text, 'jev'::text, 'liguilla'::text, 'liga'::text, 'soporte'::text, 'ayuda'::text, 'moderador'::text, 'moderacion'::text, 'casa'::text, 'sistema'::text, 'root'::text, 'staff'::text])))
);


--
-- Name: perfiles_privados; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.perfiles_privados (
    id uuid NOT NULL,
    tema text DEFAULT 'auto'::text NOT NULL,
    idioma text CHECK (idioma IN ('es', 'en')),
    baja_solicitada timestamp with time zone,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT perfiles_privados_tema_check CHECK ((tema = ANY (ARRAY['auto'::text, 'claro'::text, 'oscuro'::text])))
);


--
-- Name: permisos_rol; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.permisos_rol (
    rol liga.rol NOT NULL,
    permiso liga.permiso NOT NULL
);


--
-- Name: planes_usuario; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.planes_usuario (
    id bigint NOT NULL,
    usuario_id uuid NOT NULL,
    plan liga.plan DEFAULT 'pro'::liga.plan NOT NULL,
    desde timestamp with time zone DEFAULT now() NOT NULL,
    hasta timestamp with time zone,
    origen text NOT NULL,
    concedido_por uuid,
    CONSTRAINT plan_rango CHECK (((hasta IS NULL) OR (hasta > desde))),
    CONSTRAINT planes_usuario_origen_check CHECK ((origen = ANY (ARRAY['admin'::text, 'demo'::text, 'pago'::text])))
);


--
-- Name: planes_usuario_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.planes_usuario ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.planes_usuario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: posiciones; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.posiciones (
    inscripcion_id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    peso numeric(10,4) NOT NULL,
    CONSTRAINT posiciones_peso_check CHECK (((peso > (0)::numeric) AND (peso <= (100)::numeric)))
);


--
-- Name: pruebas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.pruebas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    receta_id bigint NOT NULL,
    foto_id bigint NOT NULL,
    scan_run_id bigint,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    n_evaluadas integer DEFAULT 0 NOT NULL,
    idempotencia text NOT NULL,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT pruebas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text, 'hecha'::text, 'fallida'::text]))),
    CONSTRAINT pruebas_idempotencia_check CHECK (((length(idempotencia) >= 8) AND (length(idempotencia) <= 80))),
    CONSTRAINT pruebas_n_evaluadas_check CHECK ((n_evaluadas >= 0))
);


--
-- Name: recetas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.recetas (
    id bigint NOT NULL,
    estrategia_id uuid NOT NULL,
    idea text,
    reglas jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluidas text[] DEFAULT '{}'::text[] NOT NULL,
    catalogo_version smallint NOT NULL,
    pregunta text,
    peso_negocio smallint NOT NULL,
    peso_precio smallint NOT NULL,
    peso_deuda smallint NOT NULL,
    peso_pronto smallint NOT NULL,
    peso_pregunta smallint NOT NULL,
    n_empresas smallint NOT NULL,
    reparto text NOT NULL,
    max_por_sector smallint NOT NULL,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    CONSTRAINT algun_peso CHECK ((((((peso_negocio + peso_precio) + peso_deuda) + peso_pronto) + peso_pregunta) > 0)),
    CONSTRAINT excluidas_tope CHECK ((cardinality(excluidas) <= 50)),
    CONSTRAINT pregunta_con_peso CHECK (((pregunta IS NULL) = (peso_pregunta = 0))),
    CONSTRAINT recetas_catalogo_version_check CHECK ((catalogo_version > 0)),
    CONSTRAINT recetas_idea_check CHECK ((length(idea) <= 400)),
    CONSTRAINT recetas_max_por_sector_check CHECK (((max_por_sector >= 0) AND (max_por_sector <= 10))),
    CONSTRAINT recetas_n_empresas_check CHECK ((n_empresas = ANY (ARRAY[3, 5, 7, 10]))),
    CONSTRAINT recetas_peso_deuda_check CHECK ((((peso_deuda >= 0) AND (peso_deuda <= 50)) AND (((peso_deuda)::integer % 5) = 0))),
    CONSTRAINT recetas_peso_negocio_check CHECK ((((peso_negocio >= 0) AND (peso_negocio <= 50)) AND (((peso_negocio)::integer % 5) = 0))),
    CONSTRAINT recetas_peso_precio_check CHECK ((((peso_precio >= 0) AND (peso_precio <= 50)) AND (((peso_precio)::integer % 5) = 0))),
    CONSTRAINT recetas_peso_pregunta_check CHECK ((((peso_pregunta >= 0) AND (peso_pregunta <= 50)) AND (((peso_pregunta)::integer % 5) = 0))),
    CONSTRAINT recetas_peso_pronto_check CHECK ((((peso_pronto >= 0) AND (peso_pronto <= 50)) AND (((peso_pronto)::integer % 5) = 0))),
    CONSTRAINT recetas_pregunta_check CHECK (((length(pregunta) >= 1) AND (length(pregunta) <= 160))),
    CONSTRAINT recetas_reparto_check CHECK ((reparto = ANY (ARRAY['igual'::text, 'nota'::text]))),
    CONSTRAINT reglas_lista CHECK ((jsonb_typeof(reglas) = 'array'::text))
);


--
-- Name: recetas_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.recetas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.recetas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reportes; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.reportes (
    id bigint NOT NULL,
    autor_id uuid DEFAULT auth.uid(),
    tipo text NOT NULL,
    objeto_id text NOT NULL,
    motivo text NOT NULL,
    estado text DEFAULT 'abierto'::text NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    resuelto_por uuid,
    resuelto timestamp with time zone,
    CONSTRAINT reportes_estado_check CHECK ((estado = ANY (ARRAY['abierto'::text, 'resuelto'::text, 'descartado'::text]))),
    CONSTRAINT reportes_motivo_check CHECK (((length(motivo) >= 1) AND (length(motivo) <= 400))),
    CONSTRAINT reportes_objeto_id_check CHECK (((length(objeto_id) >= 1) AND (length(objeto_id) <= 64))),
    CONSTRAINT reportes_tipo_check CHECK ((tipo = ANY (ARRAY['alias'::text, 'estrategia'::text, 'liga'::text, 'pregunta'::text])))
);


--
-- Name: reportes_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.reportes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.reportes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: respuestas_ia; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.respuestas_ia (
    id bigint NOT NULL,
    pregunta_hash text NOT NULL,
    ticker character varying(16) NOT NULL,
    foto_id bigint NOT NULL,
    si boolean NOT NULL,
    seguridad text NOT NULL,
    llm_call_id bigint,
    creada timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    CONSTRAINT respuestas_ia_pregunta_hash_check CHECK ((pregunta_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT respuestas_ia_seguridad_check CHECK ((seguridad = ANY (ARRAY['alta'::text, 'media'::text, 'baja'::text])))
);


--
-- Name: respuestas_ia_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.respuestas_ia ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.respuestas_ia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: resultados; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.resultados (
    inscripcion_id bigint NOT NULL,
    rentabilidad numeric(10,4) NOT NULL,
    puntos smallint NOT NULL,
    CONSTRAINT resultados_puntos_check CHECK ((puntos = ANY (ARRAY[0, 1, 3])))
);


--
-- Name: roles_usuario; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.roles_usuario (
    usuario_id uuid NOT NULL,
    rol liga.rol NOT NULL,
    concedido timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid()
);


--
-- Name: temporadas; Type: TABLE; Schema: liga; Owner: -
--

CREATE TABLE liga.temporadas (
    id smallint NOT NULL,
    nombre text NOT NULL,
    n_jornadas smallint NOT NULL,
    cuenta boolean NOT NULL,
    estado text DEFAULT 'programada'::text NOT NULL,
    creado timestamp with time zone DEFAULT now() NOT NULL,
    creado_por uuid DEFAULT auth.uid(),
    actualizado_en timestamp with time zone,
    actualizado_por uuid,
    CONSTRAINT temporadas_estado_check CHECK ((estado = ANY (ARRAY['programada'::text, 'en_juego'::text, 'cerrada'::text]))),
    CONSTRAINT temporadas_n_jornadas_check CHECK (((n_jornadas >= 1) AND (n_jornadas <= 24))),
    CONSTRAINT temporadas_nombre_check CHECK (((length(nombre) >= 1) AND (length(nombre) <= 60)))
);


--
-- Name: temporadas_id_seq; Type: SEQUENCE; Schema: liga; Owner: -
--

ALTER TABLE liga.temporadas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME liga.temporadas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_clasificacion; Type: VIEW; Schema: liga; Owner: -
--

CREATE VIEW liga.v_clasificacion WITH (security_invoker='true') AS
 SELECT i.estrategia_id,
    j.temporada_id,
    (sum(r.puntos))::integer AS puntos,
    (count(*))::integer AS jornadas,
    (count(*) FILTER (WHERE (r.puntos = 3)))::integer AS ganadas,
    (count(*) FILTER (WHERE (r.puntos = 1)))::integer AS empatadas,
    (count(*) FILTER (WHERE (r.puntos = 0)))::integer AS perdidas,
    round(((exp(sum(ln(GREATEST(((1)::numeric + (r.rentabilidad / (100)::numeric)), 0.000000001)))) - exp(sum(ln(GREATEST(((1)::numeric + (j.sp_rentabilidad / (100)::numeric)), 0.000000001))))) * (100)::numeric), 4) AS dif_sp
   FROM (((liga.resultados r
     JOIN liga.inscripciones i ON ((i.id = r.inscripcion_id)))
     JOIN liga.jornadas j ON ((j.id = i.jornada_id)))
     JOIN liga.temporadas t ON ((t.id = j.temporada_id)))
  WHERE (t.cuenta AND (j.estado = 'cerrada'::text))
  GROUP BY i.estrategia_id, j.temporada_id;


--
-- Name: v_saldo; Type: VIEW; Schema: liga; Owner: -
--

CREATE VIEW liga.v_saldo WITH (security_invoker='true') AS
 SELECT usuario_id,
    (sum(importe))::numeric(12,4) AS saldo
   FROM liga.creditos_movimientos
  GROUP BY usuario_id;


--
-- Name: allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allocations (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    amount numeric NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    book character varying(8) DEFAULT 'shadow'::character varying NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.allocations ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.allocations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    ticker character varying(16) NOT NULL,
    sector character varying(48) DEFAULT ''::character varying NOT NULL,
    action character varying(10) NOT NULL,
    target_weight_pct double precision DEFAULT 0.0 NOT NULL,
    score double precision,
    est_price numeric,
    target_price double precision,
    upside_pct double precision,
    thesis text DEFAULT ''::text NOT NULL,
    edge text DEFAULT ''::text NOT NULL,
    risk text DEFAULT ''::text NOT NULL,
    macro_summary text DEFAULT ''::text NOT NULL,
    order_ref character varying(48) DEFAULT ''::character varying NOT NULL,
    broker_order_id character varying(48),
    requested_quantity numeric,
    quantity numeric,
    fill_price numeric,
    result_msg text DEFAULT ''::text NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.approvals ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: currency_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_conversions (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    external_id character varying(64) NOT NULL,
    order_ref character varying(48) NOT NULL,
    eur_amount numeric NOT NULL,
    usd_amount numeric NOT NULL,
    rate numeric NOT NULL,
    fee numeric NOT NULL,
    book character varying(8) NOT NULL
);


--
-- Name: currency_conversions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.currency_conversions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: currency_conversions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.currency_conversions_id_seq OWNED BY public.currency_conversions.id;


--
-- Name: equity_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equity_snapshots (
    id bigint NOT NULL,
    day date NOT NULL,
    book character varying(8) NOT NULL,
    equity numeric NOT NULL
);


--
-- Name: equity_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.equity_snapshots ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.equity_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: foto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foto (
    id bigint NOT NULL,
    alcance text NOT NULL,
    inicio timestamp with time zone DEFAULT now() NOT NULL,
    fin timestamp with time zone,
    estado text DEFAULT 'capturando'::text NOT NULL,
    pedidos integer,
    capturados integer,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT foto_alcance_check CHECK ((alcance = ANY (ARRAY['nasdaq'::text, 'global'::text]))),
    CONSTRAINT foto_capturados_check CHECK ((capturados >= 0)),
    CONSTRAINT foto_estado_check CHECK ((estado = ANY (ARRAY['capturando'::text, 'completa'::text, 'cortada'::text, 'fallida'::text]))),
    CONSTRAINT foto_fin_segun_estado CHECK (((estado = 'capturando'::text) = (fin IS NULL))),
    CONSTRAINT foto_pedidos_check CHECK ((pedidos >= 0))
);


--
-- Name: foto_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.foto ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.foto_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fundamentals_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fundamentals_snapshot (
    id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    sector character varying(48),
    price double precision,
    market_cap double precision,
    pe_trailing double precision,
    pe_forward double precision,
    high_52w double precision,
    low_52w double precision,
    industry character varying(64),
    name character varying(128),
    target_high double precision,
    target_mean double precision,
    technical_text text,
    earnings_text text,
    es_dataset boolean DEFAULT false NOT NULL,
    currency character varying(8),
    market_cap_usd double precision,
    financial_currency character varying(8),
    foto_id bigint,
    metricas jsonb,
    titulares text[]
);


--
-- Name: COLUMN fundamentals_snapshot.currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fundamentals_snapshot.currency IS 'Divisa nativa del ticker (yfinance "currency") -- se descartaba tras montar el prompt, ahora se persiste porque hace falta para convertir market_cap a USD.';


--
-- Name: COLUMN fundamentals_snapshot.market_cap_usd; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fundamentals_snapshot.market_cap_usd IS 'market_cap convertido a USD con la tasa de fx_rate más reciente -- se rellena en el gather y se RECALCULA cada noche (ver scheduler._fx_job) para que un movimiento de divisa se note sin re-capturar fundamentales. NULL hasta que exista tasa para su currency.';


--
-- Name: fundamentals_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fundamentals_snapshot ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fundamentals_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fx_rate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fx_rate (
    id bigint NOT NULL,
    synced_at timestamp with time zone NOT NULL,
    currency_code character varying(8) NOT NULL,
    usd_per_unit double precision NOT NULL
);


--
-- Name: TABLE fx_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fx_rate IS 'Tasa de cambio a USD por divisa, una tanda por día (append-only, mismo patrón que universe_ticker) -- job de las 5:00 Europa/Madrid via yahoo_scraper. Solo las divisas que de verdad aparecen en fundamentals_snapshot.currency, no un catálogo mundial completo.';


--
-- Name: fx_rate_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fx_rate ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fx_rate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ibkr_exchange; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ibkr_exchange (
    exchange character varying(32) NOT NULL,
    name character varying(64) NOT NULL
);


--
-- Name: TABLE ibkr_exchange; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ibkr_exchange IS 'Allow-list de mercados operables en IBKR (verificado a mano contra search_contracts + conocimiento del bróker, 27-ago-2026) -- filtra el candidate-list del scan "top market cap global" antes de rankear. Mantenimiento manual: IBKR añade mercados de vez en cuando (ver Bucarest, ago-2026), no hay API pública que liste "todo lo soportado" de una vez.';


--
-- Name: llm_call; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_call (
    id bigint NOT NULL,
    scan_run_id bigint,
    at timestamp with time zone NOT NULL,
    stage character varying(16) NOT NULL,
    ticker character varying(16),
    model character varying(48) NOT NULL,
    reasoning_effort character varying(8),
    content text,
    reasoning text,
    confidence double precision,
    prompt_cache_hit_tokens integer NOT NULL,
    prompt_cache_miss_tokens integer NOT NULL,
    completion_tokens integer NOT NULL,
    cost_usd double precision NOT NULL,
    latency_ms integer,
    ok boolean NOT NULL,
    error text
);


--
-- Name: llm_call_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.llm_call ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.llm_call_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: llm_call_logprob; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_call_logprob (
    id bigint NOT NULL,
    llm_call_id bigint NOT NULL,
    parte smallint NOT NULL,
    elegido boolean NOT NULL,
    token character varying(8) NOT NULL,
    logprob real NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: llm_call_logprob_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.llm_call_logprob ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_call_logprob_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id bigint NOT NULL,
    kind character varying(32) DEFAULT ''::character varying NOT NULL,
    ticker character varying(16) DEFAULT ''::character varying NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memories_id_seq OWNED BY public.memories.id;


--
-- Name: memory_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_chunks (
    id bigint NOT NULL,
    memory_id bigint NOT NULL,
    chunk_index smallint NOT NULL,
    text text NOT NULL,
    embedding extensions.vector(384) NOT NULL
);


--
-- Name: memory_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_chunks_id_seq OWNED BY public.memory_chunks.id;


--
-- Name: meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta (
    key character varying(64) NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: momentum_apewisdom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_apewisdom (
    id bigint NOT NULL,
    fecha date NOT NULL,
    ticker text NOT NULL,
    rank integer,
    mentions integer,
    mentions_24h_ago integer,
    upvotes integer
);


--
-- Name: momentum_apewisdom_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.momentum_apewisdom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: momentum_apewisdom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.momentum_apewisdom_id_seq OWNED BY public.momentum_apewisdom.id;


--
-- Name: momentum_candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_candidatos (
    id bigint NOT NULL,
    ticker character varying(10) NOT NULL,
    nombre character varying(80) DEFAULT ''::character varying NOT NULL,
    fecha_evaluacion date NOT NULL,
    filtro_sector_pass boolean,
    filtro_sector_detalle text DEFAULT ''::text NOT NULL,
    estadistica_pass boolean,
    estadistica_detalle text DEFAULT ''::text NOT NULL,
    gate_pass boolean,
    gate_detalle text DEFAULT ''::text NOT NULL,
    decision character varying(12) DEFAULT 'pendiente'::character varying NOT NULL,
    decidido_por character varying(20) DEFAULT 'sistema'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: TABLE momentum_candidatos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.momentum_candidatos IS 'Rastro de candidatos fuera del universo fijo evaluados por el pipeline (ApeWisdom o manual). Checklist de 3 condiciones (sector/estadística/gate); decisión por defecto según §1 del doc, siempre editable a mano.';


--
-- Name: momentum_candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.momentum_candidatos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.momentum_candidatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: momentum_ejecuciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_ejecuciones (
    id bigint NOT NULL,
    senal_id bigint NOT NULL,
    accion character varying(10) NOT NULL,
    acciones numeric NOT NULL,
    precio numeric NOT NULL,
    comision numeric DEFAULT 0 NOT NULL,
    ejecutada_at timestamp with time zone DEFAULT now() NOT NULL,
    notas text DEFAULT ''::text NOT NULL
);


--
-- Name: TABLE momentum_ejecuciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.momentum_ejecuciones IS 'Ejecuciones reales reportadas a mano desde Sala Real X ("marcar ejecutada/vendida"). Nunca las escribe una orden automática -- el agente no ejecuta en IBKR en esta estrategia.';


--
-- Name: momentum_ejecuciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.momentum_ejecuciones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.momentum_ejecuciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: momentum_gate_llamadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_gate_llamadas (
    id bigint NOT NULL,
    senal_id bigint,
    ticker text NOT NULL,
    lanzado_at timestamp with time zone DEFAULT now() NOT NULL,
    terminado_at timestamp with time zone,
    model text,
    reasoning_effort text,
    prompt_cache_hit_tokens integer,
    prompt_cache_miss_tokens integer,
    completion_tokens integer,
    cost_usd double precision,
    latency_ms integer,
    ok boolean,
    pasa boolean,
    motivo text,
    error text,
    candidato_id integer
);


--
-- Name: momentum_gate_llamadas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.momentum_gate_llamadas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: momentum_gate_llamadas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.momentum_gate_llamadas_id_seq OWNED BY public.momentum_gate_llamadas.id;


--
-- Name: momentum_senales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_senales (
    id bigint NOT NULL,
    ticker character varying(10) NOT NULL,
    sector character varying(20) NOT NULL,
    tipo character varying(10) NOT NULL,
    entry_date date NOT NULL,
    entry_price numeric NOT NULL,
    ref_label character varying(20) NOT NULL,
    ref_price numeric NOT NULL,
    caida_pct numeric NOT NULL,
    resuelta boolean DEFAULT false NOT NULL,
    exit_date date,
    ret numeric,
    motivo character varying(10),
    dias integer,
    estado character varying(12) DEFAULT 'nueva'::character varying NOT NULL,
    gate_resultado character varying(10),
    gate_detalle text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ath numeric,
    desde_noticias date,
    cesta_60d numeric,
    gate_regimen boolean,
    ref_price_pico numeric,
    caida_max_pct numeric,
    dias_hasta_min integer,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: TABLE momentum_senales; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.momentum_senales IS 'Señales del motor de momentum (backend/app/momentum/signals.py), universo fijo de 34 tickers. Una fila por señal detectada por el job diario.';


--
-- Name: momentum_senales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.momentum_senales ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.momentum_senales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: momentum_universo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_universo (
    ticker character varying NOT NULL,
    sector character varying NOT NULL,
    nombre character varying DEFAULT ''::character varying NOT NULL,
    origen character varying NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT momentum_universo_origen_check CHECK (((origen)::text = ANY (ARRAY[('original'::character varying)::text, ('incorporado'::character varying)::text])))
);


--
-- Name: momentum_universo_estado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.momentum_universo_estado (
    ticker character varying(10) NOT NULL,
    mantener boolean DEFAULT true NOT NULL,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid
);


--
-- Name: TABLE momentum_universo_estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.momentum_universo_estado IS 'Override manual de "mantener en universo" por ticker fijo (validación histórica, Sala Real X). Sin fila = true por defecto.';


--
-- Name: nasdaq_snapshot_ticker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nasdaq_snapshot_ticker (
    id bigint NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    ticker character varying(16) NOT NULL,
    price double precision NOT NULL,
    volume double precision NOT NULL,
    market_cap double precision,
    name text
);


--
-- Name: nasdaq_snapshot_ticker_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.nasdaq_snapshot_ticker ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.nasdaq_snapshot_ticker_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: personal_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_positions (
    id bigint NOT NULL,
    synced_at timestamp with time zone NOT NULL,
    ticker character varying(48) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    asset_class character varying(8) DEFAULT 'STK'::character varying NOT NULL,
    currency character varying(8) DEFAULT 'USD'::character varying NOT NULL,
    quantity numeric NOT NULL,
    avg_cost numeric,
    mkt_price numeric,
    mkt_value numeric,
    unrealized_pnl numeric
);


--
-- Name: personal_positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.personal_positions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.personal_positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    quantity numeric NOT NULL,
    avg_cost numeric NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    order_ref character varying(48) DEFAULT ''::character varying NOT NULL,
    book character varying(8) DEFAULT 'shadow'::character varying NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.positions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.positions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: precio_cierre; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.precio_cierre (
    ticker character varying(16) NOT NULL,
    dia date NOT NULL,
    cierre numeric(14,4) NOT NULL,
    dividendo numeric(12,6) DEFAULT 0 NOT NULL,
    split numeric(10,6) DEFAULT 1 NOT NULL,
    fuente character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT precio_cierre_cierre_check CHECK ((cierre > (0)::numeric)),
    CONSTRAINT precio_cierre_dividendo_check CHECK ((dividendo >= (0)::numeric)),
    CONSTRAINT precio_cierre_split_check CHECK ((split > (0)::numeric))
);


--
-- Name: proposal_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposal_item (
    id bigint NOT NULL,
    proposal_id bigint NOT NULL,
    posicion smallint NOT NULL,
    ticker character varying(16) NOT NULL,
    action character varying(16) NOT NULL,
    score double precision,
    target_weight_pct double precision NOT NULL,
    price character varying(32),
    target_price double precision,
    upside_pct double precision,
    target_value character varying(32) NOT NULL,
    target_shares double precision NOT NULL,
    delta_shares double precision NOT NULL,
    thesis text DEFAULT ''::text NOT NULL,
    edge text DEFAULT ''::text NOT NULL,
    risk text DEFAULT ''::text NOT NULL,
    high_52w double precision
);


--
-- Name: proposal_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.proposal_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.proposal_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: proposal_omitted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposal_omitted (
    id bigint NOT NULL,
    proposal_id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    reason text DEFAULT ''::text NOT NULL
);


--
-- Name: proposal_omitted_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.proposal_omitted ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.proposal_omitted_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposals (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    cash_target_pct double precision DEFAULT 0.0 NOT NULL,
    macro_summary text DEFAULT ''::text NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: proposals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.proposals ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.proposals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_audit (
    id bigint NOT NULL,
    scan_at timestamp with time zone NOT NULL,
    ticker character varying(16) NOT NULL,
    sector character varying(48) DEFAULT ''::character varying NOT NULL,
    prescore double precision,
    price double precision,
    reached_deep boolean DEFAULT false NOT NULL,
    deep_score double precision,
    selected boolean DEFAULT false NOT NULL,
    funded boolean DEFAULT false NOT NULL,
    decide boolean,
    weight_pct double precision,
    stage character varying(16) DEFAULT ''::character varying NOT NULL,
    entry_lane character varying(12),
    mid_score double precision,
    jev_fundamentals smallint,
    jev_fundamentals_conf smallint,
    jev_valuation smallint,
    jev_valuation_conf smallint,
    jev_financing smallint,
    jev_financing_conf smallint,
    jev_catalyst smallint,
    jev_catalyst_conf smallint,
    jev_funded boolean,
    scan_run_id bigint
);


--
-- Name: scan_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_audit ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.scan_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_change; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_change (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    posicion smallint NOT NULL,
    texto text NOT NULL
);


--
-- Name: scan_run_change_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_change ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_change_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_construction_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_construction_item (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    posicion smallint NOT NULL,
    ticker character varying(16) NOT NULL,
    action character varying(16) NOT NULL,
    score double precision,
    target_weight_pct double precision NOT NULL,
    price character varying(32),
    target_price double precision,
    upside_pct double precision,
    target_value character varying(32) NOT NULL,
    target_shares double precision NOT NULL,
    delta_shares double precision NOT NULL,
    thesis text DEFAULT ''::text NOT NULL,
    edge text DEFAULT ''::text NOT NULL,
    risk text DEFAULT ''::text NOT NULL,
    high_52w double precision
);


--
-- Name: scan_run_construction_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_construction_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_construction_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_construction_omitted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_construction_omitted (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    reason text DEFAULT ''::text NOT NULL
);


--
-- Name: scan_run_construction_omitted_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_construction_omitted ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_construction_omitted_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_cost_breakdown; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_cost_breakdown (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    dimension character varying(8) NOT NULL,
    clave character varying(32) NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    cache_hit_tokens integer DEFAULT 0 NOT NULL,
    cache_miss_tokens integer DEFAULT 0 NOT NULL,
    peak_calls integer DEFAULT 0 NOT NULL,
    cost_usd double precision DEFAULT 0 NOT NULL
);


--
-- Name: scan_run_cost_breakdown_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_cost_breakdown ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_cost_breakdown_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_failure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_failure (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    etapa character varying(16) NOT NULL,
    error text,
    raw text
);


--
-- Name: scan_run_failure_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_failure ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_failure_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_finalist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_finalist (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    posicion smallint NOT NULL,
    ticker character varying(16) NOT NULL,
    sector character varying(48),
    prescore double precision,
    price double precision,
    market_cap double precision,
    deep_score double precision,
    headline text,
    target_price double precision,
    selected boolean DEFAULT false NOT NULL,
    funded boolean DEFAULT false NOT NULL,
    weight_pct double precision,
    error text,
    report text,
    target_consensus_mean double precision,
    target_echoed_consensus boolean DEFAULT false NOT NULL,
    under_acquisition boolean,
    mid_score double precision,
    high_52w double precision
);


--
-- Name: scan_run_finalist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_finalist ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_finalist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_finalist_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_finalist_news (
    id bigint NOT NULL,
    scan_run_finalist_id bigint NOT NULL,
    posicion smallint NOT NULL,
    texto text NOT NULL
);


--
-- Name: scan_run_finalist_news_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_finalist_news ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_finalist_news_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_issue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_issue (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    posicion smallint NOT NULL,
    texto text NOT NULL
);


--
-- Name: scan_run_issue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_issue ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_issue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_jev_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_jev_item (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    posicion smallint NOT NULL,
    ticker character varying(16) NOT NULL,
    industry character varying(64) DEFAULT ''::character varying NOT NULL,
    score double precision NOT NULL,
    confidence double precision,
    weight_pct double precision NOT NULL
);


--
-- Name: scan_run_jev_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_jev_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_jev_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_macro_headline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_macro_headline (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    fuente character varying(16) NOT NULL,
    posicion smallint NOT NULL,
    texto text NOT NULL
);


--
-- Name: scan_run_macro_headline_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_macro_headline ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.scan_run_macro_headline_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_sector; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_sector (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    stance character varying(8) NOT NULL,
    sector character varying(48) NOT NULL
);


--
-- Name: scan_run_sector_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_sector ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_sector_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_run_timing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_run_timing (
    id bigint NOT NULL,
    scan_run_id bigint NOT NULL,
    fase character varying(16) NOT NULL,
    segundos double precision NOT NULL
);


--
-- Name: scan_run_timing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_timing ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scan_run_timing_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scan_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scan_runs (
    id bigint NOT NULL,
    scan_at timestamp with time zone NOT NULL,
    cadence character varying(32) DEFAULT ''::character varying NOT NULL,
    decide boolean DEFAULT false NOT NULL,
    regime character varying(16) DEFAULT ''::character varying NOT NULL,
    vix double precision,
    outlook text DEFAULT ''::text NOT NULL,
    universe_fuente character varying(16) DEFAULT ''::character varying NOT NULL,
    universe_at character varying(32),
    universe_dias integer,
    universe_size integer DEFAULT 0 NOT NULL,
    universe_sobre_suelo integer,
    counter_scanned integer DEFAULT 0 NOT NULL,
    counter_prescored integer DEFAULT 0 NOT NULL,
    counter_deep integer DEFAULT 0 NOT NULL,
    counter_selected integer DEFAULT 0 NOT NULL,
    counter_positions integer DEFAULT 0 NOT NULL,
    cost_calls integer DEFAULT 0 NOT NULL,
    cost_prompt_tokens integer DEFAULT 0 NOT NULL,
    cost_completion_tokens integer DEFAULT 0 NOT NULL,
    cost_cache_hit_tokens integer DEFAULT 0 NOT NULL,
    cost_cache_miss_tokens integer DEFAULT 0 NOT NULL,
    cost_peak_calls integer DEFAULT 0 NOT NULL,
    cost_usd double precision DEFAULT 0 NOT NULL,
    cost_cache_hit_ratio double precision,
    saldo_antes_usd double precision,
    construction_cash_pct double precision DEFAULT 0 NOT NULL,
    construction_summary text DEFAULT ''::text NOT NULL,
    macro_wiki_events text DEFAULT ''::text NOT NULL,
    macro_wiki_scheduled text DEFAULT ''::text NOT NULL,
    jev_macro boolean,
    error text,
    refreshed integer,
    foto_id bigint,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: scan_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scan_runs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.scan_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: score_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_news (
    id bigint NOT NULL,
    score_id bigint NOT NULL,
    posicion smallint NOT NULL,
    texto text NOT NULL
);


--
-- Name: score_news_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.score_news ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.score_news_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scores (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    ticker character varying(16) NOT NULL,
    sector character varying(48) DEFAULT ''::character varying NOT NULL,
    score double precision NOT NULL,
    headline text DEFAULT ''::text NOT NULL,
    report text DEFAULT ''::text NOT NULL,
    price double precision,
    market_cap double precision,
    held boolean DEFAULT false NOT NULL,
    on_watchlist boolean DEFAULT false NOT NULL,
    under_acquisition boolean
);


--
-- Name: scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scores ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    ticker character varying(16) NOT NULL,
    side character varying(4) NOT NULL,
    quantity numeric NOT NULL,
    price numeric NOT NULL,
    fees numeric DEFAULT 0 NOT NULL,
    order_ref character varying(48) NOT NULL,
    realized_pnl numeric,
    book character varying(8) DEFAULT 'shadow'::character varying NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.trades ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.trades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: universe_ticker; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.universe_ticker (
    id bigint NOT NULL,
    synced_at timestamp with time zone NOT NULL,
    source character varying(64) NOT NULL,
    ticker character varying(32) NOT NULL,
    exchange character varying(32),
    name text,
    asset_type character varying(16),
    sector character varying(64),
    country character varying(64),
    country_code character varying(8),
    isin character varying(16),
    yahoo_symbol character varying(32)
);


--
-- Name: universe_ticker_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.universe_ticker ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.universe_ticker_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: watchlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist (
    id bigint NOT NULL,
    ticker character varying(16) NOT NULL,
    score double precision NOT NULL,
    thesis text DEFAULT ''::text NOT NULL,
    first_seen timestamp with time zone NOT NULL,
    last_seen timestamp with time zone NOT NULL,
    last_high timestamp with time zone NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone,
    updated_by uuid
);


--
-- Name: watchlist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.watchlist ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.watchlist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: currency_conversions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_conversions ALTER COLUMN id SET DEFAULT nextval('public.currency_conversions_id_seq'::regclass);


--
-- Name: memories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories ALTER COLUMN id SET DEFAULT nextval('public.memories_id_seq'::regclass);


--
-- Name: memory_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_chunks ALTER COLUMN id SET DEFAULT nextval('public.memory_chunks_id_seq'::regclass);


--
-- Name: momentum_apewisdom id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_apewisdom ALTER COLUMN id SET DEFAULT nextval('public.momentum_apewisdom_id_seq'::regclass);


--
-- Name: momentum_gate_llamadas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_gate_llamadas ALTER COLUMN id SET DEFAULT nextval('public.momentum_gate_llamadas_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_key UNIQUE (mfa_factor_id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_key UNIQUE (user_id);


--
-- Name: mfa_recovery_codes mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: scim_tokens scim_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_pkey PRIMARY KEY (id);


--
-- Name: scim_users scim_users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: ajustes ajustes_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ajustes
    ADD CONSTRAINT ajustes_pkey PRIMARY KEY (clave);


--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- Name: avisos_error avisos_error_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.avisos_error
    ADD CONSTRAINT avisos_error_pkey PRIMARY KEY (id);


--
-- Name: consentimientos consentimientos_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.consentimientos
    ADD CONSTRAINT consentimientos_pkey PRIMARY KEY (id);


--
-- Name: consentimientos consentimientos_usuario_id_documento_version_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.consentimientos
    ADD CONSTRAINT consentimientos_usuario_id_documento_version_key UNIQUE (usuario_id, documento, version);


--
-- Name: creditos_movimientos creditos_movimientos_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_pkey PRIMARY KEY (id);


--
-- Name: creditos_movimientos creditos_movimientos_usuario_id_idempotencia_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_usuario_id_idempotencia_key UNIQUE (usuario_id, idempotencia);


--
-- Name: estrategias estrategias_casa_clave_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_casa_clave_key UNIQUE (casa_clave);


--
-- Name: estrategias estrategias_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_pkey PRIMARY KEY (id);


--
-- Name: inscripciones inscripciones_jornada_id_estrategia_id_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_jornada_id_estrategia_id_key UNIQUE (jornada_id, estrategia_id);


--
-- Name: inscripciones inscripciones_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_pkey PRIMARY KEY (id);


--
-- Name: jornadas jornadas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.jornadas
    ADD CONSTRAINT jornadas_pkey PRIMARY KEY (id);


--
-- Name: jornadas jornadas_temporada_id_numero_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.jornadas
    ADD CONSTRAINT jornadas_temporada_id_numero_key UNIQUE (temporada_id, numero);


--
-- Name: lecturas lecturas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.lecturas
    ADD CONSTRAINT lecturas_pkey PRIMARY KEY (id);


--
-- Name: lecturas lecturas_ticker_foto_id_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.lecturas
    ADD CONSTRAINT lecturas_ticker_foto_id_key UNIQUE (ticker, foto_id);


--
-- Name: ligas_privadas ligas_privadas_codigo_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ligas_privadas
    ADD CONSTRAINT ligas_privadas_codigo_key UNIQUE (codigo);


--
-- Name: ligas_privadas ligas_privadas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ligas_privadas
    ADD CONSTRAINT ligas_privadas_pkey PRIMARY KEY (id);


--
-- Name: miembros_liga miembros_liga_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.miembros_liga
    ADD CONSTRAINT miembros_liga_pkey PRIMARY KEY (liga_id, usuario_id);


--
-- Name: omega_operaciones omega_operaciones_jornada_id_numero_entrada_dia_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.omega_operaciones
    ADD CONSTRAINT omega_operaciones_jornada_id_numero_entrada_dia_key UNIQUE (jornada_id, numero, entrada_dia);


--
-- Name: omega_operaciones omega_operaciones_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.omega_operaciones
    ADD CONSTRAINT omega_operaciones_pkey PRIMARY KEY (id);


--
-- Name: perfiles perfiles_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles
    ADD CONSTRAINT perfiles_pkey PRIMARY KEY (id);


--
-- Name: perfiles_privados perfiles_privados_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles_privados
    ADD CONSTRAINT perfiles_privados_pkey PRIMARY KEY (id);


--
-- Name: permisos_rol permisos_rol_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.permisos_rol
    ADD CONSTRAINT permisos_rol_pkey PRIMARY KEY (rol, permiso);


--
-- Name: planes_usuario planes_usuario_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.planes_usuario
    ADD CONSTRAINT planes_usuario_pkey PRIMARY KEY (id);


--
-- Name: posiciones posiciones_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.posiciones
    ADD CONSTRAINT posiciones_pkey PRIMARY KEY (inscripcion_id, ticker);


--
-- Name: pruebas pruebas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.pruebas
    ADD CONSTRAINT pruebas_pkey PRIMARY KEY (id);


--
-- Name: pruebas pruebas_usuario_id_idempotencia_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.pruebas
    ADD CONSTRAINT pruebas_usuario_id_idempotencia_key UNIQUE (usuario_id, idempotencia);


--
-- Name: recetas recetas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.recetas
    ADD CONSTRAINT recetas_pkey PRIMARY KEY (id);


--
-- Name: reportes reportes_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.reportes
    ADD CONSTRAINT reportes_pkey PRIMARY KEY (id);


--
-- Name: respuestas_ia respuestas_ia_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.respuestas_ia
    ADD CONSTRAINT respuestas_ia_pkey PRIMARY KEY (id);


--
-- Name: respuestas_ia respuestas_ia_pregunta_hash_ticker_foto_id_key; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.respuestas_ia
    ADD CONSTRAINT respuestas_ia_pregunta_hash_ticker_foto_id_key UNIQUE (pregunta_hash, ticker, foto_id);


--
-- Name: resultados resultados_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.resultados
    ADD CONSTRAINT resultados_pkey PRIMARY KEY (inscripcion_id);


--
-- Name: roles_usuario roles_usuario_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.roles_usuario
    ADD CONSTRAINT roles_usuario_pkey PRIMARY KEY (usuario_id, rol);


--
-- Name: temporadas temporadas_pkey; Type: CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.temporadas
    ADD CONSTRAINT temporadas_pkey PRIMARY KEY (id);


--
-- Name: allocations allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allocations
    ADD CONSTRAINT allocations_pkey PRIMARY KEY (id);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: currency_conversions currency_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_conversions
    ADD CONSTRAINT currency_conversions_pkey PRIMARY KEY (id);


--
-- Name: equity_snapshots equity_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equity_snapshots
    ADD CONSTRAINT equity_snapshots_pkey PRIMARY KEY (id);


--
-- Name: foto foto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foto
    ADD CONSTRAINT foto_pkey PRIMARY KEY (id);


--
-- Name: fundamentals_snapshot fundamentals_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundamentals_snapshot
    ADD CONSTRAINT fundamentals_snapshot_pkey PRIMARY KEY (id);


--
-- Name: fx_rate fx_rate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fx_rate
    ADD CONSTRAINT fx_rate_pkey PRIMARY KEY (id);


--
-- Name: ibkr_exchange ibkr_exchange_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ibkr_exchange
    ADD CONSTRAINT ibkr_exchange_pkey PRIMARY KEY (exchange);


--
-- Name: llm_call_logprob llm_call_logprob_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_call_logprob
    ADD CONSTRAINT llm_call_logprob_pkey PRIMARY KEY (id);


--
-- Name: llm_call llm_call_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_call
    ADD CONSTRAINT llm_call_pkey PRIMARY KEY (id);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: memory_chunks memory_chunks_memory_id_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_chunks
    ADD CONSTRAINT memory_chunks_memory_id_chunk_index_key UNIQUE (memory_id, chunk_index);


--
-- Name: memory_chunks memory_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_chunks
    ADD CONSTRAINT memory_chunks_pkey PRIMARY KEY (id);


--
-- Name: meta meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta
    ADD CONSTRAINT meta_pkey PRIMARY KEY (key);


--
-- Name: momentum_apewisdom momentum_apewisdom_fecha_ticker_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_apewisdom
    ADD CONSTRAINT momentum_apewisdom_fecha_ticker_key UNIQUE (fecha, ticker);


--
-- Name: momentum_apewisdom momentum_apewisdom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_apewisdom
    ADD CONSTRAINT momentum_apewisdom_pkey PRIMARY KEY (id);


--
-- Name: momentum_candidatos momentum_candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_candidatos
    ADD CONSTRAINT momentum_candidatos_pkey PRIMARY KEY (id);


--
-- Name: momentum_candidatos momentum_candidatos_ticker_fecha_evaluacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_candidatos
    ADD CONSTRAINT momentum_candidatos_ticker_fecha_evaluacion_key UNIQUE (ticker, fecha_evaluacion);


--
-- Name: momentum_ejecuciones momentum_ejecuciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_ejecuciones
    ADD CONSTRAINT momentum_ejecuciones_pkey PRIMARY KEY (id);


--
-- Name: momentum_gate_llamadas momentum_gate_llamadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_gate_llamadas
    ADD CONSTRAINT momentum_gate_llamadas_pkey PRIMARY KEY (id);


--
-- Name: momentum_senales momentum_senales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_senales
    ADD CONSTRAINT momentum_senales_pkey PRIMARY KEY (id);


--
-- Name: momentum_senales momentum_senales_ticker_tipo_entry_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_senales
    ADD CONSTRAINT momentum_senales_ticker_tipo_entry_date_key UNIQUE (ticker, tipo, entry_date);


--
-- Name: momentum_universo_estado momentum_universo_estado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_universo_estado
    ADD CONSTRAINT momentum_universo_estado_pkey PRIMARY KEY (ticker);


--
-- Name: momentum_universo momentum_universo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_universo
    ADD CONSTRAINT momentum_universo_pkey PRIMARY KEY (ticker);


--
-- Name: nasdaq_snapshot_ticker nasdaq_snapshot_ticker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nasdaq_snapshot_ticker
    ADD CONSTRAINT nasdaq_snapshot_ticker_pkey PRIMARY KEY (id);


--
-- Name: personal_positions personal_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_positions
    ADD CONSTRAINT personal_positions_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: precio_cierre precio_cierre_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.precio_cierre
    ADD CONSTRAINT precio_cierre_pkey PRIMARY KEY (ticker, dia);


--
-- Name: proposal_item proposal_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_item
    ADD CONSTRAINT proposal_item_pkey PRIMARY KEY (id);


--
-- Name: proposal_omitted proposal_omitted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_omitted
    ADD CONSTRAINT proposal_omitted_pkey PRIMARY KEY (id);


--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: scan_audit scan_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_audit
    ADD CONSTRAINT scan_audit_pkey PRIMARY KEY (id);


--
-- Name: scan_run_change scan_run_change_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_change
    ADD CONSTRAINT scan_run_change_pkey PRIMARY KEY (id);


--
-- Name: scan_run_construction_item scan_run_construction_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_construction_item
    ADD CONSTRAINT scan_run_construction_item_pkey PRIMARY KEY (id);


--
-- Name: scan_run_construction_omitted scan_run_construction_omitted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_construction_omitted
    ADD CONSTRAINT scan_run_construction_omitted_pkey PRIMARY KEY (id);


--
-- Name: scan_run_cost_breakdown scan_run_cost_breakdown_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_cost_breakdown
    ADD CONSTRAINT scan_run_cost_breakdown_pkey PRIMARY KEY (id);


--
-- Name: scan_run_failure scan_run_failure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_failure
    ADD CONSTRAINT scan_run_failure_pkey PRIMARY KEY (id);


--
-- Name: scan_run_finalist_news scan_run_finalist_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_finalist_news
    ADD CONSTRAINT scan_run_finalist_news_pkey PRIMARY KEY (id);


--
-- Name: scan_run_finalist scan_run_finalist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_finalist
    ADD CONSTRAINT scan_run_finalist_pkey PRIMARY KEY (id);


--
-- Name: scan_run_issue scan_run_issue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_issue
    ADD CONSTRAINT scan_run_issue_pkey PRIMARY KEY (id);


--
-- Name: scan_run_jev_item scan_run_jev_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_jev_item
    ADD CONSTRAINT scan_run_jev_item_pkey PRIMARY KEY (id);


--
-- Name: scan_run_macro_headline scan_run_macro_headline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_macro_headline
    ADD CONSTRAINT scan_run_macro_headline_pkey PRIMARY KEY (id);


--
-- Name: scan_run_sector scan_run_sector_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_sector
    ADD CONSTRAINT scan_run_sector_pkey PRIMARY KEY (id);


--
-- Name: scan_run_timing scan_run_timing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_timing
    ADD CONSTRAINT scan_run_timing_pkey PRIMARY KEY (id);


--
-- Name: scan_runs scan_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_runs
    ADD CONSTRAINT scan_runs_pkey PRIMARY KEY (id);


--
-- Name: score_news score_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_news
    ADD CONSTRAINT score_news_pkey PRIMARY KEY (id);


--
-- Name: scores scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scores
    ADD CONSTRAINT scores_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: universe_ticker universe_ticker_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universe_ticker
    ADD CONSTRAINT universe_ticker_pkey PRIMARY KEY (id);


--
-- Name: positions uq_position_ticker_book; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT uq_position_ticker_book UNIQUE (ticker, book);


--
-- Name: equity_snapshots uq_snapshot_day_book; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equity_snapshots
    ADD CONSTRAINT uq_snapshot_day_book UNIQUE (day, book);


--
-- Name: watchlist watchlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_email ON auth.users USING btree (email);


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: mfa_recovery_codes_set_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_recovery_codes_set_id_idx ON auth.mfa_recovery_codes USING btree (mfa_recovery_code_set_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: scim_tokens_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_tokens_expires_at_idx ON auth.scim_tokens USING btree (expires_at);


--
-- Name: scim_tokens_revoked_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_tokens_revoked_at_idx ON auth.scim_tokens USING btree (revoked_at);


--
-- Name: scim_tokens_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_tokens_sso_provider_id_idx ON auth.scim_tokens USING btree (sso_provider_id);


--
-- Name: scim_tokens_token_hash_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX scim_tokens_token_hash_key ON auth.scim_tokens USING btree (token_hash);


--
-- Name: scim_users_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_created_at_idx ON auth.scim_users USING btree (sso_provider_id, created_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_deleted_at_idx ON auth.scim_users USING btree (deleted_at);


--
-- Name: scim_users_external_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX scim_users_external_id_key ON auth.scim_users USING btree (sso_provider_id, external_id) WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: scim_users_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_id_idx ON auth.scim_users USING btree (sso_provider_id, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_sso_provider_id_idx ON auth.scim_users USING btree (sso_provider_id);


--
-- Name: scim_users_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_updated_at_idx ON auth.scim_users USING btree (sso_provider_id, updated_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_user_id_idx ON auth.scim_users USING btree (user_id);


--
-- Name: scim_users_user_name_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX scim_users_user_name_idx ON auth.scim_users USING btree (sso_provider_id, user_name COLLATE "C", id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_name_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX scim_users_user_name_key ON auth.scim_users USING btree (sso_provider_id, user_name) WHERE (deleted_at IS NULL);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: ix_ajustes_actualizado_por; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_ajustes_actualizado_por ON liga.ajustes USING btree (actualizado_por) WHERE (actualizado_por IS NOT NULL);


--
-- Name: ix_auditoria_creada; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_auditoria_creada ON liga.auditoria USING btree (creada);


--
-- Name: ix_avisos_error_estado; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_avisos_error_estado ON liga.avisos_error USING btree (estado, creado);


--
-- Name: ix_creditos_creado_por; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_creditos_creado_por ON liga.creditos_movimientos USING btree (creado_por) WHERE (creado_por IS NOT NULL);


--
-- Name: ix_creditos_lectura; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_creditos_lectura ON liga.creditos_movimientos USING btree (lectura_id) WHERE (lectura_id IS NOT NULL);


--
-- Name: ix_creditos_usuario; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_creditos_usuario ON liga.creditos_movimientos USING btree (usuario_id, creado);


--
-- Name: ix_estrategias_dueno; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_estrategias_dueno ON liga.estrategias USING btree (dueno_id);


--
-- Name: ix_estrategias_receta; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_estrategias_receta ON liga.estrategias USING btree (receta_id) WHERE (receta_id IS NOT NULL);


--
-- Name: ix_inscripciones_estrategia; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_inscripciones_estrategia ON liga.inscripciones USING btree (estrategia_id);


--
-- Name: ix_inscripciones_receta; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_inscripciones_receta ON liga.inscripciones USING btree (receta_id);


--
-- Name: ix_jornadas_foto; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_jornadas_foto ON liga.jornadas USING btree (foto_id) WHERE (foto_id IS NOT NULL);


--
-- Name: ix_ligas_privadas_dueno; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_ligas_privadas_dueno ON liga.ligas_privadas USING btree (dueno_id);


--
-- Name: ix_miembros_liga_usuario; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_miembros_liga_usuario ON liga.miembros_liga USING btree (usuario_id);


--
-- Name: ix_planes_concedido_por; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_planes_concedido_por ON liga.planes_usuario USING btree (concedido_por) WHERE (concedido_por IS NOT NULL);


--
-- Name: ix_planes_usuario; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_planes_usuario ON liga.planes_usuario USING btree (usuario_id, desde);


--
-- Name: ix_pruebas_receta; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_pruebas_receta ON liga.pruebas USING btree (receta_id);


--
-- Name: ix_pruebas_usuario; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_pruebas_usuario ON liga.pruebas USING btree (usuario_id, creada);


--
-- Name: ix_recetas_estrategia; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_recetas_estrategia ON liga.recetas USING btree (estrategia_id);


--
-- Name: ix_reportes_abiertos; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_reportes_abiertos ON liga.reportes USING btree (creado) WHERE (estado = 'abierto'::text);


--
-- Name: ix_reportes_autor; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_reportes_autor ON liga.reportes USING btree (autor_id);


--
-- Name: ix_reportes_resuelto_por; Type: INDEX; Schema: liga; Owner: -
--

CREATE INDEX ix_reportes_resuelto_por ON liga.reportes USING btree (resuelto_por) WHERE (resuelto_por IS NOT NULL);


--
-- Name: ux_perfiles_alias; Type: INDEX; Schema: liga; Owner: -
--

CREATE UNIQUE INDEX ux_perfiles_alias ON liga.perfiles USING btree (alias);


--
-- Name: ix_allocations_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_allocations_book ON public.allocations USING btree (book);


--
-- Name: ix_approvals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_approvals_status ON public.approvals USING btree (status);


--
-- Name: ix_approvals_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_approvals_ticker ON public.approvals USING btree (ticker);


--
-- Name: ix_currency_conversions_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currency_conversions_book ON public.currency_conversions USING btree (book);


--
-- Name: ix_currency_conversions_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_currency_conversions_external_id ON public.currency_conversions USING btree (external_id);


--
-- Name: ix_currency_conversions_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_currency_conversions_order_ref ON public.currency_conversions USING btree (order_ref);


--
-- Name: ix_equity_snapshots_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_equity_snapshots_book ON public.equity_snapshots USING btree (book);


--
-- Name: ix_equity_snapshots_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_equity_snapshots_day ON public.equity_snapshots USING btree (day);


--
-- Name: ix_fundamentals_snapshot_captured_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fundamentals_snapshot_captured_at ON public.fundamentals_snapshot USING btree (captured_at DESC);


--
-- Name: ix_fundamentals_snapshot_foto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fundamentals_snapshot_foto ON public.fundamentals_snapshot USING btree (foto_id, ticker) WHERE (foto_id IS NOT NULL);


--
-- Name: ix_fundamentals_snapshot_ticker_captured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fundamentals_snapshot_ticker_captured ON public.fundamentals_snapshot USING btree (ticker, captured_at DESC);


--
-- Name: ix_fx_rate_currency_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fx_rate_currency_synced ON public.fx_rate USING btree (currency_code, synced_at);


--
-- Name: ix_llm_call_logprob_llm_call_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_llm_call_logprob_llm_call_id ON public.llm_call_logprob USING btree (llm_call_id);


--
-- Name: ix_llm_call_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_llm_call_scan_run_id ON public.llm_call USING btree (scan_run_id);


--
-- Name: ix_llm_call_stage_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_llm_call_stage_at ON public.llm_call USING btree (stage, at);


--
-- Name: ix_llm_call_ticker_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_llm_call_ticker_at ON public.llm_call USING btree (ticker, at);


--
-- Name: ix_momentum_apewisdom_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_momentum_apewisdom_ticker ON public.momentum_apewisdom USING btree (ticker, fecha);


--
-- Name: ix_momentum_gate_llamadas_senal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_momentum_gate_llamadas_senal ON public.momentum_gate_llamadas USING btree (senal_id);


--
-- Name: ix_momentum_gate_llamadas_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_momentum_gate_llamadas_ticker ON public.momentum_gate_llamadas USING btree (ticker, lanzado_at);


--
-- Name: ix_nasdaq_snapshot_ticker_snapshot_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nasdaq_snapshot_ticker_snapshot_at ON public.nasdaq_snapshot_ticker USING btree (snapshot_at);


--
-- Name: ix_nasdaq_snapshot_ticker_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nasdaq_snapshot_ticker_ticker ON public.nasdaq_snapshot_ticker USING btree (ticker);


--
-- Name: ix_personal_positions_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_personal_positions_ticker ON public.personal_positions USING btree (ticker);


--
-- Name: ix_positions_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_positions_book ON public.positions USING btree (book);


--
-- Name: ix_positions_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_positions_ticker ON public.positions USING btree (ticker);


--
-- Name: ix_proposal_item_proposal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_proposal_item_proposal_id ON public.proposal_item USING btree (proposal_id);


--
-- Name: ix_proposal_omitted_proposal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_proposal_omitted_proposal_id ON public.proposal_omitted USING btree (proposal_id);


--
-- Name: ix_push_subscriptions_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_push_subscriptions_endpoint ON public.push_subscriptions USING btree (endpoint);


--
-- Name: ix_scan_audit_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_audit_run ON public.scan_audit USING btree (scan_run_id, ticker);


--
-- Name: ix_scan_audit_scan_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_audit_scan_at ON public.scan_audit USING btree (scan_at);


--
-- Name: ix_scan_audit_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_audit_ticker ON public.scan_audit USING btree (ticker);


--
-- Name: ix_scan_run_change_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_change_scan_run_id ON public.scan_run_change USING btree (scan_run_id);


--
-- Name: ix_scan_run_construction_item_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_construction_item_scan_run_id ON public.scan_run_construction_item USING btree (scan_run_id);


--
-- Name: ix_scan_run_construction_omitted_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_construction_omitted_scan_run_id ON public.scan_run_construction_omitted USING btree (scan_run_id);


--
-- Name: ix_scan_run_cost_breakdown_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_cost_breakdown_scan_run_id ON public.scan_run_cost_breakdown USING btree (scan_run_id);


--
-- Name: ix_scan_run_failure_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_failure_scan_run_id ON public.scan_run_failure USING btree (scan_run_id);


--
-- Name: ix_scan_run_finalist_news_scan_run_finalist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_finalist_news_scan_run_finalist_id ON public.scan_run_finalist_news USING btree (scan_run_finalist_id);


--
-- Name: ix_scan_run_finalist_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_finalist_scan_run_id ON public.scan_run_finalist USING btree (scan_run_id);


--
-- Name: ix_scan_run_issue_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_issue_scan_run_id ON public.scan_run_issue USING btree (scan_run_id);


--
-- Name: ix_scan_run_jev_item_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_jev_item_scan_run_id ON public.scan_run_jev_item USING btree (scan_run_id);


--
-- Name: ix_scan_run_macro_headline_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_macro_headline_scan_run_id ON public.scan_run_macro_headline USING btree (scan_run_id);


--
-- Name: ix_scan_run_sector_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_sector_scan_run_id ON public.scan_run_sector USING btree (scan_run_id);


--
-- Name: ix_scan_run_timing_scan_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_run_timing_scan_run_id ON public.scan_run_timing USING btree (scan_run_id);


--
-- Name: ix_scan_runs_scan_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scan_runs_scan_at ON public.scan_runs USING btree (scan_at);


--
-- Name: ix_score_news_score_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_score_news_score_id ON public.score_news USING btree (score_id);


--
-- Name: ix_scores_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scores_score ON public.scores USING btree (score);


--
-- Name: ix_scores_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_scores_ticker ON public.scores USING btree (ticker);


--
-- Name: ix_trades_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trades_book ON public.trades USING btree (book);


--
-- Name: ix_trades_order_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trades_order_ref ON public.trades USING btree (order_ref);


--
-- Name: ix_trades_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_trades_ticker ON public.trades USING btree (ticker);


--
-- Name: ix_universe_ticker_synced_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_universe_ticker_synced_at ON public.universe_ticker USING btree (synced_at DESC);


--
-- Name: ix_universe_ticker_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_universe_ticker_ticker ON public.universe_ticker USING btree (ticker);


--
-- Name: ix_watchlist_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_watchlist_ticker ON public.watchlist USING btree (ticker);


--
-- Name: memories_ticker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_ticker_idx ON public.memories USING btree (ticker);


--
-- Name: memory_chunks_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_chunks_embedding_hnsw_idx ON public.memory_chunks USING hnsw (embedding extensions.vector_l2_ops);


--
-- Name: memory_chunks_memory_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_chunks_memory_id_idx ON public.memory_chunks USING btree (memory_id);


--
-- Name: ux_foto_una_capturando; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_foto_una_capturando ON public.foto USING btree ((true)) WHERE (estado = 'capturando'::text);


--
-- Name: users liga_alta_usuario; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER liga_alta_usuario AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION liga.alta_usuario();


--
-- Name: users liga_baja_usuario; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER liga_baja_usuario BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION liga.baja_usuario();


--
-- Name: estrategias a_candado; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER a_candado BEFORE INSERT OR UPDATE OF estado ON liga.estrategias FOR EACH ROW EXECUTE FUNCTION liga.estrategias_candado();


--
-- Name: ligas_privadas dueno_se_une; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER dueno_se_une AFTER INSERT ON liga.ligas_privadas FOR EACH ROW EXECUTE FUNCTION liga.dueno_se_une();


--
-- Name: estrategias guarda; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER guarda BEFORE INSERT OR UPDATE ON liga.estrategias FOR EACH ROW EXECUTE FUNCTION liga.estrategias_guarda();


--
-- Name: inscripciones guarda; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER guarda BEFORE INSERT OR UPDATE OF receta_id, estrategia_id ON liga.inscripciones FOR EACH ROW EXECUTE FUNCTION liga.inscripciones_guarda();


--
-- Name: ligas_privadas guarda; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER guarda BEFORE INSERT OR UPDATE ON liga.ligas_privadas FOR EACH ROW EXECUTE FUNCTION liga.ligas_guarda();


--
-- Name: perfiles guarda; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER guarda BEFORE UPDATE ON liga.perfiles FOR EACH ROW EXECUTE FUNCTION liga.perfiles_guarda();


--
-- Name: recetas guarda; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER guarda BEFORE INSERT ON liga.recetas FOR EACH ROW EXECUTE FUNCTION liga.recetas_guarda();


--
-- Name: auditoria solo_anadir; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER solo_anadir BEFORE DELETE OR UPDATE ON liga.auditoria FOR EACH ROW EXECUTE FUNCTION liga.solo_anadir();


--
-- Name: consentimientos solo_anadir; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER solo_anadir BEFORE DELETE OR UPDATE ON liga.consentimientos FOR EACH ROW EXECUTE FUNCTION liga.solo_anadir('auth.users', 'usuario_id');


--
-- Name: creditos_movimientos solo_anadir; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER solo_anadir BEFORE DELETE OR UPDATE ON liga.creditos_movimientos FOR EACH ROW EXECUTE FUNCTION liga.solo_anadir('auth.users', 'usuario_id');


--
-- Name: recetas solo_anadir; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER solo_anadir BEFORE DELETE OR UPDATE ON liga.recetas FOR EACH ROW EXECUTE FUNCTION liga.solo_anadir('liga.estrategias', 'estrategia_id');


--
-- Name: resultados solo_anadir; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER solo_anadir BEFORE DELETE OR UPDATE ON liga.resultados FOR EACH ROW EXECUTE FUNCTION liga.solo_anadir();


--
-- Name: ajustes traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.ajustes FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria('actualizado', 'actualizado_por');


--
-- Name: avisos_error traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.avisos_error FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: estrategias traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.estrategias FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria('actualizada', 'actualizado_por');


--
-- Name: inscripciones traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.inscripciones FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: jornadas traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.jornadas FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: ligas_privadas traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.ligas_privadas FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: omega_operaciones traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.omega_operaciones FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: perfiles traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.perfiles FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: perfiles_privados traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.perfiles_privados FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: pruebas traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.pruebas FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: temporadas traza; Type: TRIGGER; Schema: liga; Owner: -
--

CREATE TRIGGER traza BEFORE UPDATE ON liga.temporadas FOR EACH ROW EXECUTE FUNCTION liga.tocar_auditoria();


--
-- Name: allocations tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.allocations FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: approvals tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: foto tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.foto FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: meta tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.meta FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: momentum_candidatos tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.momentum_candidatos FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: momentum_senales tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.momentum_senales FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: momentum_universo tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.momentum_universo FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: momentum_universo_estado tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.momentum_universo_estado FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria('created_by', 'actualizado_at', 'updated_by');


--
-- Name: positions tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.positions FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: precio_cierre tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.precio_cierre FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: proposals tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: push_subscriptions tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: scan_runs tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.scan_runs FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: trades tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: watchlist tocar_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tocar_auditoria BEFORE INSERT OR UPDATE ON public.watchlist FOR EACH ROW EXECUTE FUNCTION public.tocar_auditoria();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_fkey FOREIGN KEY (mfa_factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_codes mfa_recovery_codes_mfa_recovery_code_set_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_mfa_recovery_code_set_id_fkey FOREIGN KEY (mfa_recovery_code_set_id) REFERENCES auth.mfa_recovery_code_sets(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_tokens scim_tokens_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ajustes ajustes_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ajustes
    ADD CONSTRAINT ajustes_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ajustes ajustes_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ajustes
    ADD CONSTRAINT ajustes_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: avisos_error avisos_error_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.avisos_error
    ADD CONSTRAINT avisos_error_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: avisos_error avisos_error_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.avisos_error
    ADD CONSTRAINT avisos_error_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: avisos_error avisos_error_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.avisos_error
    ADD CONSTRAINT avisos_error_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: consentimientos consentimientos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.consentimientos
    ADD CONSTRAINT consentimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: creditos_movimientos creditos_movimientos_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: creditos_movimientos creditos_movimientos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.creditos_movimientos
    ADD CONSTRAINT creditos_movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: estrategias estrategias_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: estrategias estrategias_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: estrategias estrategias_dueno_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_dueno_id_fkey FOREIGN KEY (dueno_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: estrategias estrategias_receta_fk; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.estrategias
    ADD CONSTRAINT estrategias_receta_fk FOREIGN KEY (receta_id) REFERENCES liga.recetas(id);


--
-- Name: inscripciones inscripciones_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: inscripciones inscripciones_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: inscripciones inscripciones_estrategia_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_estrategia_id_fkey FOREIGN KEY (estrategia_id) REFERENCES liga.estrategias(id);


--
-- Name: inscripciones inscripciones_jornada_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_jornada_id_fkey FOREIGN KEY (jornada_id) REFERENCES liga.jornadas(id);


--
-- Name: inscripciones inscripciones_receta_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.inscripciones
    ADD CONSTRAINT inscripciones_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES liga.recetas(id);


--
-- Name: jornadas jornadas_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.jornadas
    ADD CONSTRAINT jornadas_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: jornadas jornadas_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.jornadas
    ADD CONSTRAINT jornadas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: jornadas jornadas_temporada_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.jornadas
    ADD CONSTRAINT jornadas_temporada_id_fkey FOREIGN KEY (temporada_id) REFERENCES liga.temporadas(id);


--
-- Name: ligas_privadas ligas_privadas_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ligas_privadas
    ADD CONSTRAINT ligas_privadas_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ligas_privadas ligas_privadas_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ligas_privadas
    ADD CONSTRAINT ligas_privadas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ligas_privadas ligas_privadas_dueno_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.ligas_privadas
    ADD CONSTRAINT ligas_privadas_dueno_id_fkey FOREIGN KEY (dueno_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: miembros_liga miembros_liga_liga_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.miembros_liga
    ADD CONSTRAINT miembros_liga_liga_id_fkey FOREIGN KEY (liga_id) REFERENCES liga.ligas_privadas(id) ON DELETE CASCADE;


--
-- Name: miembros_liga miembros_liga_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.miembros_liga
    ADD CONSTRAINT miembros_liga_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: omega_operaciones omega_operaciones_jornada_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.omega_operaciones
    ADD CONSTRAINT omega_operaciones_jornada_id_fkey FOREIGN KEY (jornada_id) REFERENCES liga.jornadas(id);


--
-- Name: perfiles perfiles_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles
    ADD CONSTRAINT perfiles_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: perfiles perfiles_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles
    ADD CONSTRAINT perfiles_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: perfiles perfiles_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles
    ADD CONSTRAINT perfiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: perfiles_privados perfiles_privados_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles_privados
    ADD CONSTRAINT perfiles_privados_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: perfiles_privados perfiles_privados_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles_privados
    ADD CONSTRAINT perfiles_privados_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: perfiles_privados perfiles_privados_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.perfiles_privados
    ADD CONSTRAINT perfiles_privados_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: planes_usuario planes_usuario_concedido_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.planes_usuario
    ADD CONSTRAINT planes_usuario_concedido_por_fkey FOREIGN KEY (concedido_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: planes_usuario planes_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.planes_usuario
    ADD CONSTRAINT planes_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: posiciones posiciones_inscripcion_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.posiciones
    ADD CONSTRAINT posiciones_inscripcion_id_fkey FOREIGN KEY (inscripcion_id) REFERENCES liga.inscripciones(id) ON DELETE CASCADE;


--
-- Name: pruebas pruebas_receta_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.pruebas
    ADD CONSTRAINT pruebas_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES liga.recetas(id) ON DELETE CASCADE;


--
-- Name: pruebas pruebas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.pruebas
    ADD CONSTRAINT pruebas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recetas recetas_estrategia_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.recetas
    ADD CONSTRAINT recetas_estrategia_id_fkey FOREIGN KEY (estrategia_id) REFERENCES liga.estrategias(id) ON DELETE CASCADE;


--
-- Name: reportes reportes_autor_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.reportes
    ADD CONSTRAINT reportes_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: reportes reportes_resuelto_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.reportes
    ADD CONSTRAINT reportes_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: resultados resultados_inscripcion_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.resultados
    ADD CONSTRAINT resultados_inscripcion_id_fkey FOREIGN KEY (inscripcion_id) REFERENCES liga.inscripciones(id);


--
-- Name: roles_usuario roles_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.roles_usuario
    ADD CONSTRAINT roles_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: temporadas temporadas_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.temporadas
    ADD CONSTRAINT temporadas_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: temporadas temporadas_creado_por_fkey; Type: FK CONSTRAINT; Schema: liga; Owner: -
--

ALTER TABLE ONLY liga.temporadas
    ADD CONSTRAINT temporadas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: fundamentals_snapshot fundamentals_snapshot_foto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundamentals_snapshot
    ADD CONSTRAINT fundamentals_snapshot_foto_id_fkey FOREIGN KEY (foto_id) REFERENCES public.foto(id);


--
-- Name: llm_call_logprob llm_call_logprob_llm_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_call_logprob
    ADD CONSTRAINT llm_call_logprob_llm_call_id_fkey FOREIGN KEY (llm_call_id) REFERENCES public.llm_call(id) ON DELETE CASCADE;


--
-- Name: memory_chunks memory_chunks_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_chunks
    ADD CONSTRAINT memory_chunks_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(id) ON DELETE CASCADE;


--
-- Name: momentum_ejecuciones momentum_ejecuciones_senal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.momentum_ejecuciones
    ADD CONSTRAINT momentum_ejecuciones_senal_id_fkey FOREIGN KEY (senal_id) REFERENCES public.momentum_senales(id);


--
-- Name: proposal_item proposal_item_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_item
    ADD CONSTRAINT proposal_item_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;


--
-- Name: proposal_omitted proposal_omitted_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposal_omitted
    ADD CONSTRAINT proposal_omitted_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;


--
-- Name: scan_audit scan_audit_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_audit
    ADD CONSTRAINT scan_audit_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_change scan_run_change_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_change
    ADD CONSTRAINT scan_run_change_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_construction_item scan_run_construction_item_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_construction_item
    ADD CONSTRAINT scan_run_construction_item_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_construction_omitted scan_run_construction_omitted_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_construction_omitted
    ADD CONSTRAINT scan_run_construction_omitted_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_cost_breakdown scan_run_cost_breakdown_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_cost_breakdown
    ADD CONSTRAINT scan_run_cost_breakdown_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_failure scan_run_failure_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_failure
    ADD CONSTRAINT scan_run_failure_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_finalist_news scan_run_finalist_news_scan_run_finalist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_finalist_news
    ADD CONSTRAINT scan_run_finalist_news_scan_run_finalist_id_fkey FOREIGN KEY (scan_run_finalist_id) REFERENCES public.scan_run_finalist(id) ON DELETE CASCADE;


--
-- Name: scan_run_finalist scan_run_finalist_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_finalist
    ADD CONSTRAINT scan_run_finalist_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_issue scan_run_issue_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_issue
    ADD CONSTRAINT scan_run_issue_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_jev_item scan_run_jev_item_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_jev_item
    ADD CONSTRAINT scan_run_jev_item_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_macro_headline scan_run_macro_headline_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_macro_headline
    ADD CONSTRAINT scan_run_macro_headline_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_sector scan_run_sector_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_sector
    ADD CONSTRAINT scan_run_sector_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_run_timing scan_run_timing_scan_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_run_timing
    ADD CONSTRAINT scan_run_timing_scan_run_id_fkey FOREIGN KEY (scan_run_id) REFERENCES public.scan_runs(id) ON DELETE CASCADE;


--
-- Name: scan_runs scan_runs_foto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scan_runs
    ADD CONSTRAINT scan_runs_foto_id_fkey FOREIGN KEY (foto_id) REFERENCES public.foto(id);


--
-- Name: score_news score_news_score_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_news
    ADD CONSTRAINT score_news_score_id_fkey FOREIGN KEY (score_id) REFERENCES public.scores(id) ON DELETE CASCADE;


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: ajustes admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.ajustes TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: avisos_error admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.avisos_error TO authenticated USING (liga.es_admin()) WITH CHECK (liga.es_admin());


--
-- Name: estrategias admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.estrategias TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: inscripciones admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.inscripciones TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: jornadas admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.jornadas TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: ligas_privadas admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.ligas_privadas TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: miembros_liga admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.miembros_liga TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: omega_operaciones admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.omega_operaciones TO authenticated USING (liga.es_admin()) WITH CHECK (liga.es_admin());


--
-- Name: perfiles admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.perfiles TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: posiciones admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.posiciones TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: recetas admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.recetas TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: reportes admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.reportes TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: temporadas admin; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin ON liga.temporadas TO authenticated USING (( SELECT liga.es_admin() AS es_admin)) WITH CHECK (( SELECT liga.es_admin() AS es_admin));


--
-- Name: auditoria admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.auditoria FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: consentimientos admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.consentimientos FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: creditos_movimientos admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.creditos_movimientos FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: lecturas admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.lecturas FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: perfiles_privados admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.perfiles_privados FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: planes_usuario admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.planes_usuario FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: pruebas admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.pruebas FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: respuestas_ia admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.respuestas_ia FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: roles_usuario admin_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY admin_lee ON liga.roles_usuario FOR SELECT TO authenticated USING (( SELECT liga.es_admin() AS es_admin));


--
-- Name: ajustes; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.ajustes ENABLE ROW LEVEL SECURITY;

--
-- Name: auditoria; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.auditoria ENABLE ROW LEVEL SECURITY;

--
-- Name: reportes autor_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY autor_lee ON liga.reportes FOR SELECT TO authenticated USING ((autor_id = ( SELECT auth.uid() AS uid)));


--
-- Name: reportes autor_manda; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY autor_manda ON liga.reportes FOR INSERT TO authenticated WITH CHECK (((autor_id = ( SELECT auth.uid() AS uid)) AND ( SELECT liga.authorize('liga.jugar'::liga.permiso) AS authorize)));


--
-- Name: avisos_error; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.avisos_error ENABLE ROW LEVEL SECURITY;

--
-- Name: estrategias borrar; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY borrar ON liga.estrategias FOR DELETE TO authenticated USING (((dueno_id = ( SELECT auth.uid() AS uid)) AND (estado = 'borrador'::text)));


--
-- Name: lecturas compradas; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY compradas ON liga.lecturas FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM liga.creditos_movimientos m
  WHERE ((m.lectura_id = lecturas.id) AND (m.usuario_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: consentimientos; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.consentimientos ENABLE ROW LEVEL SECURITY;

--
-- Name: estrategias crear; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY crear ON liga.estrategias FOR INSERT TO authenticated WITH CHECK (((dueno_id = ( SELECT auth.uid() AS uid)) AND (tipo = 'usuario'::text) AND ( SELECT liga.authorize('liga.jugar'::liga.permiso) AS authorize)));


--
-- Name: ligas_privadas crear; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY crear ON liga.ligas_privadas FOR INSERT TO authenticated WITH CHECK (((dueno_id = ( SELECT auth.uid() AS uid)) AND ( SELECT liga.authorize('liga.jugar'::liga.permiso) AS authorize)));


--
-- Name: recetas crear; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY crear ON liga.recetas FOR INSERT TO authenticated WITH CHECK ((( SELECT liga.authorize('liga.jugar'::liga.permiso) AS authorize) AND (EXISTS ( SELECT 1
   FROM liga.estrategias e
  WHERE ((e.id = recetas.estrategia_id) AND (e.dueno_id = ( SELECT auth.uid() AS uid)) AND (e.tipo = 'usuario'::text))))));


--
-- Name: creditos_movimientos; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.creditos_movimientos ENABLE ROW LEVEL SECURITY;

--
-- Name: consentimientos dueno_apunta; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_apunta ON liga.consentimientos FOR INSERT TO authenticated WITH CHECK ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ligas_privadas dueno_borra; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_borra ON liga.ligas_privadas FOR DELETE TO authenticated USING ((dueno_id = ( SELECT auth.uid() AS uid)));


--
-- Name: ligas_privadas dueno_edita; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_edita ON liga.ligas_privadas FOR UPDATE TO authenticated USING ((dueno_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((dueno_id = ( SELECT auth.uid() AS uid)));


--
-- Name: perfiles dueno_edita; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_edita ON liga.perfiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: perfiles_privados dueno_edita; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_edita ON liga.perfiles_privados FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: miembros_liga dueno_expulsa; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_expulsa ON liga.miembros_liga FOR DELETE TO authenticated USING (((usuario_id <> ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM liga.ligas_privadas l
  WHERE ((l.id = miembros_liga.liga_id) AND (l.dueno_id = ( SELECT auth.uid() AS uid)))))));


--
-- Name: consentimientos dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.consentimientos FOR SELECT TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: creditos_movimientos dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.creditos_movimientos FOR SELECT TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: perfiles_privados dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.perfiles_privados FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: planes_usuario dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.planes_usuario FOR SELECT TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pruebas dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.pruebas FOR SELECT TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: roles_usuario dueno_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY dueno_lee ON liga.roles_usuario FOR SELECT TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: estrategias editar; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY editar ON liga.estrategias FOR UPDATE TO authenticated USING ((dueno_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((dueno_id = ( SELECT auth.uid() AS uid)) AND (tipo = 'usuario'::text) AND ( SELECT liga.authorize('liga.jugar'::liga.permiso) AS authorize)));


--
-- Name: estrategias; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.estrategias ENABLE ROW LEVEL SECURITY;

--
-- Name: planes_usuario hook_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY hook_lee ON liga.planes_usuario FOR SELECT TO supabase_auth_admin USING (true);


--
-- Name: roles_usuario hook_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY hook_lee ON liga.roles_usuario FOR SELECT TO supabase_auth_admin USING (true);


--
-- Name: inscripciones; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.inscripciones ENABLE ROW LEVEL SECURITY;

--
-- Name: jornadas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.jornadas ENABLE ROW LEVEL SECURITY;

--
-- Name: lecturas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.lecturas ENABLE ROW LEVEL SECURITY;

--
-- Name: estrategias leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.estrategias FOR SELECT TO anon, authenticated USING ((((estado <> 'borrador'::text) AND (NOT oculta)) OR (dueno_id = ( SELECT auth.uid() AS uid))));


--
-- Name: inscripciones leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.inscripciones FOR SELECT TO anon, authenticated USING (true);


--
-- Name: jornadas leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.jornadas FOR SELECT TO anon, authenticated USING (true);


--
-- Name: perfiles leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.perfiles FOR SELECT TO anon, authenticated USING (((NOT oculto) OR (id = ( SELECT auth.uid() AS uid))));


--
-- Name: permisos_rol leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.permisos_rol FOR SELECT TO authenticated USING (true);


--
-- Name: posiciones leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.posiciones FOR SELECT TO authenticated USING (liga.puede_ver_posiciones(inscripcion_id));


--
-- Name: resultados leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.resultados FOR SELECT TO anon, authenticated USING (true);


--
-- Name: temporadas leer; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY leer ON liga.temporadas FOR SELECT TO anon, authenticated USING (true);


--
-- Name: ligas_privadas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.ligas_privadas ENABLE ROW LEVEL SECURITY;

--
-- Name: ligas_privadas miembros_leen; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY miembros_leen ON liga.ligas_privadas FOR SELECT TO authenticated USING (((dueno_id = ( SELECT auth.uid() AS uid)) OR liga.es_miembro(id)));


--
-- Name: miembros_liga miembros_leen; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY miembros_leen ON liga.miembros_liga FOR SELECT TO authenticated USING (liga.es_miembro(liga_id));


--
-- Name: miembros_liga; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.miembros_liga ENABLE ROW LEVEL SECURITY;

--
-- Name: ligas_privadas moderacion_edita; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_edita ON liga.ligas_privadas FOR UPDATE TO authenticated USING (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize)) WITH CHECK (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: perfiles moderacion_edita; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_edita ON liga.perfiles FOR UPDATE TO authenticated USING (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize)) WITH CHECK (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: estrategias moderacion_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_lee ON liga.estrategias FOR SELECT TO authenticated USING ((( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize) AND (estado <> 'borrador'::text)));


--
-- Name: perfiles moderacion_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_lee ON liga.perfiles FOR SELECT TO authenticated USING (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: recetas moderacion_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_lee ON liga.recetas FOR SELECT TO authenticated USING ((( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize) AND (EXISTS ( SELECT 1
   FROM liga.estrategias e
  WHERE ((e.id = recetas.estrategia_id) AND (e.visibilidad = 'publicada'::text))))));


--
-- Name: reportes moderacion_lee; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_lee ON liga.reportes FOR SELECT TO authenticated USING (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: reportes moderacion_resuelve; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderacion_resuelve ON liga.reportes FOR UPDATE TO authenticated USING (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize)) WITH CHECK (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: estrategias moderar; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY moderar ON liga.estrategias FOR UPDATE TO authenticated USING ((( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize) AND (estado <> 'borrador'::text))) WITH CHECK (( SELECT liga.authorize('moderacion.revisar'::liga.permiso) AS authorize));


--
-- Name: omega_operaciones; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.omega_operaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: perfiles; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.perfiles ENABLE ROW LEVEL SECURITY;

--
-- Name: perfiles_privados; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.perfiles_privados ENABLE ROW LEVEL SECURITY;

--
-- Name: permisos_rol; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.permisos_rol ENABLE ROW LEVEL SECURITY;

--
-- Name: planes_usuario; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.planes_usuario ENABLE ROW LEVEL SECURITY;

--
-- Name: posiciones; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.posiciones ENABLE ROW LEVEL SECURITY;

--
-- Name: recetas propias; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY propias ON liga.recetas FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM liga.estrategias e
  WHERE ((e.id = recetas.estrategia_id) AND (e.dueno_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: pruebas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.pruebas ENABLE ROW LEVEL SECURITY;

--
-- Name: recetas publicadas_pro; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY publicadas_pro ON liga.recetas FOR SELECT TO authenticated USING ((( SELECT liga.es_pro() AS es_pro) AND (EXISTS ( SELECT 1
   FROM liga.estrategias e
  WHERE ((e.id = recetas.estrategia_id) AND (e.tipo = 'usuario'::text) AND (e.visibilidad = 'publicada'::text) AND (NOT e.oculta))))));


--
-- Name: recetas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.recetas ENABLE ROW LEVEL SECURITY;

--
-- Name: reportes; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.reportes ENABLE ROW LEVEL SECURITY;

--
-- Name: respuestas_ia; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.respuestas_ia ENABLE ROW LEVEL SECURITY;

--
-- Name: resultados; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.resultados ENABLE ROW LEVEL SECURITY;

--
-- Name: roles_usuario; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.roles_usuario ENABLE ROW LEVEL SECURITY;

--
-- Name: miembros_liga salir; Type: POLICY; Schema: liga; Owner: -
--

CREATE POLICY salir ON liga.miembros_liga FOR DELETE TO authenticated USING ((usuario_id = ( SELECT auth.uid() AS uid)));


--
-- Name: temporadas; Type: ROW SECURITY; Schema: liga; Owner: -
--

ALTER TABLE liga.temporadas ENABLE ROW LEVEL SECURITY;

--
-- Name: allocations admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.allocations TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: approvals admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.approvals TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: currency_conversions admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.currency_conversions TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: equity_snapshots admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.equity_snapshots TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: foto admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.foto TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: fundamentals_snapshot admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.fundamentals_snapshot TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: fx_rate admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.fx_rate TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: ibkr_exchange admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.ibkr_exchange TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: llm_call admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.llm_call TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: llm_call_logprob admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.llm_call_logprob TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: memories admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.memories TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: memory_chunks admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.memory_chunks TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: meta admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.meta TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_apewisdom admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_apewisdom TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_candidatos admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_candidatos TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_ejecuciones admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_ejecuciones TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_gate_llamadas admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_gate_llamadas TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_senales admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_senales TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_universo admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_universo TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: momentum_universo_estado admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.momentum_universo_estado TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: nasdaq_snapshot_ticker admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.nasdaq_snapshot_ticker TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: personal_positions admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.personal_positions TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: positions admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.positions TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: precio_cierre admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.precio_cierre TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: proposal_item admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.proposal_item TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: proposal_omitted admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.proposal_omitted TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: proposals admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.proposals TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: push_subscriptions admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.push_subscriptions TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_audit admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_audit TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_change admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_change TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_construction_item admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_construction_item TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_construction_omitted admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_construction_omitted TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_cost_breakdown admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_cost_breakdown TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_failure admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_failure TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_finalist admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_finalist TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_finalist_news admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_finalist_news TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_issue admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_issue TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_jev_item admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_jev_item TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_macro_headline admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_macro_headline TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_sector admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_sector TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_run_timing admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_run_timing TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scan_runs admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scan_runs TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: score_news admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.score_news TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: scores admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.scores TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: trades admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.trades TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: universe_ticker admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.universe_ticker TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: watchlist admin_salas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_salas ON public.watchlist TO authenticated USING ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2))) WITH CHECK ((( SELECT liga.authorize('admin.salas'::liga.permiso) AS authorize) AND ( SELECT liga.aal2() AS aal2)));


--
-- Name: allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: currency_conversions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.currency_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: equity_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.equity_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: foto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.foto ENABLE ROW LEVEL SECURITY;

--
-- Name: fundamentals_snapshot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fundamentals_snapshot ENABLE ROW LEVEL SECURITY;

--
-- Name: fx_rate; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fx_rate ENABLE ROW LEVEL SECURITY;

--
-- Name: ibkr_exchange; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ibkr_exchange ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_call; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_call ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_call_logprob; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_call_logprob ENABLE ROW LEVEL SECURITY;

--
-- Name: memories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

--
-- Name: memory_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_apewisdom; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_apewisdom ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_candidatos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_candidatos ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_ejecuciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_ejecuciones ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_gate_llamadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_gate_llamadas ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_senales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_senales ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_universo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_universo ENABLE ROW LEVEL SECURITY;

--
-- Name: momentum_universo_estado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.momentum_universo_estado ENABLE ROW LEVEL SECURITY;

--
-- Name: nasdaq_snapshot_ticker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nasdaq_snapshot_ticker ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: precio_cierre; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.precio_cierre ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposal_item ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_omitted; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposal_omitted ENABLE ROW LEVEL SECURITY;

--
-- Name: proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_change; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_change ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_construction_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_construction_item ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_construction_omitted; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_construction_omitted ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_cost_breakdown; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_cost_breakdown ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_failure; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_failure ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_finalist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_finalist ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_finalist_news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_finalist_news ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_issue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_issue ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_jev_item; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_jev_item ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_macro_headline; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_macro_headline ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_sector; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_sector ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_run_timing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_run_timing ENABLE ROW LEVEL SECURITY;

--
-- Name: scan_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: score_news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.score_news ENABLE ROW LEVEL SECURITY;

--
-- Name: scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: universe_ticker; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.universe_ticker ENABLE ROW LEVEL SECURITY;

--
-- Name: watchlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA liga; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA liga TO anon;
GRANT USAGE ON SCHEMA liga TO authenticated;
GRANT USAGE ON SCHEMA liga TO supabase_auth_admin;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;


--
-- Name: FUNCTION aal2(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.aal2() FROM PUBLIC;
GRANT ALL ON FUNCTION liga.aal2() TO authenticated;


--
-- Name: FUNCTION alta_usuario(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.alta_usuario() FROM PUBLIC;


--
-- Name: FUNCTION authorize(p liga.permiso); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.authorize(p liga.permiso) FROM PUBLIC;
GRANT ALL ON FUNCTION liga.authorize(p liga.permiso) TO authenticated;


--
-- Name: FUNCTION baja_usuario(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.baja_usuario() FROM PUBLIC;


--
-- Name: FUNCTION cargar_creditos(p_usuario uuid, p_importe numeric, p_motivo text, p_idempotencia text, p_prueba uuid, p_lectura bigint, p_por uuid); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.cargar_creditos(p_usuario uuid, p_importe numeric, p_motivo text, p_idempotencia text, p_prueba uuid, p_lectura bigint, p_por uuid) FROM PUBLIC;


--
-- Name: FUNCTION custom_access_token_hook(event jsonb); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.custom_access_token_hook(event jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION liga.custom_access_token_hook(event jsonb) TO supabase_auth_admin;


--
-- Name: FUNCTION dueno_se_une(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.dueno_se_une() FROM PUBLIC;


--
-- Name: FUNCTION es_admin(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.es_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION liga.es_admin() TO authenticated;


--
-- Name: FUNCTION es_miembro(p_liga uuid); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.es_miembro(p_liga uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION liga.es_miembro(p_liga uuid) TO authenticated;


--
-- Name: FUNCTION es_pro(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.es_pro() FROM PUBLIC;
GRANT ALL ON FUNCTION liga.es_pro() TO authenticated;


--
-- Name: FUNCTION estrategias_candado(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.estrategias_candado() FROM PUBLIC;


--
-- Name: FUNCTION estrategias_guarda(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.estrategias_guarda() FROM PUBLIC;


--
-- Name: FUNCTION inscripciones_guarda(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.inscripciones_guarda() FROM PUBLIC;


--
-- Name: FUNCTION ligas_guarda(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.ligas_guarda() FROM PUBLIC;


--
-- Name: FUNCTION perfiles_guarda(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.perfiles_guarda() FROM PUBLIC;


--
-- Name: FUNCTION puede_ver_posiciones(p_inscripcion bigint); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.puede_ver_posiciones(p_inscripcion bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION liga.puede_ver_posiciones(p_inscripcion bigint) TO authenticated;


--
-- Name: FUNCTION recetas_guarda(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.recetas_guarda() FROM PUBLIC;


--
-- Name: FUNCTION solo_anadir(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.solo_anadir() FROM PUBLIC;


--
-- Name: FUNCTION tocar_auditoria(); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.tocar_auditoria() FROM PUBLIC;


--
-- Name: FUNCTION unirse_liga(p_codigo text); Type: ACL; Schema: liga; Owner: -
--

REVOKE ALL ON FUNCTION liga.unirse_liga(p_codigo text) FROM PUBLIC;
GRANT ALL ON FUNCTION liga.unirse_liga(p_codigo text) TO authenticated;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION tocar_auditoria(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tocar_auditoria() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tocar_auditoria() TO authenticated;
GRANT ALL ON FUNCTION public.tocar_auditoria() TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE custom_oauth_providers; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.custom_oauth_providers TO postgres;
GRANT ALL ON TABLE auth.custom_oauth_providers TO dashboard_user;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE mfa_recovery_code_sets; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.mfa_recovery_code_sets TO postgres;
GRANT ALL ON TABLE auth.mfa_recovery_code_sets TO dashboard_user;


--
-- Name: TABLE mfa_recovery_codes; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.mfa_recovery_codes TO postgres;
GRANT ALL ON TABLE auth.mfa_recovery_codes TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: -
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE scim_tokens; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.scim_tokens TO postgres;
GRANT ALL ON TABLE auth.scim_tokens TO dashboard_user;


--
-- Name: TABLE scim_users; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.scim_users TO postgres;
GRANT ALL ON TABLE auth.scim_users TO dashboard_user;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE webauthn_challenges; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.webauthn_challenges TO postgres;
GRANT ALL ON TABLE auth.webauthn_challenges TO dashboard_user;


--
-- Name: TABLE webauthn_credentials; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.webauthn_credentials TO postgres;
GRANT ALL ON TABLE auth.webauthn_credentials TO dashboard_user;


--
-- Name: TABLE ajustes; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE liga.ajustes TO authenticated;


--
-- Name: TABLE auditoria; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.auditoria TO authenticated;


--
-- Name: TABLE avisos_error; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.avisos_error TO authenticated;


--
-- Name: COLUMN avisos_error.estado; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(estado) ON TABLE liga.avisos_error TO authenticated;


--
-- Name: TABLE consentimientos; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.consentimientos TO authenticated;


--
-- Name: COLUMN consentimientos.documento; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(documento) ON TABLE liga.consentimientos TO authenticated;


--
-- Name: COLUMN consentimientos.version; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(version) ON TABLE liga.consentimientos TO authenticated;


--
-- Name: TABLE creditos_movimientos; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.creditos_movimientos TO authenticated;


--
-- Name: TABLE estrategias; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.estrategias TO anon;
GRANT SELECT,DELETE ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.nombre; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(nombre),UPDATE(nombre) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.forma; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(forma),UPDATE(forma) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.dibujo; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(dibujo),UPDATE(dibujo) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.color1; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(color1),UPDATE(color1) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.color2; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(color2),UPDATE(color2) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.iniciales; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(iniciales),UPDATE(iniciales) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.visibilidad; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(visibilidad),UPDATE(visibilidad) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.declara_posiciones; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(declara_posiciones),UPDATE(declara_posiciones) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.destacable; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(destacable),UPDATE(destacable) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.estado; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(estado) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.cada_dia_1; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(cada_dia_1),UPDATE(cada_dia_1) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.oculta; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(oculta) ON TABLE liga.estrategias TO authenticated;


--
-- Name: COLUMN estrategias.receta_id; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(receta_id) ON TABLE liga.estrategias TO authenticated;


--
-- Name: TABLE inscripciones; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.inscripciones TO anon;
GRANT SELECT ON TABLE liga.inscripciones TO authenticated;


--
-- Name: TABLE jornadas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.jornadas TO anon;
GRANT SELECT ON TABLE liga.jornadas TO authenticated;


--
-- Name: TABLE lecturas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.lecturas TO authenticated;


--
-- Name: TABLE ligas_privadas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT,DELETE ON TABLE liga.ligas_privadas TO authenticated;


--
-- Name: COLUMN ligas_privadas.nombre; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(nombre),UPDATE(nombre) ON TABLE liga.ligas_privadas TO authenticated;


--
-- Name: COLUMN ligas_privadas.codigo; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(codigo),UPDATE(codigo) ON TABLE liga.ligas_privadas TO authenticated;


--
-- Name: COLUMN ligas_privadas.cupo; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(cupo),UPDATE(cupo) ON TABLE liga.ligas_privadas TO authenticated;


--
-- Name: COLUMN ligas_privadas.oculta; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(oculta) ON TABLE liga.ligas_privadas TO authenticated;


--
-- Name: TABLE miembros_liga; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT,DELETE ON TABLE liga.miembros_liga TO authenticated;


--
-- Name: TABLE omega_operaciones; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.omega_operaciones TO authenticated;


--
-- Name: TABLE perfiles; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.perfiles TO anon;
GRANT SELECT ON TABLE liga.perfiles TO authenticated;


--
-- Name: COLUMN perfiles.alias; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(alias) ON TABLE liga.perfiles TO authenticated;


--
-- Name: COLUMN perfiles.oculto; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(oculto) ON TABLE liga.perfiles TO authenticated;


--
-- Name: TABLE perfiles_privados; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.perfiles_privados TO authenticated;


--
-- Name: COLUMN perfiles_privados.tema; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(tema) ON TABLE liga.perfiles_privados TO authenticated;
GRANT UPDATE(idioma) ON TABLE liga.perfiles_privados TO authenticated;


--
-- Name: TABLE permisos_rol; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.permisos_rol TO authenticated;


--
-- Name: TABLE planes_usuario; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.planes_usuario TO supabase_auth_admin;
GRANT SELECT ON TABLE liga.planes_usuario TO authenticated;


--
-- Name: TABLE posiciones; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.posiciones TO authenticated;


--
-- Name: TABLE pruebas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.pruebas TO authenticated;


--
-- Name: TABLE recetas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.estrategia_id; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(estrategia_id) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.idea; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(idea) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.reglas; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(reglas) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.excluidas; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(excluidas) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.catalogo_version; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(catalogo_version) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.pregunta; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(pregunta) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.peso_negocio; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(peso_negocio) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.peso_precio; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(peso_precio) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.peso_deuda; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(peso_deuda) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.peso_pronto; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(peso_pronto) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.peso_pregunta; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(peso_pregunta) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.n_empresas; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(n_empresas) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.reparto; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(reparto) ON TABLE liga.recetas TO authenticated;


--
-- Name: COLUMN recetas.max_por_sector; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(max_por_sector) ON TABLE liga.recetas TO authenticated;


--
-- Name: TABLE reportes; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.tipo; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(tipo) ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.objeto_id; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(objeto_id) ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.motivo; Type: ACL; Schema: liga; Owner: -
--

GRANT INSERT(motivo) ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.estado; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(estado) ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.resuelto_por; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(resuelto_por) ON TABLE liga.reportes TO authenticated;


--
-- Name: COLUMN reportes.resuelto; Type: ACL; Schema: liga; Owner: -
--

GRANT UPDATE(resuelto) ON TABLE liga.reportes TO authenticated;


--
-- Name: TABLE respuestas_ia; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.respuestas_ia TO authenticated;


--
-- Name: TABLE resultados; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.resultados TO anon;
GRANT SELECT ON TABLE liga.resultados TO authenticated;


--
-- Name: TABLE roles_usuario; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.roles_usuario TO supabase_auth_admin;
GRANT SELECT ON TABLE liga.roles_usuario TO authenticated;


--
-- Name: TABLE temporadas; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.temporadas TO anon;
GRANT SELECT ON TABLE liga.temporadas TO authenticated;


--
-- Name: TABLE v_clasificacion; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.v_clasificacion TO anon;
GRANT SELECT ON TABLE liga.v_clasificacion TO authenticated;


--
-- Name: TABLE v_saldo; Type: ACL; Schema: liga; Owner: -
--

GRANT SELECT ON TABLE liga.v_saldo TO authenticated;


--
-- Name: TABLE allocations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.allocations TO authenticated;
GRANT ALL ON TABLE public.allocations TO service_role;


--
-- Name: SEQUENCE allocations_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.allocations_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.allocations_id_seq TO service_role;


--
-- Name: TABLE approvals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.approvals TO authenticated;
GRANT ALL ON TABLE public.approvals TO service_role;


--
-- Name: SEQUENCE approvals_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.approvals_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.approvals_id_seq TO service_role;


--
-- Name: TABLE currency_conversions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.currency_conversions TO authenticated;
GRANT ALL ON TABLE public.currency_conversions TO service_role;


--
-- Name: SEQUENCE currency_conversions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.currency_conversions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.currency_conversions_id_seq TO service_role;


--
-- Name: TABLE equity_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.equity_snapshots TO authenticated;
GRANT ALL ON TABLE public.equity_snapshots TO service_role;


--
-- Name: SEQUENCE equity_snapshots_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.equity_snapshots_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.equity_snapshots_id_seq TO service_role;


--
-- Name: TABLE foto; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.foto TO authenticated;
GRANT ALL ON TABLE public.foto TO service_role;


--
-- Name: SEQUENCE foto_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.foto_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.foto_id_seq TO service_role;


--
-- Name: TABLE fundamentals_snapshot; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fundamentals_snapshot TO authenticated;
GRANT ALL ON TABLE public.fundamentals_snapshot TO service_role;


--
-- Name: SEQUENCE fundamentals_snapshot_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.fundamentals_snapshot_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.fundamentals_snapshot_id_seq TO service_role;


--
-- Name: TABLE fx_rate; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fx_rate TO authenticated;
GRANT ALL ON TABLE public.fx_rate TO service_role;


--
-- Name: SEQUENCE fx_rate_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.fx_rate_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.fx_rate_id_seq TO service_role;


--
-- Name: TABLE ibkr_exchange; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ibkr_exchange TO authenticated;
GRANT ALL ON TABLE public.ibkr_exchange TO service_role;


--
-- Name: TABLE llm_call; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.llm_call TO authenticated;
GRANT ALL ON TABLE public.llm_call TO service_role;


--
-- Name: SEQUENCE llm_call_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.llm_call_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.llm_call_id_seq TO service_role;


--
-- Name: TABLE llm_call_logprob; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.llm_call_logprob TO authenticated;
GRANT ALL ON TABLE public.llm_call_logprob TO service_role;


--
-- Name: SEQUENCE llm_call_logprob_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.llm_call_logprob_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.llm_call_logprob_id_seq TO service_role;


--
-- Name: TABLE memories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memories TO authenticated;
GRANT ALL ON TABLE public.memories TO service_role;


--
-- Name: SEQUENCE memories_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.memories_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.memories_id_seq TO service_role;


--
-- Name: TABLE memory_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memory_chunks TO authenticated;
GRANT ALL ON TABLE public.memory_chunks TO service_role;


--
-- Name: SEQUENCE memory_chunks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.memory_chunks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.memory_chunks_id_seq TO service_role;


--
-- Name: TABLE meta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meta TO authenticated;
GRANT ALL ON TABLE public.meta TO service_role;


--
-- Name: TABLE momentum_apewisdom; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_apewisdom TO authenticated;
GRANT ALL ON TABLE public.momentum_apewisdom TO service_role;


--
-- Name: SEQUENCE momentum_apewisdom_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.momentum_apewisdom_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.momentum_apewisdom_id_seq TO service_role;


--
-- Name: TABLE momentum_candidatos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_candidatos TO authenticated;
GRANT ALL ON TABLE public.momentum_candidatos TO service_role;


--
-- Name: SEQUENCE momentum_candidatos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.momentum_candidatos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.momentum_candidatos_id_seq TO service_role;


--
-- Name: TABLE momentum_ejecuciones; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_ejecuciones TO authenticated;
GRANT ALL ON TABLE public.momentum_ejecuciones TO service_role;


--
-- Name: SEQUENCE momentum_ejecuciones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.momentum_ejecuciones_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.momentum_ejecuciones_id_seq TO service_role;


--
-- Name: TABLE momentum_gate_llamadas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_gate_llamadas TO authenticated;
GRANT ALL ON TABLE public.momentum_gate_llamadas TO service_role;


--
-- Name: SEQUENCE momentum_gate_llamadas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.momentum_gate_llamadas_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.momentum_gate_llamadas_id_seq TO service_role;


--
-- Name: TABLE momentum_senales; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_senales TO authenticated;
GRANT ALL ON TABLE public.momentum_senales TO service_role;


--
-- Name: SEQUENCE momentum_senales_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.momentum_senales_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.momentum_senales_id_seq TO service_role;


--
-- Name: TABLE momentum_universo; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_universo TO authenticated;
GRANT ALL ON TABLE public.momentum_universo TO service_role;


--
-- Name: TABLE momentum_universo_estado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.momentum_universo_estado TO authenticated;
GRANT ALL ON TABLE public.momentum_universo_estado TO service_role;


--
-- Name: TABLE nasdaq_snapshot_ticker; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nasdaq_snapshot_ticker TO authenticated;
GRANT ALL ON TABLE public.nasdaq_snapshot_ticker TO service_role;


--
-- Name: SEQUENCE nasdaq_snapshot_ticker_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.nasdaq_snapshot_ticker_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.nasdaq_snapshot_ticker_id_seq TO service_role;


--
-- Name: TABLE personal_positions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.personal_positions TO authenticated;
GRANT ALL ON TABLE public.personal_positions TO service_role;


--
-- Name: SEQUENCE personal_positions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.personal_positions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.personal_positions_id_seq TO service_role;


--
-- Name: TABLE positions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.positions TO authenticated;
GRANT ALL ON TABLE public.positions TO service_role;


--
-- Name: SEQUENCE positions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.positions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.positions_id_seq TO service_role;


--
-- Name: TABLE precio_cierre; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.precio_cierre TO authenticated;
GRANT ALL ON TABLE public.precio_cierre TO service_role;


--
-- Name: TABLE proposal_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proposal_item TO authenticated;
GRANT ALL ON TABLE public.proposal_item TO service_role;


--
-- Name: SEQUENCE proposal_item_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.proposal_item_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.proposal_item_id_seq TO service_role;


--
-- Name: TABLE proposal_omitted; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proposal_omitted TO authenticated;
GRANT ALL ON TABLE public.proposal_omitted TO service_role;


--
-- Name: SEQUENCE proposal_omitted_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.proposal_omitted_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.proposal_omitted_id_seq TO service_role;


--
-- Name: TABLE proposals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proposals TO authenticated;
GRANT ALL ON TABLE public.proposals TO service_role;


--
-- Name: SEQUENCE proposals_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.proposals_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.proposals_id_seq TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: SEQUENCE push_subscriptions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.push_subscriptions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.push_subscriptions_id_seq TO service_role;


--
-- Name: TABLE scan_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_audit TO authenticated;
GRANT ALL ON TABLE public.scan_audit TO service_role;


--
-- Name: SEQUENCE scan_audit_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_audit_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_audit_id_seq TO service_role;


--
-- Name: TABLE scan_run_change; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_change TO authenticated;
GRANT ALL ON TABLE public.scan_run_change TO service_role;


--
-- Name: SEQUENCE scan_run_change_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_change_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_change_id_seq TO service_role;


--
-- Name: TABLE scan_run_construction_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_construction_item TO authenticated;
GRANT ALL ON TABLE public.scan_run_construction_item TO service_role;


--
-- Name: SEQUENCE scan_run_construction_item_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_construction_item_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_construction_item_id_seq TO service_role;


--
-- Name: TABLE scan_run_construction_omitted; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_construction_omitted TO authenticated;
GRANT ALL ON TABLE public.scan_run_construction_omitted TO service_role;


--
-- Name: SEQUENCE scan_run_construction_omitted_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_construction_omitted_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_construction_omitted_id_seq TO service_role;


--
-- Name: TABLE scan_run_cost_breakdown; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_cost_breakdown TO authenticated;
GRANT ALL ON TABLE public.scan_run_cost_breakdown TO service_role;


--
-- Name: SEQUENCE scan_run_cost_breakdown_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_cost_breakdown_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_cost_breakdown_id_seq TO service_role;


--
-- Name: TABLE scan_run_failure; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_failure TO authenticated;
GRANT ALL ON TABLE public.scan_run_failure TO service_role;


--
-- Name: SEQUENCE scan_run_failure_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_failure_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_failure_id_seq TO service_role;


--
-- Name: TABLE scan_run_finalist; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_finalist TO authenticated;
GRANT ALL ON TABLE public.scan_run_finalist TO service_role;


--
-- Name: SEQUENCE scan_run_finalist_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_finalist_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_finalist_id_seq TO service_role;


--
-- Name: TABLE scan_run_finalist_news; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_finalist_news TO authenticated;
GRANT ALL ON TABLE public.scan_run_finalist_news TO service_role;


--
-- Name: SEQUENCE scan_run_finalist_news_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_finalist_news_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_finalist_news_id_seq TO service_role;


--
-- Name: TABLE scan_run_issue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_issue TO authenticated;
GRANT ALL ON TABLE public.scan_run_issue TO service_role;


--
-- Name: SEQUENCE scan_run_issue_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_issue_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_issue_id_seq TO service_role;


--
-- Name: TABLE scan_run_jev_item; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_jev_item TO authenticated;
GRANT ALL ON TABLE public.scan_run_jev_item TO service_role;


--
-- Name: SEQUENCE scan_run_jev_item_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_jev_item_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_jev_item_id_seq TO service_role;


--
-- Name: TABLE scan_run_macro_headline; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_macro_headline TO authenticated;
GRANT ALL ON TABLE public.scan_run_macro_headline TO service_role;


--
-- Name: SEQUENCE scan_run_macro_headline_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_macro_headline_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_macro_headline_id_seq TO service_role;


--
-- Name: TABLE scan_run_sector; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_sector TO authenticated;
GRANT ALL ON TABLE public.scan_run_sector TO service_role;


--
-- Name: SEQUENCE scan_run_sector_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_sector_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_sector_id_seq TO service_role;


--
-- Name: TABLE scan_run_timing; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_run_timing TO authenticated;
GRANT ALL ON TABLE public.scan_run_timing TO service_role;


--
-- Name: SEQUENCE scan_run_timing_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_run_timing_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_run_timing_id_seq TO service_role;


--
-- Name: TABLE scan_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scan_runs TO authenticated;
GRANT ALL ON TABLE public.scan_runs TO service_role;


--
-- Name: SEQUENCE scan_runs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scan_runs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scan_runs_id_seq TO service_role;


--
-- Name: TABLE score_news; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.score_news TO authenticated;
GRANT ALL ON TABLE public.score_news TO service_role;


--
-- Name: SEQUENCE score_news_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.score_news_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.score_news_id_seq TO service_role;


--
-- Name: TABLE scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.scores TO authenticated;
GRANT ALL ON TABLE public.scores TO service_role;


--
-- Name: SEQUENCE scores_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.scores_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.scores_id_seq TO service_role;


--
-- Name: TABLE trades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trades TO authenticated;
GRANT ALL ON TABLE public.trades TO service_role;


--
-- Name: SEQUENCE trades_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.trades_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.trades_id_seq TO service_role;


--
-- Name: TABLE universe_ticker; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.universe_ticker TO authenticated;
GRANT ALL ON TABLE public.universe_ticker TO service_role;


--
-- Name: SEQUENCE universe_ticker_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.universe_ticker_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.universe_ticker_id_seq TO service_role;


--
-- Name: TABLE watchlist; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.watchlist TO authenticated;
GRANT ALL ON TABLE public.watchlist TO service_role;


--
-- Name: SEQUENCE watchlist_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.watchlist_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.watchlist_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: ensure_rls; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
         WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
   EXECUTE FUNCTION public.rls_auto_enable();


--
-- Borradores de trabajo y visitas autenticadas.
CREATE TABLE liga.borradores (
    usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    clave text NOT NULL,
    contenido jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    creado timestamptz NOT NULL DEFAULT now(),
    creado_por uuid DEFAULT auth.uid(),
    actualizado timestamptz NOT NULL DEFAULT now(),
    actualizado_por uuid DEFAULT auth.uid(),
    PRIMARY KEY (usuario_id, clave),
    CHECK (octet_length(contenido::text) <= 40000)
);
ALTER TABLE liga.borradores ENABLE ROW LEVEL SECURITY;
CREATE POLICY propia ON liga.borradores TO authenticated
    USING (usuario_id = (SELECT auth.uid())) WITH CHECK (usuario_id = (SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON liga.borradores TO authenticated;


-- Local review SQL only. The tracked Supabase migration and CI schema are maintained separately.

create table liga.visitas (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  inicio timestamptz not null default clock_timestamp(),
  ultima_actividad timestamptz not null default clock_timestamp()
);

comment on table liga.visitas is
  'Visit history, one row per authenticated visit; usuario_id is the actor.';
comment on column liga.visitas.session_id is
  'Signed Supabase auth session UUID; retained as a grouping key, not an IP or fingerprint.';
comment on column liga.visitas.ultima_actividad is
  'Server timestamp of the most recent qualifying interaction; updates are throttled.';

create index ix_visitas_usuario_inicio on liga.visitas (usuario_id, inicio desc);
create index ix_visitas_sesion_inicio on liga.visitas (usuario_id, session_id, inicio desc);

alter table liga.visitas enable row level security;
create policy admin_lee on liga.visitas for select to authenticated
  using ((select liga.es_admin()));

revoke all on table liga.visitas from public, anon, authenticated;
grant select on table liga.visitas to authenticated;

create function liga.registrar_visita() returns void
  language plpgsql
  security definer
  set search_path to ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_session uuid;
  v_id bigint;
  v_ultima timestamptz;
begin
  if v_usuario is null then
    raise exception 'authenticated identity required' using errcode = '28000';
  end if;

  v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_session is null then
    raise exception 'authenticated session required' using errcode = '28000';
  end if;

  -- Also serializes the first event, where a row lock alone cannot prevent duplicates.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_session::text, 0)
  );

  select v.id, v.ultima_actividad into v_id, v_ultima
  from liga.visitas as v
  where v.usuario_id = v_usuario and v.session_id = v_session
  order by v.inicio desc, v.id desc
  limit 1
  for update;

  if found and v_ultima > pg_catalog.clock_timestamp() - interval '30 minutes' then
    -- Bound storage writes even if an authenticated client calls this directly in a tight loop.
    update liga.visitas as v
    set ultima_actividad = pg_catalog.clock_timestamp()
    where v.id = v_id
      and v.ultima_actividad <= pg_catalog.clock_timestamp() - interval '30 seconds';
  else
    insert into liga.visitas (usuario_id, session_id, inicio, ultima_actividad)
    values (v_usuario, v_session, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
  end if;
end;
$$;

revoke all on function liga.registrar_visita() from public, anon;
grant execute on function liga.registrar_visita() to authenticated;

create function liga.exportar_visitas()
returns table (inicio timestamptz, ultima_actividad timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'authenticated identity required' using errcode = '28000';
  end if;

  return query
  select v.inicio, v.ultima_actividad
  from liga.visitas as v
  where v.usuario_id = v_usuario
  order by v.inicio, v.id;
end;
$$;

revoke all on function liga.exportar_visitas() from public, anon;
grant execute on function liga.exportar_visitas() to authenticated;

-- Vennett strategy review markers. User-scoped and writable only for the owner's strategies.
create table liga.estrategias_revisadas (
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estrategia_id uuid not null references liga.estrategias(id) on delete cascade,
  inscripcion_id bigint references liga.inscripciones(id) on delete set null,
  resultado_inscripcion_id bigint references liga.resultados(inscripcion_id) on delete set null,
  revisada_en timestamptz not null default now(),
  creada timestamptz not null default now(),
  creada_por uuid default auth.uid() references auth.users(id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users(id) on delete set null,
  primary key (usuario_id, estrategia_id)
);

create function liga.estrategias_revisadas_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.usuario_id is distinct from (select auth.uid()) then
    raise exception 'Solo puedes actualizar tus propias revisiones' using errcode = '42501';
  end if;
  if not exists (
    select 1 from liga.estrategias e
    where e.id = new.estrategia_id and e.dueno_id = new.usuario_id and e.tipo = 'usuario'
  ) then
    raise exception 'La estrategia no pertenece a tu cuenta' using errcode = '42501';
  end if;
  if new.inscripcion_id is not null and not exists (
    select 1 from liga.inscripciones i
    where i.id = new.inscripcion_id and i.estrategia_id = new.estrategia_id
  ) then
    raise exception 'La inscripción no pertenece a tu estrategia' using errcode = '42501';
  end if;
  if new.resultado_inscripcion_id is not null and not exists (
    select 1 from liga.resultados r join liga.inscripciones i on i.id = r.inscripcion_id
    where r.inscripcion_id = new.resultado_inscripcion_id
      and i.estrategia_id = new.estrategia_id
  ) then
    raise exception 'El resultado no pertenece a tu estrategia' using errcode = '42501';
  end if;
  new.revisada_en := now();
  return new;
end $$;

create trigger guarda_estrategia_revisada before insert or update
  on liga.estrategias_revisadas for each row execute function liga.estrategias_revisadas_guarda();
create trigger traza before update on liga.estrategias_revisadas
  for each row execute function liga.tocar_auditoria();

alter table liga.estrategias_revisadas enable row level security;
grant select, insert, update (inscripcion_id, resultado_inscripcion_id)
  on liga.estrategias_revisadas to authenticated;

create policy propia_lee on liga.estrategias_revisadas for select to authenticated
  using (usuario_id = (select auth.uid()) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
  ));
create policy propia_crea on liga.estrategias_revisadas for insert to authenticated
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
  ));
create policy propia_edita on liga.estrategias_revisadas for update to authenticated
  using (usuario_id = (select auth.uid()) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
  ))
  with check (usuario_id = (select auth.uid()) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'
  ));

-- PostgreSQL database dump complete
--


--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: permisos_rol; Type: TABLE DATA; Schema: liga; Owner: -
--

INSERT INTO liga.permisos_rol VALUES ('usuario', 'liga.jugar');
INSERT INTO liga.permisos_rol VALUES ('moderador', 'liga.jugar');
INSERT INTO liga.permisos_rol VALUES ('moderador', 'moderacion.revisar');
INSERT INTO liga.permisos_rol VALUES ('admin', 'liga.jugar');
INSERT INTO liga.permisos_rol VALUES ('admin', 'moderacion.revisar');
INSERT INTO liga.permisos_rol VALUES ('admin', 'admin.liga');
INSERT INTO liga.permisos_rol VALUES ('admin', 'admin.salas');


--
-- PostgreSQL database dump complete
--




CREATE FUNCTION liga.confirmar_bienvenida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
declare regalo numeric;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    select coalesce((select (a.valor #>> '{}')::numeric from liga.ajustes a
      where a.clave = 'creditos.bienvenida' and jsonb_typeof(a.valor) = 'number'), 15) into regalo;
    if regalo > 0 and not exists (select 1 from liga.creditos_movimientos
      where usuario_id = new.id and idempotencia = 'bienvenida') then
      perform liga.cargar_creditos(new.id, regalo, 'regalo', 'bienvenida');
    end if;
  end if;
  return new;
end $$;
REVOKE ALL ON FUNCTION liga.confirmar_bienvenida() FROM PUBLIC;
CREATE TRIGGER liga_confirmar_bienvenida AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION liga.confirmar_bienvenida();

-- liga_020: estrategias que jugaron una jornada sin su pregunta propia.
create table liga.formaciones_degradadas (
  inscripcion_id bigint primary key references liga.inscripciones (id) on delete cascade,
  motivo text not null check (motivo in ('sin_ia', 'tope', 'incompleta', 'tiempo')),
  creada timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null
);
alter table liga.formaciones_degradadas enable row level security;
revoke all on table liga.formaciones_degradadas from public, anon, authenticated;
grant select on table liga.formaciones_degradadas to authenticated;
create policy dueno_lee on liga.formaciones_degradadas for select to authenticated
  using (exists (
    select 1 from liga.inscripciones i
    join liga.estrategias e on e.id = i.estrategia_id
    where i.id = inscripcion_id and e.dueno_id = (select auth.uid())));
create policy admin_lee on liga.formaciones_degradadas for select to authenticated
  using ((select liga.es_admin()));

-- liga_022: la foto y el escaneo que se fijan en una jornada tienen que ser pareja.
create or replace function liga.jornadas_foto_y_escaneo() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  foto_del_escaneo bigint;
begin
  if new.scan_run_id is null and new.foto_id is null then
    return new;
  end if;
  select s.foto_id into foto_del_escaneo from public.scan_runs s where s.id = new.scan_run_id;
  if new.scan_run_id is null or new.foto_id is distinct from foto_del_escaneo then
    raise exception 'La foto y el escaneo de la jornada tienen que ser los mismos'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function liga.jornadas_foto_y_escaneo() from public;
create trigger foto_y_escaneo before insert or update of foto_id, scan_run_id on liga.jornadas
for each row execute function liga.jornadas_foto_y_escaneo();
