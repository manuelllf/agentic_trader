-- 10: rastro (quién y cuándo) en las tablas mutables de las salas (docs/liguilla, decisión del
-- dueño). Aditivo, nunca reescribe: cada columna se añade SIN default (instantáneo); a
-- `created_at` se le pone `default now()` en un ALTER aparte para que solo lo cojan las filas
-- nuevas -- las que ya existen se quedan con todo a NULL. Se aplica solo a `liga-pg` (el dueño de
-- la liga lo aplica a producción). No toca `personal_positions` ni la lógica de trading.

-- Función genérica BEFORE INSERT OR UPDATE. `app.actor` lo deja `app.db` (evento `after_begin`
-- de la sesión) cuando la request pasa por `app.auth.require_auth`; vacío = proceso de sistema
-- (scheduler, scripts) -> NULL. Nombres de columna parametrizables (tg_argv) para las tablas que
-- ya traían su propio "actualizado" (momentum_universo_estado.actualizado_at); sin argumentos usa
-- created_by/updated_at/updated_by.
create or replace function public.tocar_auditoria()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  col_created_by text := coalesce(tg_argv[0], 'created_by');
  col_updated_at text := coalesce(tg_argv[1], 'updated_at');
  col_updated_by text := coalesce(tg_argv[2], 'updated_by');
  actor uuid := nullif(current_setting('app.actor', true), '')::uuid;
  ya_puesto uuid;
begin
  if tg_op = 'INSERT' then
    execute format('select ($1).%I', col_created_by) into ya_puesto using new;
    new := jsonb_populate_record(new, jsonb_build_object(col_created_by, coalesce(ya_puesto, actor)));
    return new;
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(col_updated_at, now(), col_updated_by, actor));
  return new;
end
$$;

comment on function public.tocar_auditoria() is
  'BEFORE INSERT OR UPDATE: created_by=actor (solo si venía null) / updated_at=now(),'
  ' updated_by=actor. NULL en el actor = lo hizo el sistema.';
revoke execute on function public.tocar_auditoria() from public;

-- ---- tablas mutables: creado + actualizado completos -------------------------------------------
-- positions: ya tiene `opened_at` (creación); falta el resto.
alter table public.positions add column if not exists created_by uuid;
alter table public.positions add column if not exists updated_at timestamptz;
alter table public.positions add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.positions;
create trigger tocar_auditoria before insert or update on public.positions
  for each row execute function public.tocar_auditoria();

-- approvals: ya tiene `created_at`.
alter table public.approvals add column if not exists created_by uuid;
alter table public.approvals add column if not exists updated_at timestamptz;
alter table public.approvals add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.approvals;
create trigger tocar_auditoria before insert or update on public.approvals
  for each row execute function public.tocar_auditoria();

-- trades: ya tiene `created_at`.
alter table public.trades add column if not exists created_by uuid;
alter table public.trades add column if not exists updated_at timestamptz;
alter table public.trades add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.trades;
create trigger tocar_auditoria before insert or update on public.trades
  for each row execute function public.tocar_auditoria();

-- allocations: ya tiene `created_at`.
alter table public.allocations add column if not exists created_by uuid;
alter table public.allocations add column if not exists updated_at timestamptz;
alter table public.allocations add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.allocations;
create trigger tocar_auditoria before insert or update on public.allocations
  for each row execute function public.tocar_auditoria();

-- watchlist: ya tiene `first_seen` (creación) y `last_seen` (negocio, no se duplica).
alter table public.watchlist add column if not exists created_by uuid;
alter table public.watchlist add column if not exists updated_at timestamptz;
alter table public.watchlist add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.watchlist;
create trigger tocar_auditoria before insert or update on public.watchlist
  for each row execute function public.tocar_auditoria();

-- momentum_candidatos: ya tiene `created_at`.
alter table public.momentum_candidatos add column if not exists created_by uuid;
alter table public.momentum_candidatos add column if not exists updated_at timestamptz;
alter table public.momentum_candidatos add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.momentum_candidatos;
create trigger tocar_auditoria before insert or update on public.momentum_candidatos
  for each row execute function public.tocar_auditoria();

-- momentum_senales: ya tiene `created_at` (es el que usa el diseño de Omega en la liga para el
-- momento de la alerta -- esto solo añade el rastro de quién/cuándo se actualiza, no lo toca).
alter table public.momentum_senales add column if not exists created_by uuid;
alter table public.momentum_senales add column if not exists updated_at timestamptz;
alter table public.momentum_senales add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.momentum_senales;
create trigger tocar_auditoria before insert or update on public.momentum_senales
  for each row execute function public.tocar_auditoria();

-- momentum_universo: ya tiene `creado_at` (creación).
alter table public.momentum_universo add column if not exists created_by uuid;
alter table public.momentum_universo add column if not exists updated_at timestamptz;
alter table public.momentum_universo add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.momentum_universo;
create trigger tocar_auditoria before insert or update on public.momentum_universo
  for each row execute function public.tocar_auditoria();

