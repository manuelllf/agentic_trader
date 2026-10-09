-- liga_036 · Un evento más viejo que la última versión de su compra se anota como «obsoleto».
-- La restricción de la 035 no lo admitía.
alter table liga.eventos_pago drop constraint eventos_pago_estado_check;
alter table liga.eventos_pago add constraint eventos_pago_estado_check
  check (estado in ('recibido', 'aplicado', 'ignorado', 'obsoleto', 'duplicado', 'rechazado'));
