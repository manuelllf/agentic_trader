-- Fase B: el escaneo de decisión puntúa todo el mercado; esta marca dice qué empresas pasan los
-- filtros técnicos (suelo de liquidez y tope). Solo esas van a la capa media, al análisis a fondo
-- y a Lambda. Aditivo: columna nullable sin valor por defecto, sin reescribir la tabla.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table public.scan_audit add column if not exists pasa_filtro_tecnico boolean;

comment on column public.scan_audit.pasa_filtro_tecnico is
  'Pasa el suelo de liquidez y el tope del escaneo de decisión. NULL en escaneos anteriores o sin filtro técnico.';
