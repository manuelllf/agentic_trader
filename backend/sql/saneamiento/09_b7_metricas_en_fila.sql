-- B7 fase 1 · Métricas y titulares de la foto en la propia fila (docs/liguilla/cambios-bbdd.md).
-- Solo columnas, nullable y sin valor por defecto: instantáneo, no reescribe la tabla. La doble
-- escritura y el relleno van en código (foto_guardar, rellenar_b7.py); los lectores siguen en las
-- tablas viejas hasta que compara_b7.py confirme una semana de coincidencia.
alter table public.fundamentals_snapshot
  add column metricas jsonb,
  add column titulares text[];
