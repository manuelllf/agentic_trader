"""Límites de frecuencia persistentes (plan §14): se cuentan en BD, no en memoria, para que un
despliegue en Railway no los resetee — a diferencia de `acceso.LimiteFrecuencia`, que sigue
sirviendo de tope de ráfaga (por si alguien intenta muchas peticiones en pocos segundos).

Cada consulta abre su propia sesión de sistema, como `ia.comun.veces_hoy`: `liga.auditoria` le
está vetada a `authenticated` por RLS (plan §7.3), y contar desde aquí no depende de qué política
tenga la tabla del dominio."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text

from app.liga.procesos.comun import auditar, fabrica_sistema

TZ_MADRID = ZoneInfo("Europe/Madrid")

TOPE_ALIAS_30_DIAS = 3
TOPE_PRUEBAS_DIA = 30
TOPE_LECTURAS_DIA = 50


def _inicio_dia_madrid() -> datetime:
    hoy = datetime.now(TZ_MADRID).date()
    return datetime(hoy.year, hoy.month, hoy.day, tzinfo=TZ_MADRID)


# ---- Cambiar el alias: 3 cada 30 días (ventana corrediza, no día de calendario) -----------------


def cambios_alias_recientes(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.auditoria
            where accion = 'cuenta.alias' and actor_id = cast(:u as uuid)
              and creada >= now() - interval '30 days'
        """), {"u": usuario_id}).scalar_one()
    finally:
        db.close()


def exigir_cambio_alias_disponible(usuario_id: str) -> None:
    if cambios_alias_recientes(usuario_id) >= TOPE_ALIAS_30_DIAS:
        raise HTTPException(
            429, f"Ya has cambiado de alias {TOPE_ALIAS_30_DIAS} veces en los últimos 30 días. "
            "Prueba más adelante.")


def auditar_cambio_alias(usuario_id: str, alias: str) -> None:
    """Aparte de la transacción que cambia el alias (que corre como el usuario): `liga.auditoria`
    no tiene INSERT para `authenticated`, así que se apunta como sistema, igual que
    `ligas.auditar_expulsion`."""
    db = fabrica_sistema()
    try:
        auditar(db, "cuenta.alias", f"usuario:{usuario_id}", {"alias": alias}, usuario_id)
        db.commit()
    finally:
        db.close()


# ---- Pruebas: 30 al día (día de Madrid) ---------------------------------------------------------


def pruebas_hoy(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.pruebas
            where usuario_id = cast(:u as uuid) and creada >= :inicio
        """), {"u": usuario_id, "inicio": _inicio_dia_madrid()}).scalar_one()
    finally:
        db.close()


def exigir_prueba_disponible(usuario_id: str) -> None:
    if pruebas_hoy(usuario_id) >= TOPE_PRUEBAS_DIA:
        raise HTTPException(429, f"Ya has hecho {TOPE_PRUEBAS_DIA} pruebas hoy. Prueba mañana.")


# ---- Lecturas: 50 al día (día de Madrid), contadas por lo que de verdad se ha comprado -----------


def lecturas_hoy(usuario_id: str) -> int:
    db = fabrica_sistema()
    try:
        return db.execute(text("""
            select count(*) from liga.creditos_movimientos
            where usuario_id = cast(:u as uuid) and motivo = 'lectura' and creado >= :inicio
        """), {"u": usuario_id, "inicio": _inicio_dia_madrid()}).scalar_one()
    finally:
        db.close()


def exigir_lectura_disponible(usuario_id: str) -> None:
    if lecturas_hoy(usuario_id) >= TOPE_LECTURAS_DIA:
        raise HTTPException(
            429, f"Ya has leído a fondo {TOPE_LECTURAS_DIA} empresas hoy. Prueba mañana.")
