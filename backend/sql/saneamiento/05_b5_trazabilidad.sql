-- B5 · Escaneos trazables (docs/liguilla/cambios-bbdd.md).
-- scan_audit se enlazaba con su escaneo solo por la hora. Ahora lleva scan_run_id, y el escaneo
-- apunta la foto completa de la que salieron sus datos.
alter table public.scan_audit
  add column scan_run_id bigint references public.scan_runs (id) on delete cascade;

-- Relleno: el ScanRun se escribe entre 2 y 12 s después de su auditoría (medido en los 14 lotes
-- con escaneo; cada lote tiene un único escaneo a menos de 60 s). El lote del 4-ago no tiene
-- escaneo y queda en NULL.
update public.scan_audit a set scan_run_id = r.id
from public.scan_runs r
where a.scan_run_id is null
  and r.scan_at >= a.scan_at and r.scan_at < a.scan_at + interval '30 seconds';

create index ix_scan_audit_run on public.scan_audit (scan_run_id, ticker);

alter table public.scan_runs add column foto_id bigint references public.foto (id);
