-- liga_057 · Origen de las intenciones: las que escribe el conversor y las que manda el propio
-- usuario desde el paso de idea. Las filas que ya hay vienen del conversor.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table liga.intenciones_sin_regla
  add column origen text not null default 'conversor'
    constraint intenciones_sin_regla_origen_check check (origen in ('conversor', 'usuario'));
