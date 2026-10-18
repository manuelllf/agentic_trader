-- liga_051 · Edad declarada en años (14 a 120) en el alta; el premio anual cuenta a quien declara 18 o más.
-- Se declara una vez: lo impide `liga.edad_una_vez`, salvo a un admin. Sustituye a la casilla de 049.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table liga.perfiles_privados
  add column if not exists edad smallint,
  add column if not exists edad_declarada_en timestamptz;

alter table liga.perfiles_privados
  add constraint perfiles_privados_edad_rango check (edad is null or edad between 14 and 120);

alter table liga.perfiles_privados drop column if exists mayor_edad_confirmada_en;

comment on column liga.perfiles_privados.edad is 'Edad en años que declara la cuenta. Nula hasta que la declara; solo una vez.';
comment on column liga.perfiles_privados.edad_declarada_en is 'Cuándo declaró la cuenta su edad por primera vez.';

grant select (edad, edad_declarada_en), update (edad) on liga.perfiles_privados to authenticated;

create or replace function liga.edad_una_vez() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.edad is distinct from old.edad then
    if old.edad is not null and not liga.es_admin() then
      raise exception 'La edad ya está declarada' using errcode = '42501';
    end if;
    if old.edad is null then
      new.edad_declarada_en := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists edad_una_vez on liga.perfiles_privados;
create trigger edad_una_vez before update on liga.perfiles_privados
  for each row execute function liga.edad_una_vez();

create or replace function liga.version_terminos() returns text
language sql immutable set search_path = '' as $$
  select '4'::text;
$$;

revoke execute on function liga.version_terminos() from public, anon;
grant execute on function liga.version_terminos() to authenticated;

create or replace function liga.alta_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  regalo numeric;
  nombre text;
  abierto boolean;
  registro_publico boolean;
  con_proveedor boolean;
  edad_texto text;
  edad_alta integer;
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
    edad_texto := new.raw_user_meta_data ->> 'edad';
    edad_alta := case when edad_texto ~ '^[0-9]{1,3}$' then edad_texto::integer end;
    if edad_alta is null or edad_alta not between 14 and 120 then
      raise exception 'Edad no válida' using errcode = '23514';
    end if;
  else
    nombre := 'jugador_' || left(replace(new.id::text, '-', ''), 12);
  end if;
  insert into liga.perfiles (id, alias) values (new.id, nombre);
  insert into liga.perfiles_privados (id, edad, edad_declarada_en)
    values (new.id, edad_alta, case when edad_alta is not null then now() end);
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
