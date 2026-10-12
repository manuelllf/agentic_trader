-- liga_041 · Quien confirma el correo después del alta recibe los créditos de bienvenida.
-- `liga.confirmar_bienvenida()` existía desde la 030, pero ningún disparador la llamaba.
set lock_timeout = '5s'; set statement_timeout = '30s';

drop trigger if exists liga_confirmar_bienvenida on auth.users;
create trigger liga_confirmar_bienvenida after update of email_confirmed_at on auth.users
  for each row execute function liga.confirmar_bienvenida();
