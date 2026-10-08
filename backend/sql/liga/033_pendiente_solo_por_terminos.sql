-- liga_033 · «Pendiente» depende solo de los términos aceptados. Antes también miraba el alias
-- jugador_, y al cambiar el alias la cuenta dejaba de verse como pendiente sin haber aceptado nada.
create or replace function liga.cuenta_pendiente() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from liga.consentimientos c
                     where c.usuario_id = auth.uid() and c.documento = 'terminos');
$$;
