-- Rastro (quién y cuándo) en todas las tablas de liga. Aditivo: nunca reescribe filas
-- existentes -- columnas nuevas, sin rewrite; el DEFAULT solo alcanza a lo que se inserte desde
-- ahora. No se editan 001..011.

-- Función genérica para BEFORE UPDATE. Los nombres de columna son parametrizables (tg_argv)
-- porque alguna tabla ya traía los suyos propios (ajustes.actualizado, estrategias.actualizada);
-- sin argumentos usa actualizado_en/actualizado_por.
create or replace function liga.tocar_auditoria()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  col_ts  text := coalesce(tg_argv[0], 'actualizado_en');
  col_por text := coalesce(tg_argv[1], 'actualizado_por');
  -- coalesce con app.actor: si algún día se escribe en liga desde una sesión de sistema de las
  -- salas (mismo patrón que public.tocar_auditoria), auth.uid() sale null y cae en esa.
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor', true), '')::uuid);
begin
  new := jsonb_populate_record(new, jsonb_build_object(col_ts, now(), col_por, actor));
  return new;
end
$$;

comment on function liga.tocar_auditoria() is
  'BEFORE UPDATE: actualizado_en=now(), actualizado_por=actor (o los nombres que le pasen por '
  'tg_argv). NULL en el actor = lo hizo el sistema.';
revoke execute on function liga.tocar_auditoria() from public;

-- ajustes: ya tenía actualizado/actualizado_por; falta la pareja de creación.
alter table liga.ajustes add column if not exists creado timestamptz not null default now();
alter table liga.ajustes add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.ajustes;
create trigger traza before update on liga.ajustes
  for each row execute function liga.tocar_auditoria('actualizado', 'actualizado_por');

-- estrategias: ya tenía creada/actualizada (esta la toca `guarda`); faltan los «por».
alter table liga.estrategias add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.estrategias add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.estrategias;
create trigger traza before update on liga.estrategias
  for each row execute function liga.tocar_auditoria('actualizada', 'actualizado_por');

-- inscripciones: no tenía ninguna columna de rastro (la escribe el sistema en `formar`).
alter table liga.inscripciones add column if not exists creado timestamptz not null default now();
alter table liga.inscripciones add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.inscripciones add column if not exists actualizado_en timestamptz;
alter table liga.inscripciones add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.inscripciones;
create trigger traza before update on liga.inscripciones
  for each row execute function liga.tocar_auditoria();

-- jornadas: igual, sin nada (calendario + estados que mueve el sistema/admin).
alter table liga.jornadas add column if not exists creado timestamptz not null default now();
alter table liga.jornadas add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.jornadas add column if not exists actualizado_en timestamptz;
alter table liga.jornadas add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.jornadas;
create trigger traza before update on liga.jornadas
  for each row execute function liga.tocar_auditoria();

-- lecturas: de solo añadir (caché de IA); ya tiene creada. Histórico -> sin FK.
alter table liga.lecturas add column if not exists creado_por uuid default auth.uid();

-- ligas_privadas: ya tenía creada; falta el resto (sí se edita: `dueno_edita`/moderación).
alter table liga.ligas_privadas add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.ligas_privadas add column if not exists actualizado_en timestamptz;
alter table liga.ligas_privadas add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.ligas_privadas;
create trigger traza before update on liga.ligas_privadas
  for each row execute function liga.tocar_auditoria();

-- miembros_liga: nunca se actualiza (solo insert/delete); solo quién añadió. Histórico -> sin FK.
alter table liga.miembros_liga add column if not exists creado_por uuid default auth.uid();

-- perfiles: ya tenía creado; falta quién (normalmente nadie: el alta la dispara el signup) y el
-- rastro de actualización (alias/oculto).
alter table liga.perfiles add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.perfiles add column if not exists actualizado_en timestamptz;
alter table liga.perfiles add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.perfiles;
create trigger traza before update on liga.perfiles
  for each row execute function liga.tocar_auditoria();

-- perfiles_privados: sin nada.
alter table liga.perfiles_privados add column if not exists creado timestamptz not null default now();
alter table liga.perfiles_privados add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.perfiles_privados add column if not exists actualizado_en timestamptz;
alter table liga.perfiles_privados add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.perfiles_privados;
create trigger traza before update on liga.perfiles_privados
  for each row execute function liga.tocar_auditoria();

-- pruebas: de solo añadir en su forma pero el sistema toca `estado`/`n_evaluadas` mientras
-- corre -- hace falta el rastro de actualización (el de creación ya lo tiene: creada + usuario_id).
alter table liga.pruebas add column if not exists actualizado_en timestamptz;
alter table liga.pruebas add column if not exists actualizado_por uuid;
drop trigger if exists traza on liga.pruebas;
create trigger traza before update on liga.pruebas
  for each row execute function liga.tocar_auditoria();

-- recetas: de solo añadir (nueva versión = nueva fila); ya tiene creada, falta quién.
alter table liga.recetas add column if not exists creado_por uuid default auth.uid();

-- respuestas_ia: de solo añadir (caché de IA); igual que lecturas.
alter table liga.respuestas_ia add column if not exists creado_por uuid default auth.uid();

-- roles_usuario: nunca se actualiza (solo insert/delete); ya tiene concedido, falta quién.
alter table liga.roles_usuario add column if not exists creado_por uuid default auth.uid();

-- temporadas: sin nada.
alter table liga.temporadas add column if not exists creado timestamptz not null default now();
alter table liga.temporadas add column if not exists creado_por uuid default auth.uid()
  references auth.users(id) on delete set null;
alter table liga.temporadas add column if not exists actualizado_en timestamptz;
alter table liga.temporadas add column if not exists actualizado_por uuid
  references auth.users(id) on delete set null;
drop trigger if exists traza on liga.temporadas;
create trigger traza before update on liga.temporadas
  for each row execute function liga.tocar_auditoria();

-- Sin cambios (documentado, no ejecuta nada):
--   auditoria            -- ya es su propia bitácora: creada + actor_id (append-only).
--   consentimientos      -- ya tiene aceptado + usuario_id (solo_anadir).
--   creditos_movimientos -- ya tiene creado + creado_por exactos (solo_anadir).
--   planes_usuario       -- ya tiene desde + concedido_por (append-only).
--   permisos_rol         -- catálogo estático: solo lo toca una migración, nunca la app.
--   posiciones           -- hija de inscripciones (FK inscripcion_id): su rastro es el de la
--                           inscripción, no se duplica.
--   resultados           -- igual, hija de inscripciones (solo_anadir).
--   reportes             -- ya tiene creado + autor_id, y resuelto + resuelto_por para su única
--                           mutación real; no se duplica con un actualizado_en genérico.
