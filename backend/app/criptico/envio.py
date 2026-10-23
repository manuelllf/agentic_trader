"""Envío diario del críptico con registro de cada intento."""

import logging
from datetime import datetime, timedelta
from urllib.parse import quote

from sqlalchemy import text

from app import correo
from app.config import settings
from app.criptico import correo_criptico
from app.criptico.logica import hoy_madrid
from app.liga.procesos.comun import auditar, auditar_fallo, fabrica_sistema, sesion

logger = logging.getLogger(__name__)


def enviar_del_dia(idioma: str, fabrica=fabrica_sistema, ahora: datetime | None = None) -> int:
    with sesion(fabrica) as db:
        # liga.ajustes.valor es jsonb: el interruptor llega como booleano, no como texto.
        activo = db.execute(text("select valor = 'true'::jsonb from liga.ajustes "
                                 "where clave = 'criptico.envio.activo'")).scalar()
        if not activo:
            return 0
        db.execute(text("select pg_advisory_xact_lock(hashtextextended(:clave, 0))"),
                   {"clave": f"criptico.envio:{idioma}"})
        hoy = hoy_madrid(ahora)
        acertijo = db.execute(text("""
            select id, numero, dia, nivel, pista, longitud from criptico.acertijos
            where idioma = :idioma and dia = :dia and estado = 'publicado'
        """), {"idioma": idioma, "dia": hoy}).mappings().first()
        if acertijo is None:
            return 0
        ayer = db.execute(text("""
            select a.numero, a.pista, a.longitud, a.respuesta, a.resolucion,
                   a.concepto, r.media, r.n_media
            from criptico.acertijos a
            left join criptico.v_resumen r on r.acertijo_id = a.id
            where a.idioma = :idioma and a.dia = :dia and a.estado = 'publicado'
        """), {"idioma": idioma, "dia": hoy - timedelta(days=1)}).mappings().first()
        suscriptores = db.execute(text("""
            select s.id, s.correo, s.token_baja from criptico.suscriptores s
            where s.idioma = :idioma and s.estado = 'confirmado'
              and not exists (select 1 from criptico.entregas e
                              where e.acertijo_id = :aid and e.suscriptor_id = s.id)
            order by s.id
        """), {"idioma": idioma, "aid": acertijo["id"]}).mappings().all()
        ruta = settings.url_publica + ("/en" if idioma == "en" else "") + "/criptico"
        enviados = 0
        for suscriptor in suscriptores:
            url_baja = ruta + "/baja?token=" + quote(suscriptor["token_baja"], safe="")
            aceptado = False
            try:
                asunto, texto, html = correo_criptico.render(
                    idioma=idioma, acertijo=acertijo, ayer=ayer, url_baja=url_baja,
                    url_resolver=ruta, n_media_ayer=ayer["n_media"] if ayer else None)
                aceptado = correo.enviar(suscriptor["correo"], asunto, texto, html,
                    cabeceras={"List-Unsubscribe": f"<{url_baja}>",
                               "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"})
            except Exception:
                logger.error("Fallo de un envío del críptico (%s)", idioma)
            db.execute(text("""
                insert into criptico.entregas (acertijo_id, suscriptor_id, estado, enviado)
                values (:aid, :sid, :estado, now()) on conflict do nothing
            """), {"aid": acertijo["id"], "sid": suscriptor["id"],
                   "estado": "enviado" if aceptado else "error"})
            enviados += bool(aceptado)
        db.commit()
        return enviados


def job_enviar(idioma: str):
    try:
        enviados = enviar_del_dia(idioma)
        with sesion(fabrica_sistema) as db:
            auditar(db, "criptico.envio", f"idioma:{idioma}", {"enviados": enviados}, None)
            db.commit()
        logger.info("Críptico (%s): %s correos enviados", idioma, enviados)
        return enviados
    except Exception:
        auditar_fallo(fabrica_sistema, "criptico_envio_" + idioma, None,
                      RuntimeError("Fallo del envío del críptico"), None)
