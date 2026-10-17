"""Reglas del blog con la identidad y transacción de la petición."""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.i18n import translate

FORMATO_CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
IDIOMAS = ("es", "en")


def error(clave, status=422):
    raise HTTPException(status, translate("api_error_blog_" + clave))


def validar_idioma(idioma):
    if idioma not in IDIOMAS:
        error("idioma_no_valido")
    return idioma


def normalizar_correo(correo):
    correo = correo.strip().lower()
    if not 6 <= len(correo) <= 254 or not FORMATO_CORREO.fullmatch(correo):
        error("correo_no_valido")
    return correo


def generar_token():
    return secrets.token_urlsafe(32)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def listar_publicados(db, idioma):
    validar_idioma(idioma)
    return db.execute(text("""
        select a.slug, t.titulo, t.resumen, a.publicado_en,
               array_length(regexp_split_to_array(btrim(t.cuerpo), '[[:space:]]+'), 1) as palabras
        from blog.articulos a join blog.articulo_textos t on t.articulo_id = a.id
        where a.estado = 'publicado' and t.idioma = :idioma
        order by a.publicado_en desc, a.id desc
    """), {"idioma": idioma}).mappings().all()


def leer_publicado(db, slug, idioma):
    validar_idioma(idioma)
    fila = db.execute(text("""
        select a.slug, t.titulo, t.resumen, t.cuerpo, a.publicado_en,
               array_length(regexp_split_to_array(btrim(t.cuerpo), '[[:space:]]+'), 1) as palabras
        from blog.articulos a join blog.articulo_textos t on t.articulo_id = a.id
        where a.estado = 'publicado' and a.slug = :slug and t.idioma = :idioma
    """), {"slug": slug, "idioma": idioma}).mappings().first()
    if fila is None:
        error("no_encontrado", 404)
    return fila


def alta_boletin(db, correo, idioma):
    correo = normalizar_correo(correo)
    validar_idioma(idioma)
    alta, baja = generar_token(), generar_token()
    enviar = db.execute(text("select blog.suscribir(:correo, :idioma, :hash, :baja)"),
                        {"correo": correo, "idioma": idioma,
                         "hash": hash_token(alta), "baja": baja}).scalar_one()
    return enviar, alta, baja


def confirmar_boletin(db, token):
    return db.execute(text("select blog.confirmar(:hash)"),
                      {"hash": hash_token(token)}).scalar_one()


def dar_de_baja(db, token):
    return db.execute(text("select blog.dar_de_baja(:token)"),
                      {"token": token}).scalar_one()


def _articulo(db, id):
    fila = db.execute(text("select * from blog.articulos where id = :id for update"),
                      {"id": id}).mappings().first()
    if fila is None:
        error("no_encontrado", 404)
    return dict(fila)


def puede_publicarse(db, articulo_id):
    textos = db.execute(text("""
        select idioma, titulo, cuerpo from blog.articulo_textos where articulo_id = :id
    """), {"id": articulo_id}).mappings().all()
    completos = {t["idioma"] for t in textos if t["titulo"].strip() and t["cuerpo"].strip()}
    if completos != set(IDIOMAS):
        error("faltan_textos")


def _slug_libre(db, slug, id=None):
    if db.execute(text("select id from blog.articulos where slug = :slug "
                       "and (cast(:id as bigint) is null or id <> :id)"),
                  {"slug": slug, "id": id}).first():
        error("slug_repetido", 409)


def _escribir_slug(db, consulta, datos):
    try:
        with db.begin_nested():
            return db.execute(text(consulta), datos).scalar_one()
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) == "23505":
            error("slug_repetido", 409)
        raise


def crear_articulo(db, slug):
    _slug_libre(db, slug)
    id = _escribir_slug(db, "insert into blog.articulos (slug, estado) "
                           "values (:slug, 'borrador') returning id", {"slug": slug})
    db.execute(text("insert into blog.articulo_textos (articulo_id, idioma) "
                    "values (:id, 'es'), (:id, 'en')"), {"id": id})
    return id


def detalle_admin(db, id):
    articulo = _articulo(db, id)
    textos = db.execute(text("select idioma, titulo, resumen, cuerpo "
                             "from blog.articulo_textos where articulo_id = :id"),
                        {"id": id}).mappings()
    articulo["textos"] = {t["idioma"]: {k: t[k] for k in ("titulo", "resumen", "cuerpo")}
                           for t in textos}
    return articulo


def editar(db, id, slug, textos):
    _articulo(db, id)
    if slug is not None:
        _slug_libre(db, slug, id)
        _escribir_slug(db, "update blog.articulos set slug = :slug where id = :id "
                           "returning id", {"slug": slug, "id": id})
    for idioma, datos in textos.items():
        validar_idioma(idioma)
        db.execute(text("update blog.articulo_textos set titulo = :titulo, "
                        "resumen = :resumen, cuerpo = :cuerpo "
                        "where articulo_id = :id and idioma = :idioma"),
                   {**datos, "id": id, "idioma": idioma})
    return detalle_admin(db, id)


