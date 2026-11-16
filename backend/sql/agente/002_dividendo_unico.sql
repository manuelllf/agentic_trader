-- agente_002 · Un dividendo por empresa y fecha ex: reintentar el registro diario no lo cobra dos veces.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table agente.movimientos_caja
  add constraint dividendo_con_ticker check (tipo <> 'dividendo' or ticker is not null);
create unique index movimientos_caja_dividendo_unico
  on agente.movimientos_caja (ticker, fecha) where tipo = 'dividendo';
