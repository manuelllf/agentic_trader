-- liga_032 · Cuentas creadas con Google o con un enlace al correo: aceptar términos y saber si
-- falta completar la cuenta. Solo afecta a cuentas con alias jugador_ (las que crea el alta
-- automática) y sin consentimiento de términos.
create or replace function liga.aceptar_terminos() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  insert into liga.consentimientos (usuario_id, documento, version)
    values (auth.uid(), 'terminos', '1'), (auth.uid(), 'privacidad', '1')
    on conflict (usuario_id, documento, version) do nothing;
end $$;

create or replace function liga.cuenta_pendiente() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from liga.perfiles p
                 where p.id = auth.uid() and p.alias like 'jugador\_%')
     and not exists (select 1 from liga.consentimientos c
                     where c.usuario_id = auth.uid() and c.documento = 'terminos');
$$;

revoke execute on function liga.aceptar_terminos(), liga.cuenta_pendiente() from public, anon;
grant execute on function liga.aceptar_terminos(), liga.cuenta_pendiente() to authenticated;
