-- agente_001 · Esquema de la base propia del agente (cuenta de Supabase aparte, sin Auth).
-- Se aplica a mano en esa base antes de escribir los modelos. Lo derivado va en vistas.
set lock_timeout = '5s'; set statement_timeout = '60s';

create extension if not exists vector;
create schema if not exists agente;

-- Quién toca cada fila: el servicio fija `agente.actor` por transacción ('agente', 'admin:<uuid>', 'sistema').
create or replace function agente.actor() returns text language sql stable as $$
  select coalesce(nullif(current_setting('agente.actor', true), ''), current_user)
$$;

create or replace function agente.tocar_auditoria() returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := agente.actor();
  return new;
end $$;

-- El diario, el registro y el gasto no se reescriben: son la prueba de lo que pasó.
create or replace function agente.solo_anadir() returns trigger language plpgsql as $$
begin
  raise exception 'agente.%: solo se añaden filas', tg_table_name;
end $$;

-- Estado y reloj

create table agente.estado (
  id smallint primary key default 1 check (id = 1),
  parada boolean not null default false,
  parada_motivo text,
  modo text not null default 'papel' check (modo in ('papel')),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);
insert into agente.estado (id) values (1);

create table agente.ejecuciones (
  id bigint generated always as identity primary key,
  tarea text not null check (tarea in ('vigia_previo', 'ejecucion', 'despertar', 'consolidacion')),
  fecha_ny date not null,
  estado text not null default 'en_curso' check (estado in ('en_curso', 'hecha', 'fallida')),
  empezada timestamptz not null default now(),
  terminada timestamptz,
  error text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text,
  unique (tarea, fecha_ny)
);

create table agente.eventos (
  id bigint generated always as identity primary key,
  ocurrido timestamptz not null default now(),
  origen text not null check (origen in ('vigia', 'ciclo', 'revisor', 'ejecutor', 'informes',
                                         'memoria', 'puerta', 'sistema', 'admin')),
  tipo text not null check (tipo ~ '^[a-z0-9_]{1,64}$'),
  ticker text,
  datos jsonb not null default '{}'::jsonb,
  ejecucion_id bigint references agente.ejecuciones (id),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);
create index eventos_ocurrido on agente.eventos (ocurrido desc);
create index eventos_ticker on agente.eventos (ticker, ocurrido desc) where ticker is not null;

-- Lo que sigue y lo que cree

create table agente.seguimiento (
  id bigint generated always as identity primary key,
  ticker text not null,
  motivo text not null,
  desde date not null default current_date,
  hasta date,
  niveles jsonb not null default '[]'::jsonb,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text,
  check (hasta is null or hasta >= desde)
);
create unique index seguimiento_activo on agente.seguimiento (ticker) where hasta is null;

