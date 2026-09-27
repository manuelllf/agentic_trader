-- liga_009 · Los equipos de la casa se inscriben sin receta: su cartera sale de las salas (Lambda,
-- Alpha y Omega), no del catálogo. Solo ellos: una estrategia de usuario juega siempre con una
-- versión de su receta, y eso lo sigue diciendo la BD.
alter table liga.inscripciones alter column receta_id drop not null;

create function liga.inscripciones_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.receta_id is null and not exists (
       select 1 from liga.estrategias e where e.id = new.estrategia_id and e.tipo = 'casa') then
    raise exception 'Solo los equipos de la casa se inscriben sin receta' using errcode = '23502';
  end if;
  return new;
end $$;
create trigger guarda before insert or update of receta_id, estrategia_id on liga.inscripciones
  for each row execute function liga.inscripciones_guarda();

revoke execute on all functions in schema liga from public;
