-- liga_034 · El alta por un proveedor externo (Google) no es un registro con contraseña: no pide
-- alias ni términos en el disparador y entra con alias automático. El resto del alta queda igual.
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
  if new.email_confirmed_at is not null or con_proveedor then
    regalo := liga.creditos_de_bienvenida();
    if regalo > 0 then
      perform liga.cargar_creditos(new.id, regalo, 'regalo', 'bienvenida');
    end if;
  end if;
  return new;
end $$;
