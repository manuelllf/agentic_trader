-- Acertijo diario y boletin: el backend escribe con la identidad de cada peticion mediante RLS.
-- El publico solo lee los acertijos publicados hasta hoy en Madrid y se apunta con tres funciones.
create schema criptico;
comment on schema criptico is 'Acertijo diario en espanol e ingles y boletin con doble confirmacion.';
revoke all on schema criptico from public;
grant usage on schema criptico to anon, authenticated;

create table criptico.acertijos (
  id bigint generated always as identity primary key,
  idioma text not null check (idioma in ('es', 'en')),
  numero integer not null check (numero >= 1),
  dia date not null, -- Dia del calendario de Madrid en que se sirve.
  pista jsonb not null check (jsonb_typeof(pista) = 'array'), -- Segmentos: texto y papel (def, ind, mat o null).
  longitud smallint not null check (longitud between 2 and 30),
  respuesta text not null check (respuesta ~ '^[A-Z]+$'),
  palabra text not null,
  nivel text not null check (nivel in ('facil', 'media')),
  ayudas jsonb not null check (jsonb_typeof(ayudas) = 'object'), -- Claves: def, ind, mat.
  resolucion text not null,
  concepto text not null,
  ejemplo text not null,
  regla_catalogo text,
  estado text not null default 'borrador' check (estado in ('borrador', 'publicado')),
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  check (longitud = length(respuesta)),
  unique (idioma, numero),
  unique (idioma, dia)
);
create index ix_acertijos_publicados on criptico.acertijos (idioma, dia) where estado = 'publicado';

create table criptico.resultados (
  id bigint generated always as identity primary key,
  acertijo_id bigint not null references criptico.acertijos (id) on delete cascade,
  ayudas_usadas smallint not null check (ayudas_usadas between 0 and 3),
  solucion_vista boolean not null default false,
  creado timestamptz not null default now()
);
create index ix_resultados_acertijo on criptico.resultados (acertijo_id);

create table criptico.suscriptores (
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
create unique index ix_suscriptores_hash_alta on criptico.suscriptores (hash_alta) where hash_alta is not null;
create unique index ix_suscriptores_token_baja on criptico.suscriptores (token_baja);
create index ix_suscriptores_confirmados on criptico.suscriptores (idioma) where estado = 'confirmado';

create table criptico.entregas (
  id bigint generated always as identity primary key,
  acertijo_id bigint not null references criptico.acertijos (id) on delete cascade,
  suscriptor_id bigint not null references criptico.suscriptores (id) on delete cascade,
  estado text not null check (estado in ('enviado', 'error')),
  enviado timestamptz not null default now(),
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  actualizado_en timestamptz,
  actualizado_por uuid references auth.users (id) on delete set null,
  unique (acertijo_id, suscriptor_id)
);

-- Indices de las claves externas que no cubre ninguna clave primaria o unica (como en 007_indices_fk.sql).
create index ix_entregas_suscriptor on criptico.entregas (suscriptor_id);
create index ix_acertijos_creado_por on criptico.acertijos (creado_por) where creado_por is not null;
create index ix_acertijos_actualizado_por on criptico.acertijos (actualizado_por) where actualizado_por is not null;
create index ix_suscriptores_creado_por on criptico.suscriptores (creado_por) where creado_por is not null;
create index ix_suscriptores_actualizado_por on criptico.suscriptores (actualizado_por) where actualizado_por is not null;
create index ix_entregas_creado_por on criptico.entregas (creado_por) where creado_por is not null;
create index ix_entregas_actualizado_por on criptico.entregas (actualizado_por) where actualizado_por is not null;

alter table criptico.acertijos enable row level security;
create policy admin on criptico.acertijos
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on criptico.acertijos
  for each row execute function liga.tocar_auditoria();

alter table criptico.resultados enable row level security;
create policy registra on criptico.resultados for insert to anon, authenticated
  with check (exists (select 1 from criptico.acertijos a
    where a.id = acertijo_id and a.estado = 'publicado'
      and a.dia <= (now() at time zone 'Europe/Madrid')::date));
create policy admin on criptico.resultados for select to authenticated
  using (liga.es_admin());

alter table criptico.suscriptores enable row level security;
create policy admin on criptico.suscriptores
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on criptico.suscriptores
  for each row execute function liga.tocar_auditoria();

alter table criptico.entregas enable row level security;
create policy admin on criptico.entregas
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
create trigger traza before update on criptico.entregas
  for each row execute function liga.tocar_auditoria();

-- Solo anon: un usuario con sesion no debe poder leer la respuesta del dia por la tabla.
create policy publico on criptico.acertijos for select to anon
  using (estado = 'publicado' and dia <= (now() at time zone 'Europe/Madrid')::date);

revoke all on criptico.acertijos from anon;
grant select (id, idioma, numero, dia, pista, longitud, nivel, ayudas, estado) on criptico.acertijos to anon;
grant select on criptico.acertijos to authenticated;
grant insert on criptico.resultados to anon, authenticated;
grant select on criptico.resultados to authenticated;
grant select, update, delete on criptico.suscriptores to authenticated;
grant select on criptico.entregas to authenticated;

create function criptico.suscribir(p_correo text, p_idioma text, p_hash_alta text, p_token_baja text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into criptico.suscriptores (correo, idioma, hash_alta, alta_expira, token_baja)
  values (p_correo, p_idioma, p_hash_alta, now() + interval '7 days', p_token_baja)
  on conflict (correo) do update
    set estado = 'pendiente', hash_alta = excluded.hash_alta,
        alta_expira = excluded.alta_expira, token_baja = excluded.token_baja,
        baja_en = null, idioma = excluded.idioma
    where criptico.suscriptores.estado <> 'confirmado';
  return found;
end;
$$;

create function criptico.confirmar(p_hash text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update criptico.suscriptores
    set estado = 'confirmado', confirmado_en = now(), hash_alta = null, alta_expira = null
    where hash_alta = p_hash and estado = 'pendiente' and alta_expira > now();
  return found;
end;
$$;

create function criptico.dar_de_baja(p_token text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update criptico.suscriptores set estado = 'baja', baja_en = now()
    where token_baja = p_token and estado <> 'baja';
  return exists (select 1 from criptico.suscriptores where token_baja = p_token);
end;
$$;

revoke execute on function criptico.suscribir(text, text, text, text), criptico.confirmar(text), criptico.dar_de_baja(text)
  from public;
grant execute on function criptico.suscribir(text, text, text, text), criptico.confirmar(text), criptico.dar_de_baja(text)
  to anon, authenticated;

-- Sin security_invoker: es un agregado publico y anon no tiene lectura de la tabla resultados.
-- Solo se muestran el recuento y la media cuando hay al menos 20 resultados sin ver la solucion.
create view criptico.v_resumen as
select acertijo_id,
  case when count(*) filter (where solucion_vista = false) >= 20
    then count(*) filter (where solucion_vista = false) end as n_media,
  case when count(*) filter (where solucion_vista = false) >= 20
    then round(avg(ayudas_usadas) filter (where solucion_vista = false), 1) end as media
from criptico.resultados
group by acertijo_id;
grant select on criptico.v_resumen to anon, authenticated;

insert into liga.ajustes (clave, valor) values ('criptico.envio.activo', 'false') on conflict do nothing;
