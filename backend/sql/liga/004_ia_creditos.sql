-- liga_004 · IA y créditos. Plan §10 y §16; esquema en cambios-bbdd.md §4.
-- El texto de las respuestas vive aquí, nunca en public.llm_call (allí solo tokens y coste). El
-- saldo es la suma de los movimientos, de solo añadir; se escribe solo con `cargar_creditos`.

-- «Ver qué entraría hoy»: el resultado se recalcula (es determinista); aquí queda qué se probó.
create table liga.pruebas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  receta_id bigint not null references liga.recetas (id) on delete cascade,
  foto_id bigint not null,                       -- public.foto
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'hecha', 'fallida')),
  n_evaluadas integer not null default 0 check (n_evaluadas >= 0),
  idempotencia text not null check (length(idempotencia) between 8 and 80),
  creada timestamptz not null default now(),
  unique (usuario_id, idempotencia)
);
create index ix_pruebas_usuario on liga.pruebas (usuario_id, creada);

-- Caché compartida de la pregunta propia: una respuesta por pregunta normalizada, empresa y foto.
create table liga.respuestas_ia (
  id bigint generated always as identity primary key,
  pregunta_hash text not null check (pregunta_hash ~ '^[0-9a-f]{64}$'),
  ticker varchar(16) not null,
  foto_id bigint not null,
  si boolean not null,
  seguridad text not null check (seguridad in ('alta', 'media', 'baja')),
  llm_call_id bigint,                            -- public.llm_call: coste, sin texto
  creada timestamptz not null default now(),
  unique (pregunta_hash, ticker, foto_id)
);

create table liga.lecturas (
  id bigint generated always as identity primary key,
  ticker varchar(16) not null,
  foto_id bigint not null,
  texto text not null check (length(texto) <= 20000),
  fuentes jsonb not null default '[]' check (jsonb_typeof(fuentes) = 'array'),
  llm_call_id bigint,
  creada timestamptz not null default now(),
  unique (ticker, foto_id)
);

-- Libro de créditos en euros. Referencias sueltas a pruebas y lecturas: la retención de pruebas
-- no puede tocar el libro.
create table liga.creditos_movimientos (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  importe numeric(12,4) not null check (importe <> 0),
  motivo text not null check (motivo in (
    'recarga', 'regalo', 'pro_mensual', 'demo', 'ajuste',
    'prueba', 'lectura', 'reserva', 'devolucion')),
  prueba_id uuid,
  lectura_id bigint,
  idempotencia text not null check (length(idempotencia) between 8 and 80),
  creado timestamptz not null default now(),
  creado_por uuid references auth.users (id) on delete set null,
  unique (usuario_id, idempotencia)
);
create index ix_creditos_usuario on liga.creditos_movimientos (usuario_id, creado);
create index ix_creditos_lectura on liga.creditos_movimientos (lectura_id)
  where lectura_id is not null;
create trigger solo_anadir before update or delete on liga.creditos_movimientos
  for each row execute function liga.solo_anadir('auth.users', 'usuario_id');

create view liga.v_saldo with (security_invoker = true) as
select usuario_id, sum(importe)::numeric(12,4) as saldo
from liga.creditos_movimientos group by usuario_id;

-- Único camino para mover créditos. Candado por usuario, idempotente y sin bajar nunca de cero.
-- Solo lo ejecuta el sistema (el backend como dueño), dentro de sus servicios auditados.
create function liga.cargar_creditos(
  p_usuario uuid, p_importe numeric, p_motivo text, p_idempotencia text,
  p_prueba uuid default null, p_lectura bigint default null, p_por uuid default null
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  saldo numeric(12,4);
begin
  perform pg_advisory_xact_lock(hashtextextended('liga.creditos:' || p_usuario::text, 0));
  if exists (select 1 from liga.creditos_movimientos
             where usuario_id = p_usuario and idempotencia = p_idempotencia) then
    select coalesce(sum(importe), 0) into saldo
      from liga.creditos_movimientos where usuario_id = p_usuario;
    return saldo;
  end if;
  select coalesce(sum(importe), 0) into saldo
    from liga.creditos_movimientos where usuario_id = p_usuario;
  if saldo + p_importe < 0 then
    raise exception 'Saldo insuficiente: quedan % y hacen falta %', saldo, -p_importe
      using errcode = '23514';
  end if;
  insert into liga.creditos_movimientos
    (usuario_id, importe, motivo, prueba_id, lectura_id, idempotencia, creado_por)
    values (p_usuario, p_importe, p_motivo, p_prueba, p_lectura, p_idempotencia, p_por);
  return saldo + p_importe;
end $$;
revoke execute on function liga.cargar_creditos(uuid, numeric, text, text, uuid, bigint, uuid)
  from public, anon, authenticated;

alter table liga.pruebas enable row level security;
alter table liga.respuestas_ia enable row level security;
alter table liga.lecturas enable row level security;
alter table liga.creditos_movimientos enable row level security;

-- pruebas: cada uno ve las suyas; las crea el backend.
grant select on liga.pruebas to authenticated;
create policy dueno_lee on liga.pruebas for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_lee on liga.pruebas for select to authenticated
  using ((select liga.es_admin()));

-- respuestas_ia: nadie directamente; llegan a través de su prueba. El admin lee.
grant select on liga.respuestas_ia to authenticated;
create policy admin_lee on liga.respuestas_ia for select to authenticated
  using ((select liga.es_admin()));

-- lecturas: quien la ha comprado (tiene su movimiento). El admin lee.
grant select on liga.lecturas to authenticated;
create policy compradas on liga.lecturas for select to authenticated
  using (exists (select 1 from liga.creditos_movimientos m
                 where m.lectura_id = lecturas.id and m.usuario_id = (select auth.uid())));
create policy admin_lee on liga.lecturas for select to authenticated
  using ((select liga.es_admin()));

-- creditos_movimientos (y v_saldo): los propios. El admin lee; los ajustes pasan por el sistema.
grant select on liga.creditos_movimientos, liga.v_saldo to authenticated;
create policy dueno_lee on liga.creditos_movimientos for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy admin_lee on liga.creditos_movimientos for select to authenticated
  using ((select liga.es_admin()));

revoke execute on all functions in schema liga from public;
