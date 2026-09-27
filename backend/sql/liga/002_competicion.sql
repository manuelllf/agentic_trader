-- liga_002 · Competición: temporadas, jornadas, estrategias, recetas, inscripciones, posiciones
-- y resultados. Plan §6 y §8; esquema columna a columna en docs/liguilla/cambios-bbdd.md §4.
-- Nada copiado: la foto, las notas de Jev y los precios se referencian (public.foto,
-- public.scan_runs/scan_audit, public.precio_cierre), sin FK hacia public para no atar las salas.

create table liga.temporadas (
  id smallint generated always as identity primary key,
  nombre text not null check (length(nombre) between 1 and 60),
  n_jornadas smallint not null check (n_jornadas between 1 and 24),
  cuenta boolean not null,                 -- la pretemporada se juega pero no cuenta
  estado text not null default 'programada'
    check (estado in ('programada', 'en_juego', 'cerrada'))
);

create table liga.jornadas (
  id integer generated always as identity primary key,
  temporada_id smallint not null references liga.temporadas (id),
  numero smallint not null check (numero between 1 and 24),
  dia_base date not null,                  -- último día de bolsa del mes anterior
  dia_inicio date not null,
  dia_fin date not null,
  cierre_inscripcion timestamptz not null,
  estado text not null default 'programada'
    check (estado in ('programada', 'formada', 'cerrada')),
  foto_id bigint,                          -- public.foto (completa) de la que salen las carteras
  scan_run_id bigint,                      -- public.scan_runs con las 4 notas de Jev de esa foto
  sp_rentabilidad numeric(10,4),           -- oficial, congelada al cerrar
  unique (temporada_id, numero),
  constraint jornada_fechas check (dia_base < dia_inicio and dia_inicio <= dia_fin),
  constraint jornada_cerrada_con_sp check (estado <> 'cerrada' or sp_rentabilidad is not null)
);
create index ix_jornadas_foto on liga.jornadas (foto_id) where foto_id is not null;

create table liga.estrategias (
  id uuid primary key default gen_random_uuid(),
  -- Lo pone la sesión (el usuario no puede elegirlo); null: casa, o retirada tras una baja.
  dueno_id uuid default auth.uid() references auth.users (id) on delete set null,
  tipo text not null default 'usuario' check (tipo in ('usuario', 'casa')),
  casa_clave text unique check (casa_clave in ('alpha', 'omega', 'lambda')),
  nombre text not null check (length(nombre) between 1 and 28),
  forma text not null check (forma in ('circulo', 'escudo', 'hexagono')),
  dibujo text not null check (dibujo in ('liso', 'mitades', 'diagonal', 'franja')),
  color1 text not null check (color1 ~ '^#[0-9A-Fa-f]{6}$'),
  color2 text not null check (color2 ~ '^#[0-9A-Fa-f]{6}$'),
  iniciales text check (iniciales ~ '^[A-ZÑ0-9]{1,2}$'),
  visibilidad text not null default 'privada' check (visibilidad in ('privada', 'publicada')),
  declara_posiciones text check (declara_posiciones in ('si', 'no')),
  destacable boolean not null default false,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'apuntada', 'jugando', 'retirada')),
  cada_dia_1 text not null default 'revisar' check (cada_dia_1 in ('revisar', 'mantener')),
  oculta boolean not null default false,
  receta_id bigint,
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now(),
  constraint casa_coherente check ((tipo = 'casa') = (casa_clave is not null)),
  constraint casa_sin_dueno check (tipo = 'usuario' or dueno_id is null),
  constraint publicada_declara check (visibilidad = 'privada' or declara_posiciones is not null)
);
create index ix_estrategias_dueno on liga.estrategias (dueno_id);

