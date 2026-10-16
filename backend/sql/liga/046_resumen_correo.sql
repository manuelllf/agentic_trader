-- liga_046 · Resumen por correo: preferencia de cada cuenta, activada por defecto.
alter table liga.perfiles_privados add column if not exists resumen_correo boolean not null default true;
grant select (resumen_correo) on liga.perfiles_privados to authenticated;
grant update (resumen_correo) on liga.perfiles_privados to authenticated;
