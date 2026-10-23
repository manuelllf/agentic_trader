-- La liga semanal llega a 53 jornadas por temporada: los topes de 24 eran de la liga mensual.
set lock_timeout = '5s'; set statement_timeout = '30s';
alter table liga.jornadas drop constraint jornadas_numero_check,
  add constraint jornadas_numero_check check (numero between 1 and 60);
alter table liga.temporadas drop constraint temporadas_n_jornadas_check,
  add constraint temporadas_n_jornadas_check check (n_jornadas between 1 and 60);
alter table liga.premios drop constraint premios_jornadas_jugadas_check,
  add constraint premios_jornadas_jugadas_check check (jornadas_jugadas between 1 and 60);
