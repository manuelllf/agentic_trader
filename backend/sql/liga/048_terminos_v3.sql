-- liga_048 · Términos versión 3: el texto nuevo (gratis, sin planes de pago, blog y boletín).
-- Quien aceptó la 2 vuelve a aceptar la 3 en /completar. Las aceptaciones anteriores se conservan.
create or replace function liga.version_terminos() returns text
language sql immutable set search_path = '' as $$
  select '3'::text;
$$;

revoke execute on function liga.version_terminos() from public, anon;
grant execute on function liga.version_terminos() to authenticated;
