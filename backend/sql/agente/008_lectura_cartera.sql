-- agente_008 · Lectura externa de la cartera: un rol de solo lectura que solo puede ejecutar dos funciones.
-- Quien lo use no ve ninguna tabla del agente: pide la cartera de un día y si ese día está cerrado.
-- La contraseña del rol no va aquí: se pone aparte (`alter role vennett_lectura password ...`).
set lock_timeout = '5s'; set statement_timeout = '30s';

-- La cartera al cierre de `p_fecha`: posiciones, último cierre y peso sobre lo invertido (la caja queda fuera).
-- Con SECURITY DEFINER quien la ejecuta no necesita permiso sobre las tablas.
create or replace function agente.foto_cartera(p_fecha date)
returns table (ticker text, acciones numeric, cierre numeric, peso numeric)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
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

-- Si el agente guardó el valor de ese día: solo lo hace con el cierre de ese día ya cargado.
create or replace function agente.dia_cerrado(p_fecha date)
returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from agente.valor_diario where fecha = p_fecha)
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vennett_lectura') then
    create role vennett_lectura login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

alter role vennett_lectura set statement_timeout = '10s';
alter role vennett_lectura set default_transaction_read_only = on;

revoke all on function agente.foto_cartera(date), agente.dia_cerrado(date) from public;
grant usage on schema agente to vennett_lectura;
grant execute on function agente.foto_cartera(date), agente.dia_cerrado(date) to vennett_lectura;
