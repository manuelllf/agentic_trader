-- Tercer nivel del acertijo: dos mecanismos juntos, homofono o definicion criptica.
alter table criptico.acertijos drop constraint acertijos_nivel_check;
alter table criptico.acertijos add constraint acertijos_nivel_check
  check (nivel in ('facil', 'media', 'dificil'));
