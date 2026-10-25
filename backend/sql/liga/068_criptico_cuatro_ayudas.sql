-- La pagina ofrece cuatro ayudas (definicion, indicador, material y primera letra): el resultado
-- tiene que admitir las cuatro, o quien las usa todas no puede registrar ni ver la solucion.
alter table criptico.resultados drop constraint resultados_ayudas_usadas_check;
alter table criptico.resultados add constraint resultados_ayudas_usadas_check
  check (ayudas_usadas between 0 and 4);
