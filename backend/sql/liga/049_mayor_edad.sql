-- liga_049 · Confirmación de mayoría de edad para el premio anual.
alter table liga.perfiles_privados add column if not exists mayor_edad_confirmada_en timestamptz;
grant select (mayor_edad_confirmada_en), update (mayor_edad_confirmada_en) on liga.perfiles_privados to authenticated;
comment on column liga.perfiles_privados.mayor_edad_confirmada_en is 'Cuándo la cuenta confirmó tener 18 años o más. Nulo: no confirmada.';
