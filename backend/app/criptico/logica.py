"""Lectura pública y acceso acotado a las soluciones del acertijo."""

import re
import unicodedata
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga import blog
from app.liga.procesos.comun import fabrica_sistema, sesion

TZ_MADRID = ZoneInfo("Europe/Madrid")


def hoy_madrid(ahora: datetime | None = None) -> date:
    return (ahora or datetime.now(TZ_MADRID)).astimezone(TZ_MADRID).date()


def normalizar(letras: str) -> str:
    return re.sub("[^A-Z]", "", unicodedata.normalize("NFD", letras.upper()))


def comprobar(letras: str, respuesta: str) -> bool:
    intento, esperada = normalizar(letras), normalizar(respuesta)
    return len(intento) == len(esperada) and intento == esperada


def leer_publicado(db: Session, idioma: str, *, numero: int | None = None) -> dict[str, Any]:
    filtro = "a.dia = :hoy" if numero is None else "a.numero = :numero"
    fila = db.execute(text("""
        select a.id, a.idioma, a.numero, a.dia as fecha, a.nivel, a.pista,
               a.longitud, a.ayudas, r.media, r.n_media
        from criptico.acertijos a left join criptico.v_resumen r on r.acertijo_id = a.id
        where a.idioma = :idioma and a.estado = 'publicado' and a.dia <= :hoy
        and """ + filtro), {"idioma": idioma, "hoy": hoy_madrid(), "numero": numero}
    ).mappings().first()
    if fila is None:
        raise HTTPException(404, "criptico_sin_publicar")
    return dict(fila)


def exigir_publicado(db: Session, id: int) -> None:
    fila = db.execute(text("select id from criptico.acertijos where id = :id "
                           "and estado = 'publicado' and dia <= :hoy"),
                      {"id": id, "hoy": hoy_madrid()}).first()
    if fila is None:
        raise HTTPException(404, "criptico_no_encontrado")


def leer_detalle(id: int) -> dict[str, Any]:
    # Se repite la condición pública porque esta sesión puede saltarse RLS.
    with sesion(fabrica_sistema) as db:
        fila = db.execute(text("""
            select respuesta, palabra, resolucion, concepto, ejemplo, regla_catalogo
            from criptico.acertijos
            where id = :id and estado = 'publicado' and dia <= :hoy
        """), {"id": id, "hoy": hoy_madrid()}).mappings().first()
        if fila is None:
            raise HTTPException(404, "criptico_no_encontrado")
        return dict(fila)


def registrar(db: Session, id: int, ayudas_usadas: int, solucion_vista: bool) -> None:
    if type(ayudas_usadas) is not int or not 0 <= ayudas_usadas <= 3:
        raise HTTPException(422, "criptico_ayudas_invalidas")
    exigir_publicado(db, id)
    db.execute(text("insert into criptico.resultados "
                    "(acertijo_id, ayudas_usadas, solucion_vista) values (:id, :ayudas, :vista)"),
               {"id": id, "ayudas": ayudas_usadas, "vista": solucion_vista})


def alta_suscripcion(db: Session, email: str, idioma: str) -> tuple[bool, str, str]:
    alta, baja = blog.generar_token(), blog.generar_token()
    email = email.strip().lower()
    if not 6 <= len(email) <= 254 or not blog.FORMATO_CORREO.fullmatch(email):
        return False, alta, baja
    enviar = db.execute(text("select criptico.suscribir(:correo, :idioma, :hash, :baja)"),
                        {"correo": email, "idioma": idioma,
                         "hash": blog.hash_token(alta), "baja": baja}).scalar_one()
    return bool(enviar), alta, baja


def confirmar_suscripcion(db: Session, token: str) -> bool:
    return bool(db.execute(text("select criptico.confirmar(:hash)"),
                           {"hash": blog.hash_token(token)}).scalar_one())


def baja_suscripcion(db: Session, token: str) -> bool:
    return bool(db.execute(text("select criptico.dar_de_baja(:token)"),
                           {"token": token}).scalar_one())
