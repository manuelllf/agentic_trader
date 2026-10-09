"""Aplica al estado de la liga lo que dice Lemon. Cada webhook se apunta en `liga.eventos_pago` por
su huella: un reenvío se reconoce y no se aplica dos veces. La última versión de cada compra se
guarda en `liga.compras_pago`: un evento más viejo que ella se apunta pero no pisa nada."""

from __future__ import annotations

from sqlalchemy import text

from app.liga.pagos_lemon import Accion, clave_idempotencia
from app.liga.procesos.comun import auditar, fabrica_sistema


def registrar(cuerpo: bytes, accion: Accion, evento: str) -> str:
    """Devuelve «duplicado», «obsoleto», «ignorado» o «aplicado»."""
    clave = clave_idempotencia(cuerpo)
    db = fabrica_sistema()
    try:
        nuevo = db.execute(text(
            "insert into liga.eventos_pago (clave, evento, lemon_id, estado) "
            "values (:c, :e, :l, 'recibido') on conflict (clave) do nothing returning clave"),
            {"c": clave, "e": evento, "l": accion.lemon_id}).first()
        if nuevo is None:
            db.rollback()
            return "duplicado"

        if accion.tipo == "ignorar":
            estado = "ignorado"
        elif not _es_mas_reciente(db, accion):
            estado = "obsoleto"
        else:
            _aplicar(db, accion, evento)
            estado = "aplicado"

        db.execute(text("update liga.eventos_pago set estado = :s, procesado_en = now() "
                        "where clave = :c"), {"s": estado, "c": clave})
        db.commit()
        return estado
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _es_mas_reciente(db, accion: Accion) -> bool:
    """Compara con la última versión guardada de esa compra. Sin versión, el evento es nuevo."""
    if accion.lemon_id is None or accion.actualizado_en is None:
        return True
    previa = db.execute(text("select actualizado_lemon from liga.compras_pago "
                             "where lemon_id = :l"), {"l": accion.lemon_id}).scalar()
    return previa is None or accion.actualizado_en > previa


def _aplicar(db, accion: Accion, evento: str) -> None:
    if accion.producto and accion.lemon_id:
        db.execute(text(
            "insert into liga.compras_pago (lemon_id, usuario_id, producto, estado, "
            "actualizado_lemon) values (:l, cast(:u as uuid), :p, :e, :a) "
            "on conflict (lemon_id) do update set estado = excluded.estado, "
            "actualizado_lemon = excluded.actualizado_lemon, actualizado_local = now()"),
            {"l": accion.lemon_id, "u": accion.usuario_id, "p": accion.producto,
             "e": evento, "a": accion.actualizado_en})

    if accion.tipo == "pro":
        db.execute(text(
            "insert into liga.planes_usuario (usuario_id, plan, hasta, origen) "
            "values (cast(:u as uuid), 'pro', :h, 'pago')"),
            {"u": accion.usuario_id, "h": accion.hasta})
    elif accion.tipo == "pase":
        db.execute(text(
            "insert into liga.pases_liga (usuario_id, hasta, origen) "
            "values (cast(:u as uuid), :h, 'pago')"), {"u": accion.usuario_id, "h": accion.hasta})
    elif accion.tipo == "baja":
        db.execute(text(
            "update liga.planes_usuario set hasta = now() where usuario_id = cast(:u as uuid) "
            "and origen = 'pago' and desde <= now() and (hasta is null or hasta > now())"),
            {"u": accion.usuario_id})

    auditar(db, "pago.lemon", f"lemon:{accion.lemon_id}",
            {"evento": evento, "tipo": accion.tipo, "producto": accion.producto}, None)
