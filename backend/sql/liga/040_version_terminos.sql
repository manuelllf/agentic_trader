-- liga_040 · La cuenta debe aceptar los términos vigentes antes de continuar o pagar.
-- Las aceptaciones anteriores se conservan como historial.
create or replace function liga.version_terminos() returns text
language sql immutable set search_path = '' as $$
  select '2'::text;
$$;

revoke execute on function liga.version_terminos() from public, anon;
grant execute on function liga.version_terminos() to authenticated;

create or replace function liga.aceptar_terminos() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  insert into liga.consentimientos (usuario_id, documento, version)
    values (auth.uid(), 'terminos', liga.version_terminos()), (auth.uid(), 'privacidad', liga.version_terminos())
    on conflict (usuario_id, documento, version) do nothing;
end $$;

create or replace function liga.cuenta_pendiente() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from liga.consentimientos c
                     where c.usuario_id = auth.uid() and c.documento = 'terminos'
                       and c.version = liga.version_terminos());
$$;

create or replace function liga.alta_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  regalo numeric;
  nombre text;
  abierto boolean;
  registro_publico boolean;
  con_proveedor boolean;
begin
  con_proveedor := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  registro_publico := new.raw_user_meta_data ? 'alias'
    or new.raw_user_meta_data ? 'terminos_version';
  if not con_proveedor and (registro_publico or new.email_confirmed_at is null) then
    select coalesce((select a.valor = 'true'::jsonb from liga.ajustes a
      where a.clave = 'liga.registro.abierto'), false) into abierto;
    if not abierto then
      raise exception 'El registro está cerrado' using errcode = '42501';
    end if;
    nombre := lower(trim(new.raw_user_meta_data ->> 'alias'));
    if nombre is null or nombre !~ '^[a-z0-9_.]{3,20}$' or nombre in ('admin', 'vennett') then
      raise exception 'Nombre de usuario no válido' using errcode = '23514';
    end if;
    if (new.raw_user_meta_data ->> 'terminos_version') is distinct from liga.version_terminos() then
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
      values (new.id, 'terminos', liga.version_terminos()), (new.id, 'privacidad', liga.version_terminos());
  end if;
  if new.email_confirmed_at is not null or con_proveedor then
    regalo := liga.creditos_de_bienvenida();
    if regalo > 0 then
      perform liga.cargar_creditos(new.id, regalo, 'regalo', 'bienvenida');
    end if;
  end if;
  return new;
end $$;
