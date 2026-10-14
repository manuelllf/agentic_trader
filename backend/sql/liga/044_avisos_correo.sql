-- liga_044 · Avisos por correo: cada cuenta decide si los recibe y a qué dirección. Sin dirección
-- propia se usa la de la cuenta (auth.users), que no se copia aquí. La edita solo su dueño (dueno_edita).
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table liga.perfiles_privados
  add column avisos_correo boolean not null default false,
  add column correo_avisos text,
  add constraint perfiles_privados_correo_avisos_check
    check (correo_avisos is null or (length(correo_avisos) <= 254
           and correo_avisos ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

grant update (avisos_correo, correo_avisos) on liga.perfiles_privados to authenticated;
