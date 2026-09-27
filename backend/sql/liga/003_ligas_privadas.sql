-- liga_003 · Ligas privadas (Pro). Plan §6 y §14: códigos de 8 caracteres sin ambigüedades, cupo
-- por liga, rotables por el dueño. Unirse solo con `unirse_liga(codigo)`: saber un código nunca
-- da acceso a leer la tabla de ligas.

create table liga.ligas_privadas (
  id uuid primary key default gen_random_uuid(),
  dueno_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre text not null check (length(nombre) between 1 and 40),
  codigo text not null unique check (codigo ~ '^[A-HJ-NP-Z2-9]{8}$'),
  cupo smallint not null default 50 check (cupo between 2 and 200),
  oculta boolean not null default false,
  creada timestamptz not null default now()
);
create index ix_ligas_privadas_dueno on liga.ligas_privadas (dueno_id);

-- Se juega con las estrategias de cada miembro; la casa sale siempre de referencia (no puntúa).
create table liga.miembros_liga (
  liga_id uuid not null references liga.ligas_privadas (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  unido timestamptz not null default now(),
  primary key (liga_id, usuario_id)
);
create index ix_miembros_liga_usuario on liga.miembros_liga (usuario_id);

create function liga.es_miembro(p_liga uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from liga.miembros_liga m
                 where m.liga_id = p_liga and m.usuario_id = (select auth.uid()));
$$;
grant execute on function liga.es_miembro(uuid) to authenticated;

-- El dueño entra en su liga al crearla.
create function liga.dueno_se_une() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into liga.miembros_liga (liga_id, usuario_id) values (new.id, new.dueno_id)
    on conflict do nothing;
  return new;
end $$;
create trigger dueno_se_une after insert on liga.ligas_privadas
  for each row execute function liga.dueno_se_une();

-- Unirse con un código: exige Pro y comprueba cupo y duplicados. Devuelve la liga.
create function liga.unirse_liga(p_codigo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  l liga.ligas_privadas;
  n integer;
begin
  if uid is null or not liga.authorize('liga.jugar') then
    raise exception 'Necesitas una cuenta activa' using errcode = '42501';
  end if;
  if not liga.es_pro() then
    raise exception 'Las ligas privadas son de Pro' using errcode = '42501';
  end if;
  select * into l from liga.ligas_privadas
    where codigo = upper(btrim(p_codigo)) and not oculta for update;
  if not found then
    raise exception 'Ese código no es de ninguna liga' using errcode = 'P0002';
  end if;
  if exists (select 1 from liga.miembros_liga where liga_id = l.id and usuario_id = uid) then
    return l.id;
  end if;
  select count(*) into n from liga.miembros_liga where liga_id = l.id;
  if n >= l.cupo then
    raise exception 'La liga está completa (% de %)', n, l.cupo using errcode = '23514';
  end if;
  insert into liga.miembros_liga (liga_id, usuario_id) values (l.id, uid);
  return l.id;
end $$;
grant execute on function liga.unirse_liga(text) to authenticated;

-- Crear o editar: solo con Pro; el dueño cambia nombre, código (rotarlo) y cupo.
create function liga.ligas_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not liga.es_pro() then
      raise exception 'Crear ligas privadas es de Pro' using errcode = '42501';
    end if;
    if new.oculta then
      raise exception 'Una liga nueva nace visible' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.dueno_id is distinct from (select auth.uid())
     and (to_jsonb(new) - 'oculta') <> (to_jsonb(old) - 'oculta') then
    raise exception 'Solo el dueño edita su liga' using errcode = '42501';
  end if;
  if new.oculta is distinct from old.oculta and not liga.authorize('moderacion.revisar') then
    raise exception 'Solo moderación puede ocultar una liga' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guarda before insert or update on liga.ligas_privadas
  for each row execute function liga.ligas_guarda();

alter table liga.ligas_privadas enable row level security;
alter table liga.miembros_liga enable row level security;

grant select, delete on liga.ligas_privadas to authenticated;
grant insert (nombre, codigo, cupo) on liga.ligas_privadas to authenticated;
grant update (nombre, codigo, cupo, oculta) on liga.ligas_privadas to authenticated;
create policy miembros_leen on liga.ligas_privadas for select to authenticated
  using (dueno_id = (select auth.uid()) or liga.es_miembro(id));
create policy crear on liga.ligas_privadas for insert to authenticated
  with check (dueno_id = (select auth.uid()) and (select liga.authorize('liga.jugar')));
create policy dueno_edita on liga.ligas_privadas for update to authenticated
  using (dueno_id = (select auth.uid())) with check (dueno_id = (select auth.uid()));
create policy moderacion_edita on liga.ligas_privadas for update to authenticated
  using ((select liga.authorize('moderacion.revisar')))
  with check ((select liga.authorize('moderacion.revisar')));
create policy dueno_borra on liga.ligas_privadas for delete to authenticated
  using (dueno_id = (select auth.uid()));
create policy admin on liga.ligas_privadas for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

grant select, delete on liga.miembros_liga to authenticated;
create policy miembros_leen on liga.miembros_liga for select to authenticated
  using (liga.es_miembro(liga_id));
create policy salir on liga.miembros_liga for delete to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin on liga.miembros_liga for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

revoke execute on all functions in schema liga from public;
