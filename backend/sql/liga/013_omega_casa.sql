-- Omega de la casa en la liga: 4 huecos virtuales de 500 $ que se llenan con las alertas de la
-- sala real (`public.momentum_senales`, de solo lectura) según llegan, aplicando sus mismas
-- reglas de salida (objetivo/90 días). Ver docs/liguilla/omega-huecos.md (diseño original) y
-- `app/liga/motor/omega_huecos.py` (motor puro, multi-operación y con acarreo entre jornadas).
--
-- Una fila por operación (compra→venta) de un hueco; una operación sigue abierta con
-- `salida_dia` nulo -- se actualiza el mismo día que se cierra, no nace una fila nueva. `ticker`
-- se guarda por comodidad de lectura, pero el nombre de la casa NO es público (D4: solo admin
-- ve qué eligió el método, igual que ya pasa con `liga.posiciones` de la casa) -- por eso esta
-- tabla no lleva policy de lectura pública, solo la de admin.
create table liga.omega_operaciones (
  id              bigint        generated always as identity primary key,
  jornada_id      integer       not null references liga.jornadas(id),
  numero          smallint      not null check (numero between 1 and 4),
  senal_id        bigint,                      -- id de public.momentum_senales; sin FK (otro esquema)
  ticker          text          not null,
  entrada_dia     date          not null,
  entrada_precio  numeric(14,4) not null,
  market_cap_usd  numeric(20,2),               -- solo si hizo falta para el desempate (yfinance)
  salida_dia      date,
  salida_precio   numeric(14,4),
  motivo          text          check (motivo in ('objetivo', 'tiempo')),
  creado          timestamptz   not null default now(),
  creado_por      uuid,                        -- siempre NULL: solo lo escribe el sistema
  actualizado_en  timestamptz,
  actualizado_por uuid,
  unique (jornada_id, numero, entrada_dia),
  constraint omega_operaciones_salida_coherente
    check ((salida_dia is null) = (salida_precio is null) and (salida_dia is null) = (motivo is null))
);
comment on table liga.omega_operaciones is
  'Huecos virtuales de Omega en la liga (500 $ cada uno): una fila por operación. Solo admin (D4,'
  ' igual que liga.posiciones de la casa): el nombre que eligió el método no es público.';

alter table liga.omega_operaciones enable row level security;
grant select on liga.omega_operaciones to authenticated;  -- nunca a anon: nada público aquí
create policy admin on liga.omega_operaciones
  to authenticated using (liga.es_admin()) with check (liga.es_admin());
-- Sin policy de insert/update para authenticated ni anon: solo el proceso de sistema (mismo
-- patrón que liga.posiciones/resultados).

drop trigger if exists traza on liga.omega_operaciones;
create trigger traza before update on liga.omega_operaciones
  for each row execute function liga.tocar_auditoria();
