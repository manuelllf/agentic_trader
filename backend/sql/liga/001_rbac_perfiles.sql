-- liga_001 · Esquema, roles (RBAC), perfiles, planes y consentimientos.
-- Plan: docs/liguilla/plan-implementacion.md §5 y §7. Todo el acceso de usuarios va por el backend
-- con la identidad de cada petición (SET LOCAL ROLE + request.jwt.claims): estas políticas deciden.
-- El backend como `postgres` (dueño, BYPASSRLS) es el "sistema": solo lo usan los procesos.

create schema liga;
comment on schema liga is
  'Producto liguilla. Lo lee y escribe el backend con la identidad de cada usuario (RLS).';
revoke all on schema liga from public;
grant usage on schema liga to anon, authenticated, supabase_auth_admin;
-- Ninguna función de liga es ejecutable por defecto: cada migración termina quitando el EXECUTE de
-- PUBLIC (los privilegios por defecto de un esquema no pueden quitarlo) y concede a propósito.

create type liga.rol as enum ('usuario', 'moderador', 'admin');
create type liga.permiso as enum ('liga.jugar', 'moderacion.revisar', 'admin.liga', 'admin.salas');
create type liga.plan as enum ('gratis', 'pro');

-- ---- Identidad -------------------------------------------------------------------------------

create table liga.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  alias text not null,
  oculto boolean not null default false,
  creado timestamptz not null default now(),
  constraint alias_formato check (alias ~ '^[a-z0-9_.]{3,20}$'),
  constraint alias_reservado check (alias not in (
    'admin', 'administrador', 'alpha', 'beta', 'omega', 'lambda', 'jev', 'liguilla', 'liga',
    'soporte', 'ayuda', 'moderador', 'moderacion', 'casa', 'sistema', 'root', 'staff'))
);
create unique index ux_perfiles_alias on liga.perfiles (alias);

create table liga.perfiles_privados (
  id uuid primary key references auth.users (id) on delete cascade,
  tema text not null default 'auto' check (tema in ('auto', 'claro', 'oscuro')),
  baja_solicitada timestamptz
);

create table liga.roles_usuario (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  rol liga.rol not null,
  concedido timestamptz not null default now(),
  primary key (usuario_id, rol)
);

-- Configuración del RBAC, no datos de usuarios.
create table liga.permisos_rol (
  rol liga.rol not null,
  permiso liga.permiso not null,
  primary key (rol, permiso)
);
insert into liga.permisos_rol (rol, permiso) values
  ('usuario', 'liga.jugar'),
  ('moderador', 'liga.jugar'), ('moderador', 'moderacion.revisar'),
  ('admin', 'liga.jugar'), ('admin', 'moderacion.revisar'), ('admin', 'admin.liga'),
  ('admin', 'admin.salas');

-- Pro es un derecho con fechas, no un rol. Sin pasarela: lo concede el admin (o el modo demo).
create table liga.planes_usuario (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  plan liga.plan not null default 'pro',
  desde timestamptz not null default now(),
  hasta timestamptz,
  origen text not null check (origen in ('admin', 'demo', 'pago')),
  concedido_por uuid references auth.users (id) on delete set null,
  constraint plan_rango check (hasta is null or hasta > desde)
);
create index ix_planes_usuario on liga.planes_usuario (usuario_id, desde);

create table liga.consentimientos (
  id bigint generated always as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  documento text not null check (documento in ('terminos', 'privacidad')),
  version text not null check (length(version) between 1 and 20),
  aceptado timestamptz not null default now(),
  unique (usuario_id, documento, version)
);

-- ---- Comprobaciones que usan las políticas ---------------------------------------------------
-- Consultan la BD, no el claim del token: quitar un rol o un plan tiene efecto inmediato.

create function liga.authorize(p liga.permiso) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from liga.roles_usuario r
    join liga.permisos_rol pr on pr.rol = r.rol
    where r.usuario_id = (select auth.uid()) and pr.permiso = p);
$$;

create function liga.aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

create function liga.es_admin() returns boolean
language sql stable set search_path = '' as $$
  select liga.authorize('admin.liga') and liga.aal2();
$$;

create function liga.es_pro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from liga.planes_usuario
    where usuario_id = (select auth.uid()) and plan = 'pro'
      and desde <= now() and (hasta is null or hasta > now()));
$$;

grant execute on function liga.authorize(liga.permiso), liga.aal2(), liga.es_admin(), liga.es_pro()
  to authenticated;

-- ---- Solo añadir -----------------------------------------------------------------------------
-- Los registros no se tocan. Única excepción: el borrado en cascada cuando desaparece su dueño
-- (tg_argv: tabla padre y columna que la apunta).

create function liga.solo_anadir() returns trigger
language plpgsql set search_path = '' as $$
declare
  existe boolean;
begin
  if tg_op = 'DELETE' and tg_nargs = 2 then
    execute format('select exists (select 1 from %s where id = $1)', tg_argv[0])
      into existe using (to_jsonb(old) ->> tg_argv[1])::uuid;
    if not existe then
      return old;
    end if;
  end if;
  raise exception '%.% es de solo añadir', tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger solo_anadir before update or delete on liga.consentimientos
  for each row execute function liga.solo_anadir('auth.users', 'usuario_id');