-- Una ficha por empresa; se reescribe y la versión anterior queda en `eventos`.
create table agente.fichas (
  ticker text primary key,
  contenido jsonb not null,
  certeza text not null default 'conjetura' check (certeza in ('confirmada', 'conjetura')),
  version integer not null default 1 check (version >= 1),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

create table agente.playbook_versiones (
  id bigint generated always as identity primary key,
  version integer not null unique check (version >= 1),
  contenido text not null,
  diferencia text,
  motivo text not null,
  estado text not null check (estado in ('candidata', 'vigente', 'retirada', 'rechazada')),
  adoptada_en timestamptz,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);
create unique index playbook_una_vigente on agente.playbook_versiones ((true)) where estado = 'vigente';

create table agente.fichas_mejora (
  id bigint generated always as identity primary key,
  hipotesis text not null,
  cambio text not null,
  criterio_exito text not null,
  regla_parada text not null,
  playbook_candidata_id bigint references agente.playbook_versiones (id),
  estado text not null default 'propuesta'
    check (estado in ('propuesta', 'rechazada', 'en_sombra', 'adoptada', 'descartada', 'revertida')),
  revisor_veredicto text check (revisor_veredicto in ('aprobada', 'rechazada', 'corregir')),
  revisor_motivo text,
  sombra_desde date,
  sombra_hasta date,
  resultado jsonb,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

-- El diario de decisiones: no se borra. El vector sirve para buscar en él, no como memoria principal.
create table agente.decisiones (
  id bigint generated always as identity primary key,
  ejecucion_id bigint references agente.ejecuciones (id),
  fecha_ny date not null,
  tipo text not null check (tipo in ('nada', 'operar', 'revision')),
  sombra boolean not null default false,
  playbook_version_id bigint references agente.playbook_versiones (id),
  propuesta jsonb not null,
  razonamiento text not null,
  previsiones jsonb not null default '[]'::jsonb,
  revisor_veredicto text check (revisor_veredicto in ('aprobada', 'rechazada', 'corregir')),
  revisor_motivo text,
  modelo text not null,
  embedding vector(384),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);
create index decisiones_fecha on agente.decisiones (fecha_ny desc);

create table agente.lecciones (
  id bigint generated always as identity primary key,
  texto text not null,
  decision_ids bigint[] not null,
  estado text not null default 'propuesta' check (estado in ('propuesta', 'aprobada', 'retirada')),
  revisor_motivo text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

-- Resumen propio de lo leído fuera, con su enlace; caduca a los 30 días.
create table agente.noticias (
  id bigint generated always as identity primary key,
  ticker text,
  url text not null unique,
  titulo text not null,
  fuente text not null,
  resumen text not null,
  publicada timestamptz,
  caduca timestamptz not null default now() + interval '30 days',
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);
create index noticias_caduca on agente.noticias (caduca);

-- Libro de papel

create table agente.ordenes (
  id bigint generated always as identity primary key,
  decision_id bigint not null references agente.decisiones (id),
  ticker text not null,
  lado text not null check (lado in ('compra', 'venta')),
  acciones numeric check (acciones is null or acciones > 0),
  importe_objetivo numeric check (importe_objetivo is null or importe_objetivo > 0),
  fecha_objetivo date not null,
  clave text not null unique,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'ejecutada', 'cancelada', 'rechazada_apertura', 'rechazada_limites')),
  motivo text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text,
  check (acciones is not null or importe_objetivo is not null)
);

create table agente.ejecutadas (
  id bigint generated always as identity primary key,
  orden_id bigint not null unique references agente.ordenes (id),
  ejecutada_en timestamptz not null,
  acciones numeric not null check (acciones > 0),
  precio numeric not null check (precio > 0),
  comision numeric not null default 0 check (comision >= 0),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);

-- Caja que no sale de una ejecución: los 5.000 $ iniciales, dividendos y ajustes.
create table agente.movimientos_caja (
  id bigint generated always as identity primary key,
  fecha date not null,
  tipo text not null check (tipo in ('inicial', 'dividendo', 'ajuste')),
  importe numeric not null check (importe <> 0),
  ticker text,
  motivo text not null,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);

create table agente.splits (
  id bigint generated always as identity primary key,
  ticker text not null,
  fecha date not null,
  ratio numeric not null check (ratio > 0),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  unique (ticker, fecha)
);

-- Histórico propio de lo que sigue: la base de Vennett no se lo da. El cierre es el de ese día, sin
-- reajustar por splits posteriores (Yahoo sí los reajusta: al rellenar hacia atrás, deshacerlos).
create table agente.precios (
  ticker text not null,
  fecha date not null,
  apertura numeric,
  maximo numeric,
  minimo numeric,
  cierre numeric not null check (cierre > 0),
  volumen bigint,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text,
  primary key (ticker, fecha)
);

create table agente.valor_diario (
  fecha date primary key,
  caja numeric not null,
  valor_posiciones numeric not null check (valor_posiciones >= 0),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);

-- Informes y gasto

create table agente.informes (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('parte_diario', 'decision', 'semanal', 'mensual', 'aviso')),
  fecha_ny date not null,
  decision_id bigint references agente.decisiones (id),
  estado text not null default 'borrador' check (estado in ('borrador', 'ejecutado', 'publicado')),
  titulo text not null,
  cuerpo text not null,
  cifras jsonb not null default '{}'::jsonb,
  modelo text,
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor(),
  actualizado_en timestamptz,
  actualizado_por text
);
create index informes_fecha on agente.informes (fecha_ny desc, tipo);

create table agente.gasto (
  id bigint generated always as identity primary key,
  fecha_ny date not null,
  tipo text not null check (tipo in ('ia', 'busqueda')),
  proveedor text not null,
  modelo text,
  unidades integer not null default 1 check (unidades >= 0),
  coste_usd numeric not null check (coste_usd >= 0),
  ejecucion_id bigint references agente.ejecuciones (id),
  creado timestamptz not null default now(),
  creado_por text not null default agente.actor()
);
create index gasto_fecha on agente.gasto (fecha_ny, tipo);

