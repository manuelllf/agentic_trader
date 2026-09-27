-- B13 · Permisos de public (docs/liguilla/cambios-bbdd.md).
-- rls_auto_enable es la función del disparador de eventos `ensure_rls`: activa RLS en cada tabla
-- nueva de public. Es security definer y la podía ejecutar cualquiera por /rest/v1/rpc.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- anon no entra en las tablas de las salas. Hoy ya lo frena RLS sin políticas; ahora también el
-- permiso, y las tablas nuevas de public nacen sin él. La lectura pública de la liga se concede
-- tabla a tabla y a propósito.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
