-- Al borrar una cuenta, sus estrategias dejan de jugar y de enseñarse: sin esto, `dueno_id` pasa a
-- null (on delete set null) pero el estado sigue en 'apuntada'/'jugando', `formar` las inscribe
-- cada jornada pagando su pregunta, y las publicadas siguen dando sus reglas a los Pro. Sus
-- jornadas y resultados ya jugados no se tocan (la clasificación histórica sigue intacta).
--
-- Va en un disparador de `auth.users` y no en el código: vale igual si la baja se hace desde la
-- app, desde el panel de Supabase o con la API de administración. BEFORE DELETE: todavía se puede
-- encontrar la estrategia por `dueno_id`, antes de que la cascada lo ponga a null.
create function liga.baja_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update liga.estrategias
     set estado = case when estado in ('apuntada', 'jugando') then 'retirada' else estado end,
         visibilidad = 'privada'
   where dueno_id = old.id and tipo = 'usuario';
  return old;
end $$;
revoke execute on function liga.baja_usuario() from public, anon, authenticated;

create trigger liga_baja_usuario before delete on auth.users
  for each row execute function liga.baja_usuario();
