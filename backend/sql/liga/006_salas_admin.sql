-- liga_006 · Las tablas de las salas (public) pasan de «RLS sin políticas» a una política
-- explícita: solo el admin con 2FA de esta sesión (aal2). Plan §7.3 y §7.4.
-- Hoy el backend entra como `postgres` (BYPASSRLS) y esto no cambia nada; cuando las rutas de admin
-- usen la identidad del admin (ADMIN_RLS), esta política es la que decide.
do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists admin_salas on public.%I', t.relname);
    execute format($f$create policy admin_salas on public.%I for all to authenticated
      using ((select liga.authorize('admin.salas')) and (select liga.aal2()))
      with check ((select liga.authorize('admin.salas')) and (select liga.aal2()))$f$,
      t.relname);
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;
