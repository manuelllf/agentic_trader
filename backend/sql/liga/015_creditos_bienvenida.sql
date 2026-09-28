-- Regalo único de bienvenida: al crearse una cuenta recibe créditos una sola vez (sustituye a los
-- créditos mensuales de Pro, que ya no existen). El importe sale de `liga.ajustes`
-- (`creditos.bienvenida`, 15 si no está; 0 lo apaga). Va en el mismo disparador que crea el
-- perfil, así vale igual si la cuenta se da de alta desde admin, desde el panel de Supabase o con
-- un registro futuro. Idempotente: la clave 'bienvenida' es única por usuario en
-- `liga.cargar_creditos`, así que repetirlo nunca regala dos veces.
create or replace function liga.alta_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  regalo numeric;
begin
  insert into liga.perfiles (id, alias)
    values (new.id, 'jugador_' || left(replace(new.id::text, '-', ''), 12));
  insert into liga.perfiles_privados (id) values (new.id);
  insert into liga.roles_usuario (usuario_id, rol) values (new.id, 'usuario');

  select coalesce(
    (select (a.valor #>> '{}')::numeric from liga.ajustes a
      where a.clave = 'creditos.bienvenida' and jsonb_typeof(a.valor) = 'number'),
    15) into regalo;
  if regalo > 0 then
    perform liga.cargar_creditos(new.id, regalo, 'regalo', 'bienvenida');
  end if;
  return new;
end $$;