-- Cada fila es una versión: editar = fila nueva y mover estrategias.receta_id. Las exclusiones
-- («Cambiar») viven dentro, así que no hace falta tabla de versiones ni de exclusiones.
create table liga.recetas (
  id bigint generated always as identity primary key,
  estrategia_id uuid not null references liga.estrategias (id) on delete cascade,
  idea text check (length(idea) <= 400),
  reglas jsonb not null default '[]',
  excluidas text[] not null default '{}',
  catalogo_version smallint not null check (catalogo_version > 0),
  pregunta text check (length(pregunta) between 1 and 160),
  peso_negocio smallint not null check (peso_negocio between 0 and 50 and peso_negocio % 5 = 0),
  peso_precio smallint not null check (peso_precio between 0 and 50 and peso_precio % 5 = 0),
  peso_deuda smallint not null check (peso_deuda between 0 and 50 and peso_deuda % 5 = 0),
  peso_pronto smallint not null check (peso_pronto between 0 and 50 and peso_pronto % 5 = 0),
  peso_pregunta smallint not null
    check (peso_pregunta between 0 and 50 and peso_pregunta % 5 = 0),
  n_empresas smallint not null check (n_empresas in (3, 5, 7, 10)),
  reparto text not null check (reparto in ('igual', 'nota')),
  max_por_sector smallint not null check (max_por_sector between 0 and 10),
  creada timestamptz not null default now(),
  constraint reglas_lista check (jsonb_typeof(reglas) = 'array'),
  constraint excluidas_tope check (cardinality(excluidas) <= 50),
  constraint algun_peso check
    (peso_negocio + peso_precio + peso_deuda + peso_pronto + peso_pregunta > 0),
  constraint pregunta_con_peso check ((pregunta is null) = (peso_pregunta = 0))
);
create index ix_recetas_estrategia on liga.recetas (estrategia_id);
alter table liga.estrategias add constraint estrategias_receta_fk
  foreign key (receta_id) references liga.recetas (id);

create table liga.inscripciones (
  id bigint generated always as identity primary key,
  jornada_id integer not null references liga.jornadas (id),
  estrategia_id uuid not null references liga.estrategias (id),
  receta_id bigint not null references liga.recetas (id),
  n_pasan integer check (n_pasan >= 0),
  estado text not null default 'inscrita'
    check (estado in ('inscrita', 'formada', 'sin_empresas', 'cerrada')),
  unique (jornada_id, estrategia_id)
);
create index ix_inscripciones_estrategia on liga.inscripciones (estrategia_id);

-- Solo ticker y peso: nombre y sector salen de la foto, los precios de public.precio_cierre y la
-- caja es 100 − Σ peso.
create table liga.posiciones (
  inscripcion_id bigint not null references liga.inscripciones (id) on delete cascade,
  ticker varchar(16) not null,
  peso numeric(10,4) not null check (peso > 0 and peso <= 100),
  primary key (inscripcion_id, ticker)
);

-- Registro oficial del cierre: no cambia aunque luego se corrija un precio.
create table liga.resultados (
  inscripcion_id bigint primary key references liga.inscripciones (id),
  rentabilidad numeric(10,4) not null,
  puntos smallint not null check (puntos in (0, 1, 3))
);

create trigger solo_anadir before update or delete on liga.resultados
  for each row execute function liga.solo_anadir();
create trigger solo_anadir before update or delete on liga.recetas
  for each row execute function liga.solo_anadir('liga.estrategias', 'estrategia_id');

-- ---- Reglas de negocio que la BD no deja saltar ------------------------------------------------

-- Recetas: la del usuario va a una estrategia suya; la pregunta propia es de Pro.
create function liga.recetas_guarda() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  if not exists (select 1 from liga.estrategias e
                 where e.id = new.estrategia_id and e.dueno_id = (select auth.uid())
                   and e.tipo = 'usuario') then
    raise exception 'La receta tiene que ser de una estrategia tuya' using errcode = '42501';
  end if;
  if new.pregunta is not null and not liga.es_pro() then
    raise exception 'La pregunta propia es de Pro' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guarda before insert on liga.recetas
  for each row execute function liga.recetas_guarda();

-- Estrategias: columnas por rol, transiciones de estado y límites del plan.
create function liga.estrategias_guarda() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  moderacion boolean;
  pro boolean;
  tope integer;
  en_juego integer;
  borradores integer;
