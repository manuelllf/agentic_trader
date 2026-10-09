-- liga_037 · Cada Pro y cada pase de pago guarda la compra de Lemon que lo dio (suscripción o
-- pedido). Así una baja solo corta sus propios derechos y no los de otra suscripción del usuario.
alter table liga.planes_usuario add column compra_lemon_id text;
alter table liga.pases_liga add column compra_lemon_id text;
create index ix_planes_usuario_compra on liga.planes_usuario (compra_lemon_id)
  where compra_lemon_id is not null;
create index ix_pases_liga_compra on liga.pases_liga (compra_lemon_id)
  where compra_lemon_id is not null;
