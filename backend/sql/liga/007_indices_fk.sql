-- liga_007 · Índices para las FK que el asesor de rendimiento marca: borrar una receta o dar de
-- baja a un usuario no debe recorrer tablas enteras.
create index ix_estrategias_receta on liga.estrategias (receta_id) where receta_id is not null;
create index ix_inscripciones_receta on liga.inscripciones (receta_id);
create index ix_pruebas_receta on liga.pruebas (receta_id);
create index ix_ajustes_actualizado_por on liga.ajustes (actualizado_por)
  where actualizado_por is not null;
create index ix_creditos_creado_por on liga.creditos_movimientos (creado_por)
  where creado_por is not null;
create index ix_planes_concedido_por on liga.planes_usuario (concedido_por)
  where concedido_por is not null;
create index ix_reportes_resuelto_por on liga.reportes (resuelto_por)
  where resuelto_por is not null;
