-- liga_062 · Las jornadas mensuales programadas pasan a semanas (61).
-- Idempotente: si ya no hay ninguna mensual programada, no hace nada.
do $$
declare
    id_pre integer := (select id from liga.temporadas where nombre = 'Pretemporada');
    id_t1 integer := (select id from liga.temporadas where nombre = 'Temporada 1');
begin
    if not exists (
        select 1 from liga.jornadas
        where estado = 'programada' and temporada_id in (id_pre, id_t1)
          and dia_fin - dia_inicio > 7
    ) then
        return;
    end if;

    if exists (
        select 1 from liga.jornadas j
        where j.estado = 'programada' and j.temporada_id in (id_pre, id_t1)
          and (j.foto_id is not null or j.scan_run_id is not null
               or exists (select 1 from liga.inscripciones i where i.jornada_id = j.id)
               or exists (select 1 from liga.omega_operaciones o where o.jornada_id = j.id))
    ) then
        raise exception 'Hay jornadas programadas con datos: no se rehacen.';
    end if;

    delete from liga.jornadas
    where estado = 'programada' and temporada_id in (id_pre, id_t1);

    insert into liga.jornadas
        (temporada_id, numero, dia_base, dia_inicio, dia_fin, cierre_inscripcion)
    select t.id,
           coalesce((select max(x.numero) from liga.jornadas x
                     where x.temporada_id = t.id), 0) + v.orden,
           v.dia_base, v.dia_inicio, v.dia_fin, v.cierre
    from (values
        ('Pretemporada', 1, '2026-10-30'::date, '2026-11-02'::date, '2026-11-06'::date, '2026-10-30T18:00:00-04:00'::timestamptz),
        ('Pretemporada', 2, '2026-11-06'::date, '2026-11-09'::date, '2026-11-13'::date, '2026-11-06T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 3, '2026-11-13'::date, '2026-11-16'::date, '2026-11-20'::date, '2026-11-13T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 4, '2026-11-20'::date, '2026-11-23'::date, '2026-11-27'::date, '2026-11-20T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 5, '2026-11-27'::date, '2026-11-30'::date, '2026-12-04'::date, '2026-11-27T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 6, '2026-12-04'::date, '2026-12-07'::date, '2026-12-11'::date, '2026-12-04T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 7, '2026-12-11'::date, '2026-12-14'::date, '2026-12-18'::date, '2026-12-11T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 8, '2026-12-18'::date, '2026-12-21'::date, '2026-12-24'::date, '2026-12-18T18:00:00-05:00'::timestamptz),
        ('Pretemporada', 9, '2026-12-24'::date, '2026-12-28'::date, '2026-12-31'::date, '2026-12-24T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 1, '2026-12-31'::date, '2027-01-04'::date, '2027-01-08'::date, '2026-12-31T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 2, '2027-01-08'::date, '2027-01-11'::date, '2027-01-15'::date, '2027-01-08T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 3, '2027-01-15'::date, '2027-01-19'::date, '2027-01-22'::date, '2027-01-15T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 4, '2027-01-22'::date, '2027-01-25'::date, '2027-01-29'::date, '2027-01-22T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 5, '2027-01-29'::date, '2027-02-01'::date, '2027-02-05'::date, '2027-01-29T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 6, '2027-02-05'::date, '2027-02-08'::date, '2027-02-12'::date, '2027-02-05T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 7, '2027-02-12'::date, '2027-02-16'::date, '2027-02-19'::date, '2027-02-12T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 8, '2027-02-19'::date, '2027-02-22'::date, '2027-02-26'::date, '2027-02-19T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 9, '2027-02-26'::date, '2027-03-01'::date, '2027-03-05'::date, '2027-02-26T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 10, '2027-03-05'::date, '2027-03-08'::date, '2027-03-12'::date, '2027-03-05T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 11, '2027-03-12'::date, '2027-03-15'::date, '2027-03-19'::date, '2027-03-12T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 12, '2027-03-19'::date, '2027-03-22'::date, '2027-03-25'::date, '2027-03-19T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 13, '2027-03-25'::date, '2027-03-29'::date, '2027-04-02'::date, '2027-03-25T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 14, '2027-04-02'::date, '2027-04-05'::date, '2027-04-09'::date, '2027-04-02T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 15, '2027-04-09'::date, '2027-04-12'::date, '2027-04-16'::date, '2027-04-09T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 16, '2027-04-16'::date, '2027-04-19'::date, '2027-04-23'::date, '2027-04-16T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 17, '2027-04-23'::date, '2027-04-26'::date, '2027-04-30'::date, '2027-04-23T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 18, '2027-04-30'::date, '2027-05-03'::date, '2027-05-07'::date, '2027-04-30T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 19, '2027-05-07'::date, '2027-05-10'::date, '2027-05-14'::date, '2027-05-07T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 20, '2027-05-14'::date, '2027-05-17'::date, '2027-05-21'::date, '2027-05-14T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 21, '2027-05-21'::date, '2027-05-24'::date, '2027-05-28'::date, '2027-05-21T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 22, '2027-05-28'::date, '2027-06-01'::date, '2027-06-04'::date, '2027-05-28T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 23, '2027-06-04'::date, '2027-06-07'::date, '2027-06-11'::date, '2027-06-04T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 24, '2027-06-11'::date, '2027-06-14'::date, '2027-06-17'::date, '2027-06-11T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 25, '2027-06-17'::date, '2027-06-21'::date, '2027-06-25'::date, '2027-06-17T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 26, '2027-06-25'::date, '2027-06-28'::date, '2027-07-02'::date, '2027-06-25T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 27, '2027-07-02'::date, '2027-07-06'::date, '2027-07-09'::date, '2027-07-02T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 28, '2027-07-09'::date, '2027-07-12'::date, '2027-07-16'::date, '2027-07-09T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 29, '2027-07-16'::date, '2027-07-19'::date, '2027-07-23'::date, '2027-07-16T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 30, '2027-07-23'::date, '2027-07-26'::date, '2027-07-30'::date, '2027-07-23T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 31, '2027-07-30'::date, '2027-08-02'::date, '2027-08-06'::date, '2027-07-30T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 32, '2027-08-06'::date, '2027-08-09'::date, '2027-08-13'::date, '2027-08-06T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 33, '2027-08-13'::date, '2027-08-16'::date, '2027-08-20'::date, '2027-08-13T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 34, '2027-08-20'::date, '2027-08-23'::date, '2027-08-27'::date, '2027-08-20T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 35, '2027-08-27'::date, '2027-08-30'::date, '2027-09-03'::date, '2027-08-27T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 36, '2027-09-03'::date, '2027-09-07'::date, '2027-09-10'::date, '2027-09-03T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 37, '2027-09-10'::date, '2027-09-13'::date, '2027-09-17'::date, '2027-09-10T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 38, '2027-09-17'::date, '2027-09-20'::date, '2027-09-24'::date, '2027-09-17T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 39, '2027-09-24'::date, '2027-09-27'::date, '2027-10-01'::date, '2027-09-24T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 40, '2027-10-01'::date, '2027-10-04'::date, '2027-10-08'::date, '2027-10-01T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 41, '2027-10-08'::date, '2027-10-11'::date, '2027-10-15'::date, '2027-10-08T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 42, '2027-10-15'::date, '2027-10-18'::date, '2027-10-22'::date, '2027-10-15T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 43, '2027-10-22'::date, '2027-10-25'::date, '2027-10-29'::date, '2027-10-22T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 44, '2027-10-29'::date, '2027-11-01'::date, '2027-11-05'::date, '2027-10-29T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 45, '2027-11-05'::date, '2027-11-08'::date, '2027-11-12'::date, '2027-11-05T18:00:00-04:00'::timestamptz),
        ('Temporada 1', 46, '2027-11-12'::date, '2027-11-15'::date, '2027-11-19'::date, '2027-11-12T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 47, '2027-11-19'::date, '2027-11-22'::date, '2027-11-26'::date, '2027-11-19T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 48, '2027-11-26'::date, '2027-11-29'::date, '2027-12-03'::date, '2027-11-26T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 49, '2027-12-03'::date, '2027-12-06'::date, '2027-12-10'::date, '2027-12-03T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 50, '2027-12-10'::date, '2027-12-13'::date, '2027-12-17'::date, '2027-12-10T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 51, '2027-12-17'::date, '2027-12-20'::date, '2027-12-23'::date, '2027-12-17T18:00:00-05:00'::timestamptz),
        ('Temporada 1', 52, '2027-12-23'::date, '2027-12-27'::date, '2027-12-31'::date, '2027-12-23T18:00:00-05:00'::timestamptz)
    ) as v(temporada, orden, dia_base, dia_inicio, dia_fin, cierre)
    join liga.temporadas t on t.nombre = v.temporada;

    update liga.temporadas t
    set n_jornadas = (select count(*) from liga.jornadas j where j.temporada_id = t.id)
    where t.id in (id_pre, id_t1);
end;
$$;
