-- Los roles que Supabase trae de serie y que el esquema (esquema_ci.sql) nombra en sus permisos.
-- Solo para la base de pruebas de CI: en producción los crea Supabase.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit login;
create role dashboard_user nologin;
create role supabase_auth_admin noinherit createrole nologin;
create role supabase_admin superuser nologin;
grant anon, authenticated, service_role to authenticator;
