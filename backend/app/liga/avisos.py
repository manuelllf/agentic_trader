"""Avisos por Web Push y correo opcional, en el idioma de la cuenta.
La hoja semanal se envía desde resumenes.py.
Aquí se avisan dos incidencias: quitadas no aplicadas y estrategia que juega sin su pregunta.
Los envíos son best-effort: si fallan, la liga sigue y el aviso queda en el panel.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import correo, correo_plantilla, push
from app.i18n import Locale, translate
from app.liga.procesos.comun import Fabrica, fabrica_sistema, sesion

logger = logging.getLogger(__name__)

MAX_DISPOSITIVOS = 5
TZ_MADRID = ZoneInfo("Europe/Madrid")
_MESES_ES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre")
# Los avisos que, además del push, salen por correo a quien lo activó.
_CON_CORREO = frozenset({"quitadas_vaciadas", "sin_pregunta"})


class DemasiadosDispositivos(ValueError):
    pass


# --- Suscripciones --------------------------------------------------------------------------------


def suscribir(usuario_id: str, sub: dict, fabrica: Fabrica = fabrica_sistema) -> None:
    """Guarda (o pasa a esta cuenta) la suscripción del navegador. `ValueError` si viene
    incompleta o no es de un servicio de navegador."""
    endpoint = sub.get("endpoint", "")
    claves = sub.get("keys", {})
    if not endpoint or not claves.get("p256dh") or not claves.get("auth"):
        raise ValueError("Suscripción push incompleta (endpoint/p256dh/auth).")
    if not push._valid_push_endpoint(endpoint):  # noqa: SLF001
        raise ValueError("Endpoint de push no reconocido (solo servicios oficiales de navegador).")
    with sesion(fabrica) as db:
        previa = db.execute(text("select usuario_id::text from liga.suscripciones_push "
                                 "where endpoint = :e"), {"e": endpoint}).scalar()
        if previa is None:
            n = db.execute(text("select count(*) from liga.suscripciones_push "
                                "where usuario_id = cast(:u as uuid)"), {"u": usuario_id}).scalar()
            if n >= MAX_DISPOSITIVOS:
                raise DemasiadosDispositivos(f"Máximo {MAX_DISPOSITIVOS} dispositivos.")
            db.execute(text("""
                insert into liga.suscripciones_push (usuario_id, endpoint, p256dh, auth)
                values (cast(:u as uuid), :e, :p, :a)
            """), {"u": usuario_id, "e": endpoint, "p": claves["p256dh"], "a": claves["auth"]})
        else:
            # El mismo navegador entró con otra cuenta: los avisos pasan a la que lo activa.
            db.execute(text("""
                update liga.suscripciones_push
                set usuario_id = cast(:u as uuid), p256dh = :p, auth = :a where endpoint = :e
            """), {"u": usuario_id, "e": endpoint, "p": claves["p256dh"], "a": claves["auth"]})
        db.commit()


def dar_de_baja(usuario_id: str, endpoint: str, fabrica: Fabrica = fabrica_sistema) -> None:
    with sesion(fabrica) as db:
        db.execute(text("delete from liga.suscripciones_push "
                        "where endpoint = :e and usuario_id = cast(:u as uuid)"),
                   {"e": endpoint, "u": usuario_id})
        db.commit()


def dispositivos(usuario_id: str, fabrica: Fabrica = fabrica_sistema) -> list[str]:
    """Los endpoints suscritos de la cuenta (el navegador sabe cuál es el suyo)."""
    with sesion(fabrica) as db:
        return list(db.execute(text("select endpoint from liga.suscripciones_push "
                                    "where usuario_id = cast(:u as uuid) order by id"),
                               {"u": usuario_id}).scalars())


# --- Texto ----------------------------------------------------------------------------------------


def _perfil(db: Session, usuario_id: str) -> tuple[Locale, str | None]:
    """Idioma de la cuenta y, si activó el correo, la dirección de sus avisos: la propia o la de
    su acceso."""
    fila = db.execute(text("""
        select p.idioma, p.avisos_correo, p.correo_avisos, u.email
        from liga.perfiles_privados p left join auth.users u on u.id = p.id
        where p.id = cast(:u as uuid)
    """), {"u": usuario_id}).one_or_none()
    if fila is None:
        return "es", None
    idioma: Locale = "en" if fila.idioma == "en" else "es"
    if not fila.avisos_correo:
        return idioma, None
    return idioma, fila.correo_avisos or fila.email or None


def _zona(db: Session, usuario_id: str) -> ZoneInfo:
    """La zona horaria del navegador de la cuenta; Madrid si no hay o no es válida."""
    fila = db.execute(text("select zona_horaria from liga.perfiles_privados "
                           "where id = cast(:u as uuid)"), {"u": usuario_id}).one_or_none()
    nombre = getattr(fila, "zona_horaria", None) if fila is not None else None
    try:
        return ZoneInfo(nombre) if nombre else TZ_MADRID
    except (ZoneInfoNotFoundError, ValueError):
        return TZ_MADRID


def _fecha(momento: datetime, idioma: Locale, zona: ZoneInfo = TZ_MADRID) -> str:
    local = momento.astimezone(zona)
    if idioma == "en":
        return f"{local:%B} {local.day}"
    return f"{local.day} de {_MESES_ES[local.month - 1]}"


def _hora(momento: datetime, zona: ZoneInfo = TZ_MADRID) -> str:
    return momento.astimezone(zona).strftime("%H:%M")


def _por_correo(destino: str, idioma: Locale, titulo: str, cuerpo: str, url: str) -> None:
    """El mismo aviso por correo, con el diseño de los demás. Best-effort: nunca lanza."""
    try:
        texto, html = correo_plantilla.render(
            idioma=idioma, asunto=titulo, intro=cuerpo,
            enlace_texto=translate("correo_ver", idioma), ruta=url,
            pie=translate("correo_pie", idioma), ajustes_texto=translate("correo_ajustes", idioma),
            legal_texto=translate("correo_legal", idioma))
        correo.enviar(destino, titulo, texto, html)
    except Exception:
        logger.exception("No se pudo mandar el aviso por correo")


def guardar(db: Session, usuario_id: str, tipo: str, datos: dict, caduca: datetime) -> None:
    """Guarda el aviso antes de mandarlo para que siga en el panel si falla el push."""
    db.execute(text("""
        insert into liga.avisos (usuario_id, tipo, datos, caduca)
        values (cast(:u as uuid), :t, cast(:d as jsonb), :c)
    """), {"u": usuario_id, "t": tipo, "d": json.dumps(datos, default=str), "c": caduca})
    db.commit()


def avisar(db: Session, usuario_id: str, tipo: str, url: str = "/mias",
           cierra: datetime | None = None, caduca: datetime | None = None,
           datos: dict | None = None, **valores: str) -> int:
    """Manda push y correo opcional; devuelve el total de push y poda las suscripciones de baja.
    Con `caduca`, primero lo guarda para el panel."""
    if caduca is not None:
        guardar(db, usuario_id, tipo, datos or {}, caduca)
    subs = db.execute(text("select id, endpoint, p256dh, auth from liga.suscripciones_push "
                           "where usuario_id = cast(:u as uuid)"), {"u": usuario_id}).all()
    idioma, destino = _perfil(db, usuario_id)
    zona = _zona(db, usuario_id)
    if cierra is not None:
        valores = {**valores, "date": _fecha(cierra, idioma, zona), "time": _hora(cierra, zona)}
    titulo = translate(f"push_{tipo}_title", idioma, **valores)
    cuerpo = translate(f"push_{tipo}_body", idioma, **valores)
    enviados = 0
    if subs:
        carga = json.dumps({"title": titulo, "body": cuerpo, "url": url, "tag": f"vennett-{tipo}"})
        for s in subs:
            resultado = push.enviar(s.endpoint, s.p256dh, s.auth, carga)
            if resultado == "ok":
                enviados += 1
            elif resultado == "baja":
                db.execute(text("delete from liga.suscripciones_push where id = :i"), {"i": s.id})
        db.commit()
    if destino and tipo in _CON_CORREO:
        _por_correo(destino, idioma, titulo, cuerpo, url)
    return enviados


# --- Los avisos de la jornada ---------------------------------------------------------------------


def _cierre_de_cambios(dia_inicio) -> datetime:  # noqa: ANN001 — date
    from app.liga.motor.calendario import cierre_de_cambios

    return cierre_de_cambios(dia_inicio).astimezone(UTC)


def avisar_formacion(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> int:
    """Tras formar la jornada, avisa de las incidencias: sin su pregunta o sin sus quitadas.
    Nunca lanza."""
    enviados = 0
    try:
        with sesion(fabrica) as db:
            dia_inicio = db.execute(text("select dia_inicio from liga.jornadas where id = :j"),
                                    {"j": jornada_id}).scalar()
            cierra = _cierre_de_cambios(dia_inicio)
            degradadas = db.execute(text("""
                select e.dueno_id::text as dueno, e.nombre, d.motivo
                from liga.formaciones_degradadas d
                join liga.inscripciones i on i.id = d.inscripcion_id
                join liga.estrategias e on e.id = i.estrategia_id
                where i.jornada_id = :j and e.tipo = 'usuario' and e.dueno_id is not null
                order by e.nombre
            """), {"j": jornada_id}).all()
            for d in degradadas:
                tipo = "quitadas_vaciadas" if d.motivo == "quitadas_vaciadas" else "sin_pregunta"
                enviados += avisar(db, d.dueno, tipo, name=d.nombre, caduca=cierra,
                                   datos={"jornada_id": jornada_id, "nombre": d.nombre})
    except Exception:
        logger.exception("No se pudieron mandar los avisos de la formación")
    return enviados
