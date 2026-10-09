"""Aplica al estado de la liga lo que dice Lemon. Cada webhook se apunta en `liga.eventos_pago` por
su huella: un reenvío se reconoce y no se aplica dos veces. La última versión de cada compra se
guarda en `liga.compras_pago` y se bloquea al procesar: dos eventos de la misma compra no se pisan,
y un evento más viejo que la versión guardada se apunta pero no cambia nada. Cada derecho guarda la
compra que lo dio, así una baja solo corta lo suyo."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import text

from app.liga.pagos_lemon import Accion, clave_idempotencia
from app.liga.procesos.comun import auditar, fabrica_sistema

logger = logging.getLogger(__name__)


def registrar(cuerpo: bytes, accion: Accion, evento: str) -> str:
    """Devuelve «duplicado», «obsoleto», «ignorado» o «aplicado». Un error de base de datos
    deshace todo y sale hacia fuera: así Lemon reintenta el mismo evento."""
    clave = clave_idempotencia(cuerpo)
    db = fabrica_sistema()
    try:
        nuevo = db.execute(text(
            "insert into liga.eventos_pago (clave, evento, lemon_id, estado) "
            "values (:c, :e, :l, 'recibido') on conflict (clave) do nothing returning clave"),
            {"c": clave, "e": evento, "l": accion.lemon_id}).first()
        if nuevo is None:
            db.rollback()
            logger.info("Webhook de Lemon repetido (%s, %s)", evento, accion.lemon_id)
            return "duplicado"

        if accion.tipo == "ignorar":
            estado = "ignorado"
            logger.info("Webhook de Lemon ignorado: %s (%s, %s)", accion.motivo, evento,
                        accion.lemon_id)
        elif not _es_mas_reciente(db, accion):
            estado = "obsoleto"
            logger.info("Webhook de Lemon obsoleto (%s, %s)", evento, accion.lemon_id)
        else:
            _aplicar(db, accion, evento)
            estado = "aplicado"
            logger.info("Webhook de Lemon aplicado: %s → %s (%s)", evento, accion.tipo,
                        accion.lemon_id)

        db.execute(text("update liga.eventos_pago set estado = :s, procesado_en = now() "
                        "where clave = :c"), {"s": estado, "c": clave})
        db.commit()
        return estado
    except Exception:
        db.rollback()
        logger.exception("Error aplicando el webhook de Lemon (%s)", evento)
        raise
    finally:
        db.close()


def _es_mas_reciente(db, accion: Accion) -> bool:  # noqa: ANN001
    """Bloquea la fila de la compra y compara con su última versión. Sin versión, el evento es
    nuevo. El bloqueo hace que dos eventos de la misma compra se procesen uno detrás de otro."""
    if accion.lemon_id is None or accion.actualizado_en is None:
        return True
    previa = db.execute(text("select actualizado_lemon from liga.compras_pago "
                             "where lemon_id = :l for update"), {"l": accion.lemon_id}).scalar()
    return previa is None or accion.actualizado_en > previa


def _aplicar(db, accion: Accion, evento: str) -> None:  # noqa: ANN001
    if accion.producto and accion.lemon_id and accion.usuario_id:
        db.execute(text(
            "insert into liga.compras_pago (lemon_id, usuario_id, producto, estado, "
            "actualizado_lemon) values (:l, cast(:u as uuid), :p, :e, :a) "
            "on conflict (lemon_id) do update set estado = excluded.estado, "
            "actualizado_lemon = excluded.actualizado_lemon, actualizado_local = now()"),
            {"l": accion.lemon_id, "u": accion.usuario_id, "p": accion.producto,
             "e": evento, "a": accion.actualizado_en})

    if accion.tipo == "pro":
        _dar_o_extender(db, "liga.planes_usuario", accion, plan_pro=True)
    elif accion.tipo == "pase":
        _dar_o_extender(db, "liga.pases_liga", accion, plan_pro=False)
    elif accion.tipo == "baja":
        _cortar(db, "liga.planes_usuario", accion)
        _cortar(db, "liga.pases_liga", accion)

    auditar(db, "pago.lemon", f"lemon:{accion.lemon_id}",
            {"evento": evento, "tipo": accion.tipo, "producto": accion.producto}, None)


def _dar_o_extender(db, tabla: str, accion: Accion, plan_pro: bool) -> None:  # noqa: ANN001
    """Una fila por compra: si ya existe la extiende (renovación o reanudación); si no, la crea."""
    fin: datetime | None = accion.hasta
    cambio = db.execute(text(
        f"update {tabla} set hasta = :h where id = ("
        f"  select id from {tabla} where compra_lemon_id = :c and origen = 'pago'"
        "  order by desde desc limit 1) returning id"),
        {"h": fin, "c": accion.lemon_id}).first()
    if cambio is not None:
        return
    if plan_pro:
        db.execute(text(
            "insert into liga.planes_usuario (usuario_id, plan, hasta, origen, compra_lemon_id) "
            "values (cast(:u as uuid), 'pro', :h, 'pago', :c)"),
            {"u": accion.usuario_id, "h": fin, "c": accion.lemon_id})
    else:
        db.execute(text(
            "insert into liga.pases_liga (usuario_id, hasta, origen, compra_lemon_id) "
            "values (cast(:u as uuid), :h, 'pago', :c)"),
            {"u": accion.usuario_id, "h": fin, "c": accion.lemon_id})


def _cortar(db, tabla: str, accion: Accion) -> None:  # noqa: ANN001
    """Solo los derechos de esta compra. Sin `hasta`, el acceso termina ya; con él (cancelación),
    termina en esa fecha, sin acortar otra fecha ya guardada que sea anterior."""
    fin = accion.hasta or datetime.now().astimezone()
    db.execute(text(
        f"update {tabla} set hasta = :f where compra_lemon_id = :c and origen = 'pago' "
        "and (hasta is null or hasta > :f)"),
        {"f": fin, "c": accion.lemon_id})
