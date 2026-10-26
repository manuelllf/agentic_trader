-- La política de anon no deja ver los publicados de días futuros: la fecha del próximo sale de una función que solo devuelve el día.
create or replace function criptico.fecha_proximo(p_idioma text)
returns date
language sql stable security definer set search_path = criptico, pg_temp
as $$
  select min(dia) from criptico.acertijos
  where idioma = p_idioma and estado = 'publicado'
    and dia > (now() at time zone 'Europe/Madrid')::date;
$$;
revoke all on function criptico.fecha_proximo(text) from public;
grant execute on function criptico.fecha_proximo(text) to anon, authenticated;
