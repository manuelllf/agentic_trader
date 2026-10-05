"""Avisos a las cuentas por Web Push (opt-in, uno por dispositivo). Sin correo.

Cinco avisos, todos best-effort: si el push falla, la liga sigue y todo está en la web.
- Tu cartera está formada (puedes cambiar empresas hasta tal hora).
- Los cambios se cierran en una hora.
- Empieza la jornada.
- Una estrategia jugó el mes sin su pregunta.
- La configuración cambió y no se aplicaron las quitadas.

Va con sesión de sistema: la suscripción se guarda como la cuenta que la pide, y el envío mira las
de cada dueño. El texto sale en el idioma privado de la cuenta (por defecto, español)."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import push
from app.i18n import Locale, translate
from app.liga.motor.calendario import TZ_NUEVA_YORK
from app.liga.procesos.comun import Fabrica, auditar, fabrica_sistema, sesion

logger = logging.getLogger(__name__)

MAX_DISPOSITIVOS = 5
TZ_MADRID = ZoneInfo("Europe/Madrid")
_MESES_ES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
             "septiembre", "octubre", "noviembre", "diciembre")
_APERTURA = time(9, 30)                   # abre la bolsa de Nueva York
_AVISO_APERTURA_HASTA = timedelta(hours=2)   # pasado esto, ya no se avisa de que empezó
_ANTELACION_CIERRE = timedelta(hours=1)


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


def _idioma(db: Session, usuario_id: str) -> Locale:
    valor = db.execute(text("select idioma from liga.perfiles_privados "
                            "where id = cast(:u as uuid)"), {"u": usuario_id}).scalar()
    return "en" if valor == "en" else "es"


def _fecha(momento: datetime, idioma: Locale) -> str:
    local = momento.astimezone(TZ_MADRID)
    if idioma == "en":
        return f"{local:%B} {local.day}"
    return f"{local.day} de {_MESES_ES[local.month - 1]}"


def _hora(momento: datetime) -> str:
    return momento.astimezone(TZ_MADRID).strftime("%H:%M")


def avisar(db: Session, usuario_id: str, tipo: str, url: str = "/mias",
           cierra: datetime | None = None, **valores: str) -> int:
    """Manda el aviso `tipo` a los dispositivos de la cuenta; devuelve a cuántos llegó. Quita las
    suscripciones que el navegador dio de baja."""
    subs = db.execute(text("select id, endpoint, p256dh, auth from liga.suscripciones_push "
                           "where usuario_id = cast(:u as uuid)"), {"u": usuario_id}).all()
    if not subs:
        return 0
    idioma = _idioma(db, usuario_id)
    if cierra is not None:
        valores = {**valores, "date": _fecha(cierra, idioma), "time": _hora(cierra)}
    carga = json.dumps({"title": translate(f"push_{tipo}_title", idioma, **valores),
                        "body": translate(f"push_{tipo}_body", idioma, **valores),
                        "url": url, "tag": f"vennett-{tipo}"})
    enviados = 0
    for s in subs:
        resultado = push.enviar(s.endpoint, s.p256dh, s.auth, carga)
        if resultado == "ok":
            enviados += 1
        elif resultado == "baja":
            db.execute(text("delete from liga.suscripciones_push where id = :i"), {"i": s.id})
    db.commit()
    return enviados


# --- Los avisos de la jornada ---------------------------------------------------------------------


def _cierre_de_cambios(dia_inicio) -> datetime:  # noqa: ANN001 — date
    from app.liga.motor.calendario import cierre_de_cambios

    return cierre_de_cambios(dia_inicio).astimezone(UTC)


def _duenos(db: Session, jornada_id: int) -> list[str]:
    return list(db.execute(text("""
        select distinct e.dueno_id::text from liga.inscripciones i
        join liga.estrategias e on e.id = i.estrategia_id
        where i.jornada_id = :j and e.tipo = 'usuario' and e.dueno_id is not null
          and i.estado in ('formada', 'sin_empresas')
    """), {"j": jornada_id}).scalars())


def avisar_formacion(jornada_id: int, fabrica: Fabrica = fabrica_sistema) -> int:
    """Tras formar la jornada: «tu cartera está lista» a cada dueño y, aparte, lo que no salió
    como esperaba (sin su pregunta, sin sus quitadas). Nunca lanza."""
    enviados = 0
    try:
        with sesion(fabrica) as db:
            dia_inicio = db.execute(text("select dia_inicio from liga.jornadas where id = :j"),
                                    {"j": jornada_id}).scalar()
            cierra = _cierre_de_cambios(dia_inicio)
            for dueno in _duenos(db, jornada_id):
                enviados += avisar(db, dueno, "cartera_lista", cierra=cierra)
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
                enviados += avisar(db, d.dueno, tipo, name=d.nombre)
    except Exception:
        logger.exception("No se pudieron mandar los avisos de la formación")
    return enviados


def _ya_avisado(db: Session, accion: str, jornada_id: int) -> bool:
    return db.execute(text("select 1 from liga.auditoria where accion = :a and objeto = :o"),
                      {"a": accion, "o": f"jornada:{jornada_id}"}).first() is not None


def _enviar_una_vez(db: Session, accion: str, tipo: str, jornada_id: int, **extra) -> int:  # noqa: ANN003
    if _ya_avisado(db, accion, jornada_id):
        return 0
    enviados = sum(avisar(db, dueno, tipo, **extra) for dueno in _duenos(db, jornada_id))
    auditar(db, accion, f"jornada:{jornada_id}", {"enviados": enviados}, None)
    db.commit()
    return enviados


def job(fabrica: Fabrica = fabrica_sistema, ahora: datetime | None = None) -> dict:
    """El del scheduler (cada 5 minutos): una hora antes de que se cierren los cambios, y cuando
    abre el mercado del primer día. Cada aviso sale una sola vez por jornada. Nunca lanza."""
    hecho = {"cambios_cierran": 0, "empieza": 0}
    try:
        ahora = (ahora or datetime.now(UTC)).astimezone(UTC)
        with sesion(fabrica) as db:
            jornadas = db.execute(text("""
                select id, dia_inicio from liga.jornadas where estado = 'formada'
                  and dia_inicio >= :hoy order by dia_inicio limit 2
            """), {"hoy": (ahora - timedelta(days=1)).date()}).all()
            for j in jornadas:
                cierra = _cierre_de_cambios(j.dia_inicio)
                if cierra - _ANTELACION_CIERRE <= ahora < cierra:
                    hecho["cambios_cierran"] += _enviar_una_vez(
                        db, "aviso.cambios_cierran", "cambios_cierran", j.id, cierra=cierra)
                abre = datetime.combine(j.dia_inicio, _APERTURA, tzinfo=TZ_NUEVA_YORK)
                if abre <= ahora < abre + _AVISO_APERTURA_HASTA:
                    hecho["empieza"] += _enviar_una_vez(db, "aviso.empieza", "empieza", j.id)
    except Exception:
        logger.exception("Fallo en los avisos de la jornada")
    return hecho