def publicar(db, id, avisar_boletin=False):
    _articulo(db, id)
    puede_publicarse(db, id)
    db.execute(text("update blog.articulos set estado = 'publicado', "
                    "publicado_en = coalesce(publicado_en, now()), programado_para = null, "
                    "avisar_boletin = :avisar where id = :id"),
               {"id": id, "avisar": avisar_boletin})
    if avisar_boletin:
        for idioma in IDIOMAS:
            _lanzar_si_no_enviado(db, id, idioma)
    return detalle_admin(db, id)


def programar(db, id, cuando, avisar_boletin=False):
    _articulo(db, id)
    puede_publicarse(db, id)
    if cuando <= datetime.now(UTC) + timedelta(minutes=1):
        error("fecha_pasada")
    db.execute(text("update blog.articulos set estado = 'programado', "
                    "programado_para = :cuando, avisar_boletin = :avisar where id = :id"),
               {"id": id, "cuando": cuando, "avisar": avisar_boletin})
    return detalle_admin(db, id)


def despublicar(db, id):
    _articulo(db, id)
    db.execute(text("update blog.articulos set estado = 'borrador', programado_para = null "
                    "where id = :id"), {"id": id})
    return detalle_admin(db, id)


def lanzar_boletin(db, id, idioma):
    return _preparar_boletin(db, id, idioma, permitir_existente=False)


def _lanzar_si_no_enviado(db, id, idioma):
    return _preparar_boletin(db, id, idioma, permitir_existente=True)


def _preparar_boletin(db, id, idioma, permitir_existente):
    validar_idioma(idioma)
    if _articulo(db, id)["estado"] != "publicado":
        error("no_publicado")
    envio = db.execute(text("insert into blog.envios (articulo_id, idioma) "
                            "values (:id, :idioma) on conflict (articulo_id, idioma) "
                            "do nothing returning id"), {"id": id, "idioma": idioma}).scalar()
    if envio is None:
        if permitir_existente:
            return 0
        error("boletin_ya_enviado", 409)
    return db.execute(text("insert into blog.entregas (envio_id, suscriptor_id, estado) "
                           "select :envio, id, 'pendiente' from blog.suscriptores "
                           "where estado = 'confirmado' and idioma = :idioma"),
                      {"envio": envio, "idioma": idioma}).rowcount


def correo_prueba(db, correo_admin):
    return db.execute(text("""
        select a.slug, t.titulo, t.resumen, t.cuerpo
        from blog.articulos a join blog.articulo_textos t on t.articulo_id = a.id
        where a.estado = 'publicado' and t.idioma = 'es'
        order by a.publicado_en desc, a.id desc limit 1
    """)).mappings().first()


def listar_admin(db):
    return db.execute(text("""
        select a.id, a.slug, a.estado, a.programado_para, a.publicado_en,
               es.titulo as titulo_es, en.titulo as titulo_en,
               btrim(es.titulo) <> '' and btrim(es.cuerpo) <> '' as completo_es,
               btrim(en.titulo) <> '' and btrim(en.cuerpo) <> '' as completo_en
        from blog.articulos a
        join blog.articulo_textos es on es.articulo_id = a.id and es.idioma = 'es'
        join blog.articulo_textos en on en.articulo_id = a.id and en.idioma = 'en'
        order by a.creado desc, a.id desc
    """)).mappings().all()


def resumen_boletin(db):
    suscriptores = db.execute(text("select estado, idioma, count(*) as total "
                                  "from blog.suscriptores group by estado, idioma "
                                  "order by estado, idioma")).mappings().all()
    envios = db.execute(text("""
        select e.id, e.articulo_id, e.idioma, e.estado, e.creado, e.terminado_en,
               count(*) filter (where d.estado = 'pendiente') as pendiente,
               count(*) filter (where d.estado = 'aceptada') as aceptada,
               count(*) filter (where d.estado = 'fallida') as fallida
        from blog.envios e left join blog.entregas d on d.envio_id = e.id
        group by e.id order by e.creado desc, e.id desc
    """)).mappings().all()
    return {"suscriptores": suscriptores, "envios": envios}


def listar_suscriptores(db, estado=None, idioma=None):
    if idioma is not None:
        validar_idioma(idioma)
    return db.execute(text("""
        select correo, idioma, estado, creado, confirmado_en, baja_en, actualizado_en
        from blog.suscriptores
        where (cast(:estado as text) is null or estado = :estado)
          and (cast(:idioma as text) is null or idioma = :idioma)
        order by creado desc, id desc limit 200
    """), {"estado": estado, "idioma": idioma}).mappings().all()