-- ---- Perfiles: qué puede cambiar cada uno ----------------------------------------------------
-- Los permisos por columna no distinguen dueño de moderador: esto sí.

create function liga.perfiles_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if new.oculto is distinct from old.oculto and not liga.authorize('moderacion.revisar') then
    raise exception 'Solo moderación puede ocultar un perfil' using errcode = '42501';
  end if;
  if new.alias is distinct from old.alias and old.id is distinct from (select auth.uid()) then
    raise exception 'Solo el dueño cambia su alias' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guarda before update on liga.perfiles
  for each row execute function liga.perfiles_guarda();

-- ---- Alta de usuario -------------------------------------------------------------------------
-- Perfil, datos privados y rol por defecto en la misma transacción que auth.users. El saldo de
-- créditos es una suma: no hay fila que crear.

create function liga.alta_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into liga.perfiles (id, alias)
    values (new.id, 'jugador_' || left(replace(new.id::text, '-', ''), 12));
  insert into liga.perfiles_privados (id) values (new.id);
  insert into liga.roles_usuario (usuario_id, rol) values (new.id, 'usuario');
  return new;
end $$;
create trigger liga_alta_usuario after insert on auth.users
  for each row execute function liga.alta_usuario();

-- ---- Hook del token --------------------------------------------------------------------------
-- Añade `user_role` (el rol más alto) y `plan` a cada token. Solo para la interfaz: lo que
-- protege datos consulta la BD. Lo ejecuta supabase_auth_admin y nadie más.

create function liga.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  rol_mayor liga.rol;
  pro boolean;
begin
  select r.rol into rol_mayor from liga.roles_usuario r where r.usuario_id = uid
    order by case r.rol when 'admin' then 3 when 'moderador' then 2 else 1 end desc limit 1;
  select exists (
    select 1 from liga.planes_usuario p
    where p.usuario_id = uid and p.plan = 'pro'
      and p.desde <= now() and (p.hasta is null or p.hasta > now())) into pro;
  claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(rol_mayor::text), 'null'::jsonb));
  claims := jsonb_set(claims, '{plan}', to_jsonb(case when pro then 'pro' else 'gratis' end));
  return jsonb_set(event, '{claims}', claims);
end $$;

grant execute on function liga.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function liga.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant select on liga.roles_usuario, liga.planes_usuario to supabase_auth_admin;

-- ---- RLS ---------------------------------------------------------------------------------------

alter table liga.perfiles enable row level security;
alter table liga.perfiles_privados enable row level security;
alter table liga.roles_usuario enable row level security;
alter table liga.permisos_rol enable row level security;
alter table liga.planes_usuario enable row level security;
alter table liga.consentimientos enable row level security;

-- perfiles: el alias es público (clasificación); ocultar es de moderación.
grant select on liga.perfiles to anon, authenticated;
grant update (alias, oculto) on liga.perfiles to authenticated;
create policy leer on liga.perfiles for select to anon, authenticated
  using (not oculto or id = (select auth.uid()));
create policy moderacion_lee on liga.perfiles for select to authenticated
  using ((select liga.authorize('moderacion.revisar')));
create policy dueno_edita on liga.perfiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy moderacion_edita on liga.perfiles for update to authenticated
  using ((select liga.authorize('moderacion.revisar')))
  with check ((select liga.authorize('moderacion.revisar')));
create policy admin on liga.perfiles for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

-- perfiles_privados: solo su dueño; el admin lee.
grant select on liga.perfiles_privados to authenticated;
grant update (tema) on liga.perfiles_privados to authenticated;
create policy dueno_lee on liga.perfiles_privados for select to authenticated
  using (id = (select auth.uid()));
create policy dueno_edita on liga.perfiles_privados for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy admin_lee on liga.perfiles_privados for select to authenticated
  using ((select liga.es_admin()));

-- roles_usuario: cada uno ve los suyos; el admin, todos (los concede el sistema con auditoría).
grant select on liga.roles_usuario to authenticated;
create policy dueno_lee on liga.roles_usuario for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_lee on liga.roles_usuario for select to authenticated
  using ((select liga.es_admin()));
create policy hook_lee on liga.roles_usuario for select to supabase_auth_admin using (true);

-- permisos_rol: configuración legible por cualquier usuario con sesión.
grant select on liga.permisos_rol to authenticated;
create policy leer on liga.permisos_rol for select to authenticated using (true);

-- planes_usuario: cada uno ve el suyo; el admin, todos.
grant select on liga.planes_usuario to authenticated;
create policy dueno_lee on liga.planes_usuario for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_lee on liga.planes_usuario for select to authenticated
  using ((select liga.es_admin()));
create policy hook_lee on liga.planes_usuario for select to supabase_auth_admin using (true);

-- consentimientos: el usuario apunta y ve los suyos; el admin lee.
grant select on liga.consentimientos to authenticated;
grant insert (documento, version) on liga.consentimientos to authenticated;
create policy dueno_lee on liga.consentimientos for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy dueno_apunta on liga.consentimientos for insert to authenticated
  with check (usuario_id = (select auth.uid()));
create policy admin_lee on liga.consentimientos for select to authenticated
  using ((select liga.es_admin()));

revoke execute on all functions in schema liga from public;