begin
  if tg_op = 'UPDATE' then
    new.actualizada := now();
  end if;
  if current_user = 'postgres' or liga.es_admin() then
    return new;
  end if;
  moderacion := liga.authorize('moderacion.revisar');
  pro := liga.es_pro();

  if tg_op = 'INSERT' then
    if new.oculta or new.estado <> 'borrador' or new.receta_id is not null then
      raise exception 'Una estrategia nueva nace borrador, visible y sin receta'
        using errcode = '42501';
    end if;
  else
    -- Quien no es el dueño (moderación) solo puede tocar `oculta`.
    if old.dueno_id is distinct from uid then
      if not moderacion or (to_jsonb(new) - 'oculta' - 'actualizada')
                          <> (to_jsonb(old) - 'oculta' - 'actualizada') then
        raise exception 'Solo el dueño edita su estrategia' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.oculta is distinct from old.oculta and not moderacion then
      raise exception 'Solo moderación puede ocultar una estrategia' using errcode = '42501';
    end if;
    if new.receta_id is distinct from old.receta_id and not exists (
         select 1 from liga.recetas r where r.id = new.receta_id and r.estrategia_id = new.id) then
      raise exception 'La receta no es de esta estrategia' using errcode = '42501';
    end if;
    if new.estado is distinct from old.estado and (old.estado, new.estado) not in (
         ('borrador', 'apuntada'), ('apuntada', 'borrador'),
         ('apuntada', 'retirada'), ('jugando', 'retirada')) then
      raise exception 'Cambio de estado no permitido: % → %', old.estado, new.estado
        using errcode = '42501';
    end if;
  end if;

  if new.visibilidad = 'publicada' and not pro then
    raise exception 'Publicar es de Pro' using errcode = '42501';
  end if;
  if new.estado = 'apuntada' and new.receta_id is null then
    raise exception 'Para apuntarla hace falta su receta' using errcode = '23514';
  end if;

  tope := case when pro then 3 else 1 end;
  select count(*) filter (where e.estado in ('apuntada', 'jugando') and e.id <> new.id),
         count(*) filter (where e.estado = 'borrador' and e.id <> new.id)
    into en_juego, borradores
    from liga.estrategias e where e.dueno_id = uid;
  if new.estado in ('apuntada', 'jugando') and en_juego >= tope then
    raise exception 'Tu plan permite % en juego a la vez', tope using errcode = '23514';
  end if;
  if new.estado = 'borrador' and borradores >= 10 then
    raise exception 'Como mucho 10 borradores' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guarda before insert or update on liga.estrategias
  for each row execute function liga.estrategias_guarda();

-- ¿Puede quien mira ver las posiciones de esta inscripción? Las suyas siempre; las de una
-- estrategia publicada y visible, con Pro; las de la casa, nadie más que el admin.
create function liga.puede_ver_posiciones(p_inscripcion bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from liga.inscripciones i join liga.estrategias e on e.id = i.estrategia_id
    where i.id = p_inscripcion
      and (e.dueno_id = (select auth.uid())
           or (e.tipo = 'usuario' and e.visibilidad = 'publicada' and not e.oculta
               and liga.es_pro())));
$$;
grant execute on function liga.puede_ver_posiciones(bigint) to authenticated;

-- ---- Clasificación oficial ---------------------------------------------------------------------
-- Puntos y diferencia compuesta contra el S&P de las jornadas cerradas que cuentan. El mes en
-- curso lo añade el backend.

create view liga.v_clasificacion with (security_invoker = true) as
select i.estrategia_id,
       j.temporada_id,
       sum(r.puntos)::integer as puntos,
       count(*)::integer as jornadas,
       count(*) filter (where r.puntos = 3)::integer as ganadas,
       count(*) filter (where r.puntos = 1)::integer as empatadas,
       count(*) filter (where r.puntos = 0)::integer as perdidas,
       round(((exp(sum(ln(greatest(1 + r.rentabilidad / 100, 1e-9))))
               - exp(sum(ln(greatest(1 + j.sp_rentabilidad / 100, 1e-9))))) * 100)::numeric, 4)
         as dif_sp
from liga.resultados r
join liga.inscripciones i on i.id = r.inscripcion_id
join liga.jornadas j on j.id = i.jornada_id
join liga.temporadas t on t.id = j.temporada_id
where t.cuenta and j.estado = 'cerrada'
group by i.estrategia_id, j.temporada_id;

-- ---- RLS ---------------------------------------------------------------------------------------

alter table liga.temporadas enable row level security;
alter table liga.jornadas enable row level security;
alter table liga.estrategias enable row level security;
alter table liga.recetas enable row level security;
alter table liga.inscripciones enable row level security;
alter table liga.posiciones enable row level security;
alter table liga.resultados enable row level security;

