"""Servicio de administración (roles, planes y créditos) y de moderación.

`liga.roles_usuario` y `liga.planes_usuario` no tienen GRANT de escritura para `authenticated`
(están reservados al sistema, como `liga.pruebas`): cada función abre su propia sesión de sistema
y cierra con auditoría, igual que `estrategias.crear_prueba_sistema`. `liga.cargar_creditos` está
vetada a `authenticated` por la misma razón (es `security definer` y el dueño la ejecuta igual).

Ocultar en moderación (perfiles, estrategias, ligas privadas) sí tiene GRANT + política RLS para
quien tiene `moderacion.revisar`, así que esas rutas corren enteras como el usuario (`db_usuario`):
no hace falta nada de este módulo para eso.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.procesos.comun import auditar, fabrica_sistema

# Únicas claves de `liga.ajustes` que la ruta genérica de admin deja tocar; el interruptor del
# diario ya tiene su propia ruta (`/liga/admin/procesos/diario/interruptor`) y se queda ahí.
AJUSTES_CONOCIDOS = frozenset({
    "creditos.pro_mensual",
    # IA de la liga (plan §10, F6): un interruptor por finalidad (ausente = apagado), el tope
    # mensual en dólares que los apaga todos, y el margen objetivo del panel de coste.
    "ia.conversor.activo", "ia.pregunta.activo", "ia.lectura.activo", "ia.moderacion.activo",
    "ia.tope_mensual_usd", "ia.margen_objetivo",
})
CLAVE_PRO_MENSUAL = "creditos.pro_mensual"


def conceder_rol(usuario_id: str, rol: str, conceder: bool, actor: str) -> None:
    db = fabrica_sistema()
    try:
        if conceder:
            db.execute(text(
                "insert into liga.roles_usuario (usuario_id, rol) "
                "values (cast(:u as uuid), cast(:r as liga.rol)) on conflict do nothing"),
                {"u": usuario_id, "r": rol})
        else:
            db.execute(text(
                "delete from liga.roles_usuario "
                "where usuario_id = cast(:u as uuid) and rol = cast(:r as liga.rol)"),
                {"u": usuario_id, "r": rol})
        auditar(db, "admin.rol", f"usuario:{usuario_id}", {"rol": rol, "conceder": conceder}, actor)
        db.commit()
    finally:
        db.close()


def suspender(usuario_id: str, suspendido: bool, actor: str) -> None:
    """Suspender = quitarle el rol `usuario`; reactivar, devolvérselo (plan §5.1)."""
    conceder_rol(usuario_id, "usuario", not suspendido, actor)


def fijar_plan_pro(usuario_id: str, hasta: datetime | None, actor: str) -> None:
    db = fabrica_sistema()
    try:
        db.execute(text(
            "insert into liga.planes_usuario (usuario_id, plan, hasta, origen, concedido_por) "
            "values (cast(:u as uuid), 'pro', :h, 'admin', cast(:a as uuid))"),
            {"u": usuario_id, "h": hasta, "a": actor})
        auditar(db, "admin.plan", f"usuario:{usuario_id}",
                {"plan": "pro", "hasta": hasta.isoformat() if hasta else None}, actor)
        db.commit()
    finally:
        db.close()


def quitar_plan_pro(usuario_id: str, actor: str) -> None:
    """No borra el historial: cierra ya (`hasta = now()`) las concesiones Pro vigentes."""
    db = fabrica_sistema()
    try:
        db.execute(text(
            "update liga.planes_usuario set hasta = now() "
            "where usuario_id = cast(:u as uuid) and plan = 'pro' "
            "and desde <= now() and (hasta is null or hasta > now())"), {"u": usuario_id})
        auditar(db, "admin.plan", f"usuario:{usuario_id}", {"plan": "gratis"}, actor)
        db.commit()
    finally:
        db.close()


def otorgar_creditos(usuario_id: str, importe: str, motivo: str, idempotencia: str,
                     actor: str) -> str:
    db = fabrica_sistema()
    try:
        saldo = db.execute(text(
            "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), :m, :k, "
            "null, null, cast(:a as uuid))"),
            {"u": usuario_id, "i": importe, "m": motivo, "k": idempotencia, "a": actor}).scalar()
        auditar(db, "admin.creditos", f"usuario:{usuario_id}",
                {"importe": importe, "motivo": motivo, "idempotencia": idempotencia}, actor)
        db.commit()
        return str(saldo)
    finally:
        db.close()


# ---- Panel de coste de IA (plan §10 y §16, F6.5) --------------------------------------------

# Finalidad → (stage de `llm_call`, motivo de `creditos_movimientos` que la cobra de verdad; None
# = gratis). El «reserva»/«devolucion» de una pregunta o lectura de pago se anulan entre sí; solo
# el motivo de liquidación es lo que de verdad se ha cobrado.
_FINALIDADES_COSTE = {
    "conversor": ("liga_conversor", None),
    "pregunta": ("liga_pregunta", "prueba"),
    "lectura": ("liga_lectura", "lectura"),
    "moderacion": ("liga_moderacion", None),
}
CLAVE_TOPE_MENSUAL = "ia.tope_mensual_usd"
CLAVE_MARGEN_OBJETIVO = "ia.margen_objetivo"
_MARGEN_OBJETIVO_DEFECTO = Decimal(3)
_USD_POR_CREDITO = Decimal("0.01")


def coste_ia(mes: date) -> dict:
    """Lo que pagamos y lo que cobramos por finalidad en el mes dado (día 1), en dólares
    contados, no estimados (plan §10.5): sin atribuir coste unidad a unidad. `mes` es el primer
    día del mes en curso; el rango va hasta el primer día del mes siguiente."""
    siguiente = date(mes.year + (mes.month == 12), mes.month % 12 + 1, 1)
    db = fabrica_sistema()
    try:
        margen_objetivo = db.execute(
            text("select valor from liga.ajustes where clave = :c"),
            {"c": CLAVE_MARGEN_OBJETIVO}).scalar()
        margen_objetivo = Decimal(str(margen_objetivo)) if margen_objetivo is not None \
            else _MARGEN_OBJETIVO_DEFECTO
        tope_mensual = db.execute(
            text("select valor from liga.ajustes where clave = :c"),
            {"c": CLAVE_TOPE_MENSUAL}).scalar()

        filas = []
        total_pagado = Decimal(0)
        total_cobrado = Decimal(0)
        for finalidad, (stage, motivo) in _FINALIDADES_COSTE.items():
            pagado = db.execute(text("""
                select coalesce(sum(cost_usd), 0)::numeric as pagado, count(*) as llamadas
                from llm_call where stage = :stage and at >= :desde and at < :hasta
            """), {"stage": stage, "desde": mes, "hasta": siguiente}).one()
            cobrado_creditos = Decimal(0)
            if motivo is not None:
                cobrado_creditos = db.execute(text("""
                    select coalesce(sum(-importe), 0) from liga.creditos_movimientos
                    where motivo = :motivo and importe < 0 and creado >= :desde and creado < :hasta
                """), {"motivo": motivo, "desde": mes, "hasta": siguiente}).scalar_one()
            cache_hits = db.execute(text("""
                select count(*) from liga.auditoria
                where accion = :accion and (detalle->>'cache') = 'true'
                  and creada >= :desde and creada < :hasta
            """), {"accion": f"ia.{finalidad}", "desde": mes, "hasta": siguiente}).scalar_one()
            pagado_usd = Decimal(str(pagado.pagado))
            cobrado_usd = (cobrado_creditos * _USD_POR_CREDITO).quantize(Decimal("0.0001"))
            ratio = (cobrado_usd / pagado_usd) if pagado_usd > 0 else None
            total_pagado += pagado_usd
            total_cobrado += cobrado_usd
            filas.append({
                "finalidad": finalidad, "pagado_usd": pagado_usd, "cobrado_usd": cobrado_usd,
                "llamadas": pagado.llamadas, "cache_hits": cache_hits, "ratio": ratio,
                "bajo_objetivo": ratio is not None and ratio < margen_objetivo,
            })
        return {
            "mes": mes.isoformat(), "filas": filas, "total_pagado_usd": total_pagado,
            "total_cobrado_usd": total_cobrado,
            "tope_mensual_usd": Decimal(str(tope_mensual)) if tope_mensual is not None else None,
            "margen_objetivo": margen_objetivo,
        }
    finally:
        db.close()


def dar_creditos_pro_mensual(db: Session, jornada_id: int, actor: str | None) -> dict:
    """Créditos Pro del mes (plan §16), en la misma transacción que forma la jornada: idempotente
    por usuario y jornada gracias a la propia `cargar_creditos`. Sin importe decidido todavía en
    `liga.ajustes` (`creditos.pro_mensual`), no da nada — se deja para cuando se fije la cifra."""
    importe = db.execute(text("select valor from liga.ajustes where clave = :c"),
                         {"c": CLAVE_PRO_MENSUAL}).scalar()
    if importe is None:
        return {"dado": False, "motivo": "sin importe definido en liga.ajustes"}
    usuarios = db.execute(text(
        "select distinct usuario_id from liga.planes_usuario where plan = 'pro' "
        "and desde <= now() and (hasta is null or hasta > now())")).scalars().all()
    idem = f"pro_mensual:{jornada_id}"
    for u in usuarios:
        db.execute(text(
            "select liga.cargar_creditos(:u, cast(:i as numeric), 'pro_mensual', :k)"),
            {"u": u, "i": str(importe), "k": idem})
    if usuarios:
        auditar(db, "proceso.formar.pro_mensual", f"jornada:{jornada_id}",
                {"usuarios": len(usuarios), "importe": str(importe)}, actor)
    return {"dado": True, "usuarios": len(usuarios), "importe": str(importe)}