-- momentum_universo_estado: ya tiene `actualizado_at` (actualización) pero nada de creación.
alter table public.momentum_universo_estado add column if not exists created_at timestamptz;
alter table public.momentum_universo_estado add column if not exists created_by uuid;
alter table public.momentum_universo_estado add column if not exists updated_by uuid;
alter table public.momentum_universo_estado alter column created_at set default now();
drop trigger if exists tocar_auditoria on public.momentum_universo_estado;
create trigger tocar_auditoria before insert or update on public.momentum_universo_estado
  for each row execute function public.tocar_auditoria('created_by', 'actualizado_at', 'updated_by');

-- push_subscriptions: ya tiene `created_at`.
alter table public.push_subscriptions add column if not exists created_by uuid;
alter table public.push_subscriptions add column if not exists updated_at timestamptz;
alter table public.push_subscriptions add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.push_subscriptions;
create trigger tocar_auditoria before insert or update on public.push_subscriptions
  for each row execute function public.tocar_auditoria();

-- meta: sin nada.
alter table public.meta add column if not exists created_at timestamptz;
alter table public.meta add column if not exists created_by uuid;
alter table public.meta add column if not exists updated_at timestamptz;
alter table public.meta add column if not exists updated_by uuid;
alter table public.meta alter column created_at set default now();
drop trigger if exists tocar_auditoria on public.meta;
create trigger tocar_auditoria before insert or update on public.meta
  for each row execute function public.tocar_auditoria();

-- precio_cierre: sin nada (900k+ filas -- por eso el patrón de dos pasos importa aquí).
alter table public.precio_cierre add column if not exists created_at timestamptz;
alter table public.precio_cierre add column if not exists created_by uuid;
alter table public.precio_cierre add column if not exists updated_at timestamptz;
alter table public.precio_cierre add column if not exists updated_by uuid;
alter table public.precio_cierre alter column created_at set default now();
drop trigger if exists tocar_auditoria on public.precio_cierre;
create trigger tocar_auditoria before insert or update on public.precio_cierre
  for each row execute function public.tocar_auditoria();

-- foto: `inicio`/`fin` son de negocio (ventana del escaneo), no de creación de la fila.
alter table public.foto add column if not exists created_at timestamptz;
alter table public.foto add column if not exists created_by uuid;
alter table public.foto add column if not exists updated_at timestamptz;
alter table public.foto add column if not exists updated_by uuid;
alter table public.foto alter column created_at set default now();
drop trigger if exists tocar_auditoria on public.foto;
create trigger tocar_auditoria before insert or update on public.foto
  for each row execute function public.tocar_auditoria();

-- scan_runs: ya tiene `scan_at` (creación, es el momento del escaneo).
alter table public.scan_runs add column if not exists created_by uuid;
alter table public.scan_runs add column if not exists updated_at timestamptz;
alter table public.scan_runs add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.scan_runs;
create trigger tocar_auditoria before insert or update on public.scan_runs
  for each row execute function public.tocar_auditoria();

-- proposals: ya tiene `created_at`.
alter table public.proposals add column if not exists created_by uuid;
alter table public.proposals add column if not exists updated_at timestamptz;
alter table public.proposals add column if not exists updated_by uuid;
drop trigger if exists tocar_auditoria on public.proposals;
create trigger tocar_auditoria before insert or update on public.proposals
  for each row execute function public.tocar_auditoria();

-- ---- tablas de solo añadir: únicamente `created_at` si no tenían ya un momento de captura -----
alter table public.fundamentals_snapshot_metric add column if not exists created_at timestamptz;
alter table public.fundamentals_snapshot_metric alter column created_at set default now();

alter table public.fundamentals_snapshot_news add column if not exists created_at timestamptz;
alter table public.fundamentals_snapshot_news alter column created_at set default now();

alter table public.llm_call_logprob add column if not exists created_at timestamptz;
alter table public.llm_call_logprob alter column created_at set default now();

-- Sin cambios (documentado, no ejecuta nada):
--   personal_positions -- nunca se toca (memoria: separación de la cartera personal).
--   llm_call, scan_audit, universe_ticker, nasdaq_snapshot_ticker, fundamentals_snapshot
--                       -- ya tienen su momento de captura (at/scan_at/synced_at/snapshot_at/
--                          captured_at); de solo añadir, no hace falta nada más.
--   scan_run_*, proposal_item, proposal_omitted, score_news, memory_chunks
--                       -- hijas de detalle de su padre (scan_runs/proposals/scores), su rastro
--                          es el del padre.
--   currency_conversions, equity_snapshots, ibkr_exchange, memories, scores, fx_rate,
--   momentum_ejecuciones, momentum_apewisdom, momentum_gate_llamadas
--                       -- fuera de la lista que dio el dueño para este saneamiento; no se tocan
--                          para no ampliar el alcance sin que lo pida él.
