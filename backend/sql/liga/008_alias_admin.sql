-- liga_008 · El alias «admin» es del admin. Sale de la lista fija y lo guarda perfiles_guarda:
-- solo el sistema o un admin con 2FA pueden ponerlo; cualquier otro recibe «reservado».
alter table liga.perfiles drop constraint alias_reservado;
alter table liga.perfiles add constraint alias_reservado check (alias not in (
  'administrador', 'alpha', 'beta', 'omega', 'lambda', 'jev', 'liguilla', 'liga',
  'soporte', 'ayuda', 'moderador', 'moderacion', 'casa', 'sistema', 'root', 'staff'));

create or replace function liga.perfiles_guarda() returns trigger
language plpgsql set search_path = '' as $$
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
