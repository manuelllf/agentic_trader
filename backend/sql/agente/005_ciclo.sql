-- agente_005 · Cada ciclo lleva un identificador que comparten su decisión y sus llamadas al modelo.
-- La hora no sirve para unirlas: `creado` es el inicio de la transacción, anterior a las llamadas.
set lock_timeout = '5s'; set statement_timeout = '30s';

alter table agente.decisiones add column ciclo uuid;
alter table agente.llamadas_modelo add column ciclo uuid;

create unique index decisiones_ciclo on agente.decisiones (ciclo) where ciclo is not null;
create index llamadas_modelo_ciclo on agente.llamadas_modelo (ciclo, id) where ciclo is not null;
