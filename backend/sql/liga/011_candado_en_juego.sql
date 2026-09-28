-- liga_011 · Dos «apuntar» a la vez del mismo usuario podían saltarse el tope de su plan: el
-- recuento de `guarda` no veía la fila de la otra transacción. Este disparador toma un candado por
-- dueño antes (los disparadores van por orden de nombre: «a_candado» antes que «guarda»), así que
-- el segundo espera al primero y cuenta ya con su fila.
create function liga.estrategias_candado() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.estado in ('apuntada', 'jugando', 'borrador') and new.dueno_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('liga.estrategias:' || new.dueno_id::text, 0));
  end if;
  return new;
end $$;
create trigger a_candado before insert or update of estado on liga.estrategias
  for each row execute function liga.estrategias_candado();

revoke execute on all functions in schema liga from public;