-- Disparadores

do $$
declare t text;
begin
  foreach t in array array['estado', 'ejecuciones', 'seguimiento', 'fichas', 'playbook_versiones',
                           'fichas_mejora', 'lecciones', 'ordenes', 'precios', 'valor_diario', 'informes']
  loop
    execute format('create trigger traza before update on agente.%I
                    for each row execute function agente.tocar_auditoria()', t);
  end loop;
  foreach t in array array['eventos', 'decisiones', 'ejecutadas', 'movimientos_caja', 'gasto']
  loop
    execute format('create trigger solo_anadir before update or delete on agente.%I
                    for each row execute function agente.solo_anadir()', t);
  end loop;
end $$;

-- Vistas (lo derivado no se guarda)

-- Acciones de cada ejecución llevadas a hoy con los splits posteriores.
create view agente.v_ejecutadas_ajustadas as
select e.id, o.ticker, o.lado, e.ejecutada_en, e.precio, e.comision,
       e.acciones * coalesce((select exp(sum(ln(s.ratio))) from agente.splits s
                              where s.ticker = o.ticker
                                and s.fecha > (e.ejecutada_en at time zone 'America/New_York')::date), 1)
         as acciones_hoy,
       e.acciones * e.precio as importe
from agente.ejecutadas e join agente.ordenes o on o.id = e.orden_id;

create view agente.v_posiciones as
select ticker,
       sum(case when lado = 'compra' then acciones_hoy else -acciones_hoy end) as acciones,
       sum(case when lado = 'compra' then importe + comision else 0 end) as coste_compras
from agente.v_ejecutadas_ajustadas
group by ticker
having sum(case when lado = 'compra' then acciones_hoy else -acciones_hoy end) > 0;

create view agente.v_caja as
select coalesce((select sum(importe) from agente.movimientos_caja), 0)
     - coalesce((select sum(importe + comision) from agente.v_ejecutadas_ajustadas where lado = 'compra'), 0)
     + coalesce((select sum(importe - comision) from agente.v_ejecutadas_ajustadas where lado = 'venta'), 0)
       as caja;

create view agente.v_valor_diario as
select fecha, caja, valor_posiciones, caja + valor_posiciones as valor_total,
       max(caja + valor_posiciones) over (order by fecha) as valor_maximo
from agente.valor_diario;

-- La foto que lee la Liga: posiciones al cierre de `p_fecha`, caja fuera y pesos sobre lo invertido.
create or replace function agente.foto_cartera(p_fecha date)
returns table (ticker text, acciones numeric, cierre numeric, peso numeric)
language sql stable as $$
  with fills as (
    -- Acciones a esa fecha: solo cuentan los splits hasta `p_fecha`, como el cierre de ese día.
    select o.ticker, o.lado,
           e.acciones * coalesce((select exp(sum(ln(s.ratio))) from agente.splits s
                                  where s.ticker = o.ticker and s.fecha <= p_fecha
                                    and s.fecha > (e.ejecutada_en at time zone 'America/New_York')::date), 1)
             as acciones
    from agente.ejecutadas e join agente.ordenes o on o.id = e.orden_id
    where (e.ejecutada_en at time zone 'America/New_York')::date <= p_fecha
  ), pos as (
    select ticker, sum(case when lado = 'compra' then acciones else -acciones end) as acciones
    from fills
    group by ticker
    having sum(case when lado = 'compra' then acciones else -acciones end) > 0
  ), valorada as (
    select p.ticker, p.acciones, pr.cierre, p.acciones * pr.cierre as valor
    from pos p
    join lateral (select cierre from agente.precios x
                  where x.ticker = p.ticker and x.fecha <= p_fecha
                  order by x.fecha desc limit 1) pr on true
  )
  select ticker, acciones, cierre, valor / nullif(sum(valor) over (), 0) as peso
  from valorada
  order by peso desc
$$;

-- Nadie entra desde fuera: el servicio usa su propio usuario y Vennett, uno de solo lectura (aparte).
revoke all on schema agente from public;
revoke all on all tables in schema agente from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema agente from anon, authenticated';
  end if;
end $$;
