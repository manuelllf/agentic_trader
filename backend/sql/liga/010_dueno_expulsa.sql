-- liga_010 · El dueño de una liga privada puede expulsar a un miembro (a sí mismo no: eso es
-- salir, o borrar la liga). Expulsar no veta: para que no vuelva, el dueño rota el código.
create policy dueno_expulsa on liga.miembros_liga for delete to authenticated
  using (
    usuario_id <> (select auth.uid())
    and exists (select 1 from liga.ligas_privadas l
                where l.id = liga_id and l.dueno_id = (select auth.uid()))
  );
