-- liga_053 · Términos v6: la política de privacidad describe la medición de visitas; todas las cuentas aceptan de nuevo.
create or replace function liga.version_terminos() returns text
language sql immutable set search_path = '' as $$
  select '6'::text;
$$;
revoke execute on function liga.version_terminos() from public, anon;
grant execute on function liga.version_terminos() to authenticated;
