"""Publicación, boletín y limpieza del blog con sesión de sistema."""

from urllib.parse import quote

from sqlalchemy import text

from app import correo, correo_plantilla
from app.i18n import translate
from app.liga.blog import _lanzar_si_no_enviado
from app.liga.procesos.comun import auditar, auditar_fallo, fabrica_sistema, sesion

BOLETIN_DIARIO_MAX = 20
LOTE = 10


def publicar_programados(fabrica=fabrica_sistema):
    with sesion(fabrica) as db:
        ids = db.execute(text(r"""
            update blog.articulos a set estado = 'publicado',
                publicado_en = coalesce(publicado_en, now())
            where a.estado = 'programado' and a.programado_para <= now()
              and 2 = (select count(*) from blog.articulo_textos t
                       where t.articulo_id = a.id and t.idioma in ('es', 'en')
                         and t.titulo ~ '\S' and t.cuerpo ~ '\S')
            returning a.id, a.avisar_boletin
        """)).mappings().all()
        for articulo in ids:
            id = articulo["id"]
            if articulo["avisar_boletin"]:
                for idioma in ("es", "en"):
                    _lanzar_si_no_enviado(db, id, idioma)
            auditar(db, "blog.publicado", f"articulo:{id}", {"programado": True}, None)
        db.commit()
        return len(ids)


def enviar_lote(fabrica=fabrica_sistema):
    with sesion(fabrica) as db:
        db.execute(text("select pg_advisory_xact_lock(hashtextextended('blog.boletin', 0))"))
        usados = db.execute(text("""
            select count(*) from blog.entregas
            where intentada_en >= (date_trunc('day', now() at time zone 'UTC')
                                   at time zone 'UTC')
        """)).scalar_one()
        cupo = BOLETIN_DIARIO_MAX - usados
        if cupo <= 0:
            db.commit()
            return
        filas = db.execute(text("""
            select entregas.envio_id, entregas.suscriptor_id, e.idioma,
                   s.correo, s.token_baja, a.slug, t.titulo, t.resumen
            from blog.entregas entregas
            join blog.envios e on e.id = entregas.envio_id
            join blog.suscriptores s on s.id = entregas.suscriptor_id
            join blog.articulos a on a.id = e.articulo_id
            join blog.articulo_textos t on t.articulo_id = a.id and t.idioma = e.idioma
            where entregas.estado = 'pendiente' and e.estado in ('pendiente', 'en_curso')
              and s.estado = 'confirmado' and s.idioma = e.idioma
            order by e.id, entregas.suscriptor_id limit :limite
            for update of entregas skip locked
        """), {"limite": min(LOTE, cupo)}).mappings().all()
        resultados = {}
        for fila in filas:
            eid = fila["envio_id"]
            db.execute(text("update blog.envios set estado = 'en_curso' "
                            "where id = :id and estado = 'pendiente'"), {"id": eid})
            idioma = fila["idioma"]
            texto, html = correo_plantilla.render(
                idioma=idioma, asunto=fila["titulo"], intro=fila["resumen"],
                enlace_texto=translate("blog_correo_articulo_enlace", idioma),
                ruta=("/en" if idioma == "en" else "") + "/blog/" + fila["slug"],
                pie=translate("blog_correo_articulo_pie", idioma),
                ajustes_texto=translate("blog_correo_baja_enlace", idioma),
                ajustes_ruta=("/en" if idioma == "en" else "") + "/blog/boletin/baja?token="
                + quote(fila["token_baja"], safe=""),
                legal_texto=translate("correo_legal", idioma))
            aceptada = correo.enviar(fila["correo"], fila["titulo"], texto, html)
            estado = "aceptada" if aceptada else "fallida"
            db.execute(text("update blog.entregas set estado = :estado, intentada_en = now() "
                            "where envio_id = :eid and suscriptor_id = :sid"),
                       {"estado": estado, "eid": eid, "sid": fila["suscriptor_id"]})
            cuenta = resultados.setdefault(eid, {"aceptadas": 0, "fallidas": 0})
            cuenta["aceptadas" if aceptada else "fallidas"] += 1
        db.execute(text("""
            update blog.envios e set estado = 'terminado', terminado_en = now()
            where e.estado in ('pendiente', 'en_curso') and not exists (
                select 1 from blog.entregas d where d.envio_id = e.id and d.estado = 'pendiente')
        """))
        for eid, cuenta in resultados.items():
            cuenta["pendientes"] = db.execute(text("select count(*) from blog.entregas "
                "where envio_id = :id and estado = 'pendiente'"), {"id": eid}).scalar_one()
            auditar(db, "boletin.lote", f"envio:{eid}", cuenta, None)
        db.commit()


def limpiar_pendientes(fabrica=fabrica_sistema):
    with sesion(fabrica) as db:
        borrados = db.execute(text("delete from blog.suscriptores "
            "where estado = 'pendiente' and alta_expira < now()")).rowcount
        auditar(db, "boletin.limpieza", None, {"borrados": borrados}, None)
        db.commit()
        return borrados


def _job(proceso, nombre, fabrica):
    try:
        return proceso(fabrica)
    except Exception:
        auditar_fallo(fabrica, nombre, None, RuntimeError("Fallo del proceso del blog"), None)


def job_publicar(fabrica=fabrica_sistema):
    return _job(publicar_programados, "blog_publicar", fabrica)


def job_enviar_lote(fabrica=fabrica_sistema):
    return _job(enviar_lote, "blog_boletin", fabrica)


def job_limpiar(fabrica=fabrica_sistema):
    return _job(limpiar_pendientes, "blog_limpieza", fabrica)