-- temporadas y jornadas: públicas de lectura; las escribe el sistema (o el admin).
grant select on liga.temporadas, liga.jornadas to anon, authenticated;
create policy leer on liga.temporadas for select to anon, authenticated using (true);
create policy admin on liga.temporadas for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));
create policy leer on liga.jornadas for select to anon, authenticated using (true);
create policy admin on liga.jornadas for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

-- estrategias: lo que juega y no está oculto es público; los borradores, de su dueño.
grant select on liga.estrategias to anon, authenticated;
grant insert (nombre, forma, dibujo, color1, color2, iniciales, visibilidad, declara_posiciones,
              destacable, cada_dia_1) on liga.estrategias to authenticated;
grant update (nombre, forma, dibujo, color1, color2, iniciales, visibilidad, declara_posiciones,
              destacable, estado, cada_dia_1, oculta, receta_id) on liga.estrategias to authenticated;
grant delete on liga.estrategias to authenticated;
create policy leer on liga.estrategias for select to anon, authenticated
  using ((estado <> 'borrador' and not oculta) or dueno_id = (select auth.uid()));
-- Moderación ve lo oculto, nunca los borradores ajenos.
create policy moderacion_lee on liga.estrategias for select to authenticated
  using ((select liga.authorize('moderacion.revisar')) and estado <> 'borrador');
create policy crear on liga.estrategias for insert to authenticated
  with check (dueno_id = (select auth.uid()) and tipo = 'usuario'
              and (select liga.authorize('liga.jugar')));
create policy editar on liga.estrategias for update to authenticated
  using (dueno_id = (select auth.uid()))
  with check (dueno_id = (select auth.uid()) and tipo = 'usuario'
              and (select liga.authorize('liga.jugar')));
create policy moderar on liga.estrategias for update to authenticated
  using ((select liga.authorize('moderacion.revisar')) and estado <> 'borrador')
  with check ((select liga.authorize('moderacion.revisar')));
create policy borrar on liga.estrategias for delete to authenticated
  using (dueno_id = (select auth.uid()) and estado = 'borrador');
create policy admin on liga.estrategias for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

-- recetas: las propias; con Pro, las de estrategias publicadas y visibles; moderación, las
-- publicadas (para revisar preguntas). Nunca se editan: editar es insertar.
grant select on liga.recetas to authenticated;
grant insert (estrategia_id, idea, reglas, excluidas, catalogo_version, pregunta, peso_negocio,
              peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto,
              max_por_sector) on liga.recetas to authenticated;
create policy propias on liga.recetas for select to authenticated
  using (exists (select 1 from liga.estrategias e
                 where e.id = estrategia_id and e.dueno_id = (select auth.uid())));
create policy publicadas_pro on liga.recetas for select to authenticated
  using ((select liga.es_pro()) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.tipo = 'usuario' and e.visibilidad = 'publicada'
      and not e.oculta));
create policy moderacion_lee on liga.recetas for select to authenticated
  using ((select liga.authorize('moderacion.revisar')) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.visibilidad = 'publicada'));
create policy crear on liga.recetas for insert to authenticated
  with check ((select liga.authorize('liga.jugar')) and exists (
    select 1 from liga.estrategias e
    where e.id = estrategia_id and e.dueno_id = (select auth.uid()) and e.tipo = 'usuario'));
create policy admin on liga.recetas for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

-- inscripciones y resultados: públicos de lectura (la clasificación); los escribe el sistema.
grant select on liga.inscripciones, liga.resultados to anon, authenticated;
grant select on liga.v_clasificacion to anon, authenticated;
create policy leer on liga.inscripciones for select to anon, authenticated using (true);
create policy admin on liga.inscripciones for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));
create policy leer on liga.resultados for select to anon, authenticated using (true);

-- posiciones: las propias, y con Pro las de estrategias publicadas. Las de la casa, nadie (D4).
grant select on liga.posiciones to authenticated;
create policy leer on liga.posiciones for select to authenticated
  using (liga.puede_ver_posiciones(inscripcion_id));
create policy admin on liga.posiciones for all to authenticated
  using ((select liga.es_admin())) with check ((select liga.es_admin()));

revoke execute on all functions in schema liga from public;
