-- Blog y boletín: el backend escribe con la identidad de cada petición mediante RLS.
-- El público solo lee lo publicado y se apunta al boletín con sus tres funciones.
create schema blog;
comment on schema blog is 'Lecciones públicas en español e inglés y boletín con doble confirmación.';
revoke all on schema blog from public;
grant usage on schema blog to anon, authenticated;

create table blog.articulos (
  id bigint generated always as identity primary key,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 120),
  estado text not null default 'borrador' check (estado in ('borrador', 'programado', 'publicado')),
  programado_para timestamptz,
  publicado_en timestamptz,
  avisar_boletin boolean not null default false,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  check (estado <> 'programado' or programado_para is not null),
  check (estado <> 'publicado' or publicado_en is not null)
);
create index ix_articulos_publicados on blog.articulos (publicado_en desc) where estado = 'publicado';
create index ix_articulos_programados on blog.articulos (programado_para) where estado = 'programado';

create table blog.articulo_textos (
  articulo_id bigint not null references blog.articulos (id) on delete cascade,
  idioma text not null check (idioma in ('es', 'en')),
  titulo text not null default '' check (length(titulo) <= 160),
  resumen text not null default '' check (length(resumen) <= 160),
  cuerpo text not null default '' check (length(cuerpo) <= 40000),
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  primary key (articulo_id, idioma)
);

create table blog.suscriptores (
  id bigint generated always as identity primary key,
  correo text not null unique
    check (correo = lower(correo) and length(correo) between 6 and 254
           and correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  idioma text not null check (idioma in ('es', 'en')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'baja')),
  hash_alta text check (hash_alta is null or length(hash_alta) = 64),
  alta_expira timestamptz,
  token_baja text not null check (length(token_baja) between 32 and 100),
  confirmado_en timestamptz,
  baja_en timestamptz,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  check (estado <> 'pendiente' or (hash_alta is not null and alta_expira is not null)),
  check (estado <> 'confirmado' or confirmado_en is not null),
  check (estado <> 'baja' or baja_en is not null)
);
create unique index ix_suscriptores_hash_alta on blog.suscriptores (hash_alta) where hash_alta is not null;
create unique index ix_suscriptores_token_baja on blog.suscriptores (token_baja);
create index ix_suscriptores_confirmados on blog.suscriptores (idioma) where estado = 'confirmado';

create table blog.envios (
  id bigint generated always as identity primary key,
  articulo_id bigint not null references blog.articulos (id) on delete cascade,
  idioma text not null check (idioma in ('es', 'en')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'terminado')),
  terminado_en timestamptz,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  unique (articulo_id, idioma)
);

create table blog.entregas (
  envio_id bigint not null references blog.envios (id) on delete cascade,
  suscriptor_id bigint not null references blog.suscriptores (id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'fallida')),
  intentada_en timestamptz,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  primary key (envio_id, suscriptor_id)
);
create index ix_entregas_pendientes on blog.entregas (envio_id) where estado = 'pendiente';

-- Índices de las claves externas que no cubre ninguna clave primaria o única (como en 007_indices_fk.sql).
create index ix_entregas_suscriptor on blog.entregas (suscriptor_id);
create index ix_articulos_creado_por on blog.articulos (creado_por) where creado_por is not null;
create index ix_articulos_actualizado_por on blog.articulos (actualizado_por) where actualizado_por is not null;
create index ix_articulo_textos_creado_por on blog.articulo_textos (creado_por) where creado_por is not null;
create index ix_articulo_textos_actualizado_por on blog.articulo_textos (actualizado_por) where actualizado_por is not null;
create index ix_suscriptores_creado_por on blog.suscriptores (creado_por) where creado_por is not null;
create index ix_suscriptores_actualizado_por on blog.suscriptores (actualizado_por) where actualizado_por is not null;
create index ix_envios_creado_por on blog.envios (creado_por) where creado_por is not null;
create index ix_envios_actualizado_por on blog.envios (actualizado_por) where actualizado_por is not null;
create index ix_entregas_creado_por on blog.entregas (creado_por) where creado_por is not null;
create index ix_entregas_actualizado_por on blog.entregas (actualizado_por) where actualizado_por is not null;

alter table blog.articulos enable row level security;
create policy admin on blog.articulos
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on blog.articulos
  for each row execute function liga.tocar_auditoria();

alter table blog.articulo_textos enable row level security;
create policy admin on blog.articulo_textos
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on blog.articulo_textos
  for each row execute function liga.tocar_auditoria();

alter table blog.suscriptores enable row level security;
create policy admin on blog.suscriptores
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on blog.suscriptores
  for each row execute function liga.tocar_auditoria();

alter table blog.envios enable row level security;
create policy admin on blog.envios
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on blog.envios
  for each row execute function liga.tocar_auditoria();

alter table blog.entregas enable row level security;
create policy admin on blog.entregas
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on blog.entregas
  for each row execute function liga.tocar_auditoria();

create policy publicado on blog.articulos for select to anon, authenticated
  using (estado = 'publicado');
create policy publicado on blog.articulo_textos for select to anon, authenticated
  using (exists (select 1 from blog.articulos a where a.id = articulo_id and a.estado = 'publicado'));

grant select on blog.articulos, blog.articulo_textos to anon;
grant select, insert, update, delete on blog.articulos, blog.articulo_textos, blog.envios, blog.entregas
  to authenticated;
grant select, update, delete on blog.suscriptores to authenticated;

create function blog.suscribir(p_correo text, p_idioma text, p_hash_alta text, p_token_baja text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into blog.suscriptores (correo, idioma, hash_alta, alta_expira, token_baja)
  values (p_correo, p_idioma, p_hash_alta, now() + interval '7 days', p_token_baja)
  on conflict (correo) do update
    set estado = 'pendiente', hash_alta = excluded.hash_alta,
        alta_expira = excluded.alta_expira, token_baja = excluded.token_baja,
        baja_en = null, idioma = excluded.idioma
    where blog.suscriptores.estado <> 'confirmado';
  return found;
end;
$$;

create function blog.confirmar(p_hash text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update blog.suscriptores
    set estado = 'confirmado', confirmado_en = now(), hash_alta = null, alta_expira = null
    where hash_alta = p_hash and estado = 'pendiente' and alta_expira > now();
  return found;
end;
$$;

create function blog.dar_de_baja(p_token text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update blog.suscriptores set estado = 'baja', baja_en = now()
    where token_baja = p_token and estado <> 'baja';
  return exists (select 1 from blog.suscriptores where token_baja = p_token);
end;
$$;

revoke execute on function blog.suscribir(text, text, text, text), blog.confirmar(text), blog.dar_de_baja(text)
  from public;
grant execute on function blog.suscribir(text, text, text, text), blog.confirmar(text), blog.dar_de_baja(text)
  to anon, authenticated;
