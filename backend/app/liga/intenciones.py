"""Intenciones sin regla: registro anónimo y resumen para el admin."""

import logging
import unicodedata
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.liga.models import IntencionSinRegla
from app.liga.procesos.comun import auditar

if TYPE_CHECKING:
    from app.liga.ia.conversor import Interpretacion

logger = logging.getLogger("app.liga.intenciones")

# Limita el abuso sin vincular las intenciones anónimas al usuario.
LIMITE_SOLICITUDES_DIA = 3


def contar_solicitudes(db: Session, usuario_id: str) -> int:
    return int(db.execute(text("""
        select count(*) from liga.auditoria
        where accion = :a and actor_id = cast(:u as uuid)
            and creada >= now() - interval '1 day'
    """), {"a": "intencion.solicitud", "u": usuario_id}).scalar_one())


def registrar_solicitud(texto: str, idioma: str, usuario_id: str,
                       fabrica: Callable[[], Session]) -> bool:
    db = fabrica()
    try:
        if contar_solicitudes(db, usuario_id) >= LIMITE_SOLICITUDES_DIA:
            return False
        db.add(IntencionSinRegla(intencion=texto, tipo="no_disponible", regla=None,
                                idioma=idioma, origen="usuario", creado_por=None))
        auditar(db, "intencion.solicitud", None, {"largo": len(texto)}, usuario_id)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def normalizar(intencion: str) -> str:
    texto = unicodedata.normalize("NFD", intencion.casefold())
    return " ".join("".join(c for c in texto if not unicodedata.combining(c)).split())


def guardar(interpretacion: Iterable["Interpretacion"], idioma: str,
            fabrica: Callable[[], Session]) -> None:
    vistas = set()
    filas = []
    for i in interpretacion:
        if i.tipo not in {"aproximada", "no_disponible"}:
            continue
        clave = normalizar(i.intencion)
        if clave in vistas:
            continue
        vistas.add(clave)
        filas.append(IntencionSinRegla(intencion=i.intencion, tipo=i.tipo, regla=i.regla,
                                      idioma=idioma, creado_por=None))
    if not filas:
        return
    db = fabrica()
    try:
        db.add_all(filas)
        db.commit()
    except Exception as error:
        # Registrar la demanda no debe tumbar la conversión; el error no lleva la frase del usuario.
        db.rollback()
        logger.warning("No se pudo registrar una intención sin regla (%s).", type(error).__name__)
    finally:
        db.close()


def agrupar(db: Session, dias: int = 90) -> list[dict]:
    desde = datetime.now(UTC) - timedelta(days=dias)
    filas = db.scalars(select(IntencionSinRegla).where(
        IntencionSinRegla.creado_en >= desde).order_by(
            IntencionSinRegla.creado_en, IntencionSinRegla.id)).all()
    grupos = {}
    for fila in filas:
        grupos.setdefault(normalizar(fila.intencion), []).append(fila)
    salida = []
    for intencion, grupo in grupos.items():
        salida.append({
            "intencion": intencion, "recuento": len(grupo),
            "tipo": Counter(f.tipo for f in grupo).most_common(1)[0][0],
            "regla": Counter(f.regla for f in grupo).most_common(1)[0][0],
            "primera": min(f.creado_en for f in grupo),
            "ultima": max(f.creado_en for f in grupo),
        })
    return sorted(salida, key=lambda g: (-g["recuento"], g["intencion"]))
