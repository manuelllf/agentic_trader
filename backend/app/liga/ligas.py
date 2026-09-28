"""Servicio de ligas privadas (`liga.ligas_privadas`/`liga.miembros_liga`, plan §6 y §11.2). Unirse
por código pasa siempre por `liga.unirse_liga`: saber un código nunca da acceso a leer la tabla, y
aquí solo se añade el límite de intentos fallidos (plan §14) que la BD no puede hacer por sí sola.
"""

from __future__ import annotations

import secrets
import uuid

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga import acceso, estrategias
from app.liga.procesos.comun import auditar, fabrica_sistema

# Sin ambigüedades (nada de I/O/0/1), igual que el `check` de `codigo` en el SQL.
_ALFABETO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_LARGO_CODIGO = 8
_INTENTOS_CODIGO = 5

# 10 intentos por hora y usuario (plan §14): cuenta solo los códigos que no existen, para frenar
# el fuerza bruta sin penalizar a quien solo se equivocó una vez.
LIMITE_UNIRSE = acceso.LimiteFallos(por_ip=10, global_=200, ventana_s=60 * 60)


def generar_codigo() -> str:
    return "".join(secrets.choice(_ALFABETO_CODIGO) for _ in range(_LARGO_CODIGO))


def unirse_con_codigo(db: Session, uid: str, codigo: str) -> uuid.UUID:
    """Envuelve `liga.unirse_liga`: cuenta como fallo solo cuando el código no existe."""
    try:
        with db.begin_nested():
            fila = db.execute(text("select liga.unirse_liga(:c) as id"), {"c": codigo}).one()
    except DBAPIError as e:
        if getattr(e.orig, "sqlstate", None) == "P0002":
            LIMITE_UNIRSE.fallo(uid)
        raise estrategias.mapear_error(e) from e
    LIMITE_UNIRSE.acierto(uid)
    return fila.id


def crear_liga(db: Session, nombre: str, cupo: int):  # noqa: ANN201 — Row de la BD, como en estrategias.py
    """Nace visible y con el dueño ya dentro (`liga.dueno_se_une`); Pro lo exige `ligas_guarda`."""
    for _ in range(_INTENTOS_CODIGO):
        codigo = generar_codigo()
        try:
            with db.begin_nested():
                fila = db.execute(text("""
                    insert into liga.ligas_privadas (nombre, codigo, cupo)
                    values (:nombre, :codigo, :cupo)
                    returning id, dueno_id, nombre, codigo, cupo, oculta, creada
                """), {"nombre": nombre, "codigo": codigo, "cupo": cupo}).one()
            return fila
        except DBAPIError as e:
            if getattr(e.orig, "sqlstate", None) == "23505":
                continue
            raise estrategias.mapear_error(e) from e
    raise HTTPException(503, "No se pudo generar un código nuevo. Prueba otra vez.")


def auditar_expulsion(liga_id: uuid.UUID, expulsado_id: str, actor: str) -> None:
    """`liga.auditoria` no tiene INSERT para `authenticated`: se apunta como sistema, aparte de
    la transacción del delete (RLS ya decidió si procedía)."""
    db = fabrica_sistema()
    try:
        auditar(db, "liga.expulsar", f"liga:{liga_id}", {"expulsado": expulsado_id}, actor)
        db.commit()
    finally:
        db.close()


def regenerar_codigo(db: Session, liga_id: uuid.UUID):  # noqa: ANN201 — Row o None
    """Reintenta con un código nuevo si choca con uno existente (32^8 combinaciones: rarísimo)."""
    for _ in range(_INTENTOS_CODIGO):
        codigo = generar_codigo()
        try:
            with db.begin_nested():
                fila = db.execute(text("""
                    update liga.ligas_privadas set codigo = :c where id = :i
                    returning id, dueno_id, nombre, codigo, cupo, oculta, creada
                """), {"c": codigo, "i": liga_id}).one_or_none()
            return fila
        except DBAPIError as e:
            if getattr(e.orig, "sqlstate", None) == "23505":
                continue
            raise estrategias.mapear_error(e) from e
    raise HTTPException(503, "No se pudo generar un código nuevo. Prueba otra vez.")
