-- liga_052 · Términos v5: el premio anual es para 18 o más; la cuenta sin edad declarada sigue pendiente.
create or replace function liga.version_terminos() returns text
language sql immutable set search_path = '' as $$
  select '5'::text;
$$;

revoke execute on function liga.version_terminos() from public, anon;
grant execute on function liga.version_terminos() to authenticated;

create or replace function liga.cuenta_pendiente() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from liga.consentimientos c
                     where c.usuario_id = auth.uid() and c.documento = 'terminos'
                       and c.version = liga.version_terminos())
    or not exists (select 1 from liga.perfiles_privados p
                    where p.id = auth.uid() and p.edad is not null);
$$;
