"""Piezas comunes de los procesos: sesión de sistema, candado, errores y auditoría."""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.liga.models import Auditoria, Jornada

logger = logging.getLogger(__name__)

Fabrica = Callable[[], Session]
TZ_BOLSA = ZoneInfo("America/New_York")
PROCESOS = ("temporadas", "foto", "formar", "diario", "cerrar")
_HILOS = {p: threading.Lock() for p in PROCESOS}


class ErrorProceso(Exception):
    """El proceso no puede seguir; el mensaje, en castellano, es para el admin."""

    codigo = 409


class NoEncontrado(ErrorProceso):
    codigo = 404


class ProcesoOcupado(ErrorProceso):
    codigo = 409


def fabrica_sistema() -> Session:
    """La sesión de los procesos: dueño de la BD, sin RLS. Import tardío para no atar los tests."""
    from app.db import SessionLocal

    return SessionLocal()


@contextmanager
def candado(nombre: str, fabrica: Fabrica) -> Iterator[None]:
    """Nadie más corre `nombre` a la vez: ni otro hilo de este proceso ni otra instancia.

    El candado de Postgres vive en su propia transacción, abierta hasta el final: el trabajo
    hace commits intermedios (los precios) y un candado de transacción moriría con el primero."""
    hilo = _HILOS[nombre]
    if not hilo.acquire(blocking=False):
        raise ProcesoOcupado(f"El proceso «{nombre}» ya está en marcha.")
    try:
        db = fabrica()
        try:
            if db.get_bind().dialect.name == "postgresql":
                libre = db.execute(
                    text("select pg_try_advisory_xact_lock(hashtextextended(:k, 0))"),
                    {"k": f"liga.proceso:{nombre}"}).scalar()
                if not libre:
                    raise ProcesoOcupado(f"El proceso «{nombre}» ya está en marcha en otra "
                                         "instancia.")
            yield
        finally:
            # Commit y no rollback: esta transacción no escribe nada, y deshacerla también
            # desharía lo anidado en ella cuando todo comparte conexión (los tests).
            db.commit()
            db.close()
    finally:
        hilo.release()


@contextmanager
def sesion(fabrica: Fabrica) -> Iterator[Session]:
    db = fabrica()
    try:
        yield db
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def jornada_bloqueada(db: Session, jornada_id: int) -> Jornada:
    """La jornada con su fila bloqueada hasta el commit: su estado decide qué se puede hacer."""
    j = db.scalars(select(Jornada).where(Jornada.id == jornada_id).with_for_update()).one_or_none()
    if j is None:
        raise NoEncontrado(f"No existe la jornada {jornada_id}.")
    return j


def jornada(db: Session, jornada_id: int) -> Jornada:
    j = db.get(Jornada, jornada_id)
    if j is None:
        raise NoEncontrado(f"No existe la jornada {jornada_id}.")
    return j


def auditar(db: Session, accion: str, objeto: str | None, detalle: dict,
            actor: str | None) -> None:
    """Rastro del proceso en `liga.auditoria`, en la misma transacción que lo que hace."""
    db.add(Auditoria(actor_id=como_uuid(actor), accion=accion, objeto=objeto,
                     detalle=para_json(detalle)))


def auditar_fallo(fabrica: Fabrica, proceso: str, objeto: str | None, error: Exception,
                  actor: str | None) -> None:
    """El fallo queda apuntado aunque su transacción se deshiciera; nunca tapa el error. Una
    negativa del dominio («ya está formada») no es un fallo."""
    if isinstance(error, ErrorProceso):
        return
    try:
        with sesion(fabrica) as db:
            auditar(db, f"proceso.{proceso}.fallo", objeto,
                    {"error": str(error)[:500], "tipo": type(error).__name__}, actor)
            db.commit()
    except Exception:
        logger.exception("No se pudo apuntar el fallo del proceso %s", proceso)


def ahora_utc(ahora: datetime | None = None) -> datetime:
    if ahora is None:
        return datetime.now(UTC)
    if ahora.tzinfo is None:
        raise ValueError("`ahora` necesita zona horaria")
    return ahora


def hoy_bolsa(ahora: datetime | None = None) -> date:
    return ahora_utc(ahora).astimezone(TZ_BOLSA).date()


def para_json(valor: object) -> object:
    """Decimal a texto (exacto), fechas a ISO y uuid a texto, en cualquier anidamiento."""
    if isinstance(valor, Decimal):
        return str(valor)
    if isinstance(valor, datetime | date):
        return valor.isoformat()
    if isinstance(valor, uuid.UUID):
        return str(valor)
    if isinstance(valor, dict):
        return {str(k): para_json(v) for k, v in valor.items()}
    if isinstance(valor, list | tuple | set | frozenset):
        return [para_json(v) for v in valor]
    return valor


def como_uuid(valor: str | None) -> uuid.UUID | None:
    if not valor:
        return None
    try:
        return uuid.UUID(str(valor))
    except ValueError:
        return None
