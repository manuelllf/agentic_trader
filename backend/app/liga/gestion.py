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

import logging
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

import httpx
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.config import settings
from app.liga.ia import comun as ia_comun
from app.liga.procesos.comun import auditar, fabrica_sistema

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AjusteMeta:
    """Lo que el panel de ajustes necesita para explicarse solo (feedback de Manuel: los
    interruptores de hoy no dicen qué hacen ni si van). `defecto` es el valor que usa de verdad
    la app cuando la clave no está en `liga.ajustes` -- tiene que coincidir con el código real
    (`gestion.py`/`ia/comun.py`), no es solo decorativo."""

    grupo: Literal["Emergencia", "IA", "Créditos", "Procesos"]
    titulo: str
    ayuda: str
    tipo: Literal["interruptor", "entero", "dolares", "multiplicador"]
    unidad: str | None
    minimo: Decimal | None
    maximo: Decimal | None
    defecto: Any


# Únicas claves de `liga.ajustes` que la ruta genérica de admin deja tocar; el interruptor del
# diario ya tiene su propia ruta (`/liga/admin/procesos/diario/interruptor`) y se queda ahí.
CATALOGO: dict[str, AjusteMeta] = {
    # Interruptores de emergencia (plan §14): ausente = comportamiento de hoy (registro abierto,
    # liga visible). El del diario ya tiene su propia ruta y se queda fuera de esta lista.
    "liga.registro.abierto": AjusteMeta(
        grupo="Emergencia", titulo="Registro de nuevos usuarios",
        ayuda="Deja que se registre gente nueva en la liga. Apagado: nadie nuevo puede "
              "registrarse (los que ya están, siguen jugando).",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True),
    "liga.visible": AjusteMeta(
        grupo="Emergencia", titulo="Liga visible sin iniciar sesión",
        ayuda="Enseña la liga a quien no ha iniciado sesión. Apagado: solo se ve iniciando "
              "sesión.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True),
    # IA de la liga (plan §10, F6): un interruptor por finalidad (ausente = apagado), el tope
    # mensual en dólares que los apaga todos, y el margen objetivo del panel de coste.
    "ia.conversor.activo": AjusteMeta(
        grupo="IA", titulo="Conversor de frase a reglas",
        ayuda="Deja convertir una frase en lenguaje natural en reglas de estrategia con IA. "
              "Apagado: esa conversión no está disponible.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "ia.pregunta.activo": AjusteMeta(
        grupo="IA", titulo="Pregunta a la IA sobre una empresa",
        ayuda="Deja preguntar a la IA (Jev) sobre una empresa dentro de una prueba. Apagado: "
              "esa pregunta no está disponible.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "ia.lectura.activo": AjusteMeta(
        grupo="IA", titulo="Lectura de resultados con IA",
        ayuda="Genera un texto que explica los resultados de una estrategia. Apagado: no se "
              "genera esa lectura.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "ia.moderacion.activo": AjusteMeta(
        grupo="IA", titulo="Moderación automática con IA",
        ayuda="Ayuda a revisar con IA el contenido reportado. Apagado: la moderación es solo "
              "manual.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "ia.tope_mensual_usd": AjusteMeta(
        grupo="IA", titulo="Tope de gasto mensual en IA",
        ayuda="Si el gasto real del mes en IA llega a este importe, se apagan todas las "
              "llamadas de IA hasta el mes siguiente. Sin valor: no hay tope.",
        tipo="dolares", unidad="$/mes", minimo=Decimal(0), maximo=None, defecto=None),
    "ia.margen_objetivo": AjusteMeta(
        grupo="IA", titulo="Margen objetivo del panel de coste",
        ayuda="Cuántas veces por encima del coste real se marca una finalidad como rentable en "
              "el panel de coste. No apaga nada, solo colorea el panel.",
        tipo="multiplicador", unidad="×", minimo=Decimal(0), maximo=None, defecto=3.0),
    "creditos.pro_mensual": AjusteMeta(
        grupo="Créditos", titulo="Créditos mensuales para Pro",
        ayuda="Créditos que se dan cada mes, en automático, a cada usuario Pro. Sin valor: no "
              "se da nada todavía.",
        tipo="dolares", unidad="créditos/mes", minimo=Decimal(0), maximo=None, defecto=None),
    # Foto automática de la jornada (backlog, plan §8/§13): al terminar el escaneo mensual de
    # decisión, designa sola la foto+escaneo de la próxima jornada sin foto. Encendido por
    # defecto; el botón manual sigue de reserva si se apaga o si algo no encaja.
    "procesos.foto.auto": AjusteMeta(
        grupo="Procesos", titulo="Foto automática de la jornada",
        ayuda="Al terminar el escaneo mensual de decisión, designa sola la foto y el escaneo de "
              "la próxima jornada sin foto. Apagado: solo vale el botón manual.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True),
}
AJUSTES_CONOCIDOS = frozenset(CATALOGO)
CLAVE_PRO_MENSUAL = "creditos.pro_mensual"
CLAVE_REGISTRO_ABIERTO = "liga.registro.abierto"
CLAVE_LIGA_VISIBLE = "liga.visible"
CLAVE_FOTO_AUTO = "procesos.foto.auto"


def restablecer_ajuste(clave: str, actor: str) -> None:
    """Vuelve una clave a su valor por defecto borrando la fila. `liga.ajustes` no tiene GRANT
    de `delete` para `authenticated` (solo `insert`/`update`, plan §7.3 no lo previó) -- como
    `liga.roles_usuario`, esta escritura pasa por su propia sesión de sistema."""
    db = fabrica_sistema()
    try:
        db.execute(text("delete from liga.ajustes where clave = :c"), {"c": clave})
        auditar(db, "admin.ajuste.restablecer", clave, {}, actor)
        db.commit()
    finally:
        db.close()
    invalidar_cache_ajustes(clave)


def valor_efectivo(clave: str, valor: Any) -> Any:
    """Lo que la app usa de verdad ahora mismo: el valor guardado, o el `defecto` del catálogo
    si la clave no está en `liga.ajustes`."""
    return CATALOGO[clave].defecto if valor is None else valor


def validar_ajuste(clave: str, valor: Any) -> Any:
    """Valor normalizado listo para `jsonb`, o levanta `ValueError` con el mensaje en español
    que ve el admin (la ruta lo convierte en 422)."""
    meta = CATALOGO[clave]
    if meta.tipo == "interruptor":
        if not isinstance(valor, bool):
            raise ValueError(f"«{meta.titulo}» es un interruptor: manda true o false.")
        return valor
    if meta.tipo == "entero":
        if not isinstance(valor, int) or isinstance(valor, bool):
            raise ValueError(f"«{meta.titulo}» tiene que ser un número entero.")
        if meta.minimo is not None and valor < meta.minimo:
            raise ValueError(f"«{meta.titulo}» no puede ser menor que {meta.minimo}.")
        if meta.maximo is not None and valor > meta.maximo:
            raise ValueError(f"«{meta.titulo}» no puede ser mayor que {meta.maximo}.")
        return valor
    # "dolares" / "multiplicador": decimal >= 0 con 2 decimales.
    if isinstance(valor, bool):
        raise ValueError(f"«{meta.titulo}» tiene que ser un número.")
    try:
        decimal_valor = Decimal(str(valor)).quantize(Decimal("0.01"))
    except InvalidOperation as e:
        raise ValueError(f"«{meta.titulo}» tiene que ser un número.") from e
    if decimal_valor < (meta.minimo or Decimal(0)):
        raise ValueError(f"«{meta.titulo}» no puede ser negativo.")
    if meta.maximo is not None and decimal_valor > meta.maximo:
        raise ValueError(f"«{meta.titulo}» no puede ser mayor que {meta.maximo}.")
    return float(decimal_valor)


# Caché en memoria de proceso de `liga.ajustes` (hallazgos de latencia #3 y de seguridad #2):
# `liga.visible`/`liga.registro.abierto` se leían con una sesión de sistema NUEVA en cada
# petición pública (2-3 conexiones extra por `GET /liga/publico/*`, confirmado con el contador
# de round trips) para dos interruptores que un admin cambia rarísima vez. TTL corto (no hace
# falta exactitud al segundo para un interruptor de emergencia) e invalidación inmediata al
# escribir desde este mismo proceso (`restablecer_ajuste` aquí, `actualizar_ajuste` en
# `rutas_gestion`) para que un admin vea su propio cambio sin esperar al TTL.
_CACHE_AJUSTES_TTL_S = 15.0
_cache_ajustes_lock = threading.Lock()
_cache_ajustes: dict[str, tuple[float, Any]] = {}


def _leer_ajustes_cacheados(claves: tuple[str, ...]) -> dict[str, Any]:
    ahora = time.monotonic()
    with _cache_ajustes_lock:
        faltan = [c for c in claves if c not in _cache_ajustes or _cache_ajustes[c][0] < ahora]
    if faltan:
        db = fabrica_sistema()
        try:
            filas = db.execute(text(
                "select clave, valor from liga.ajustes where clave = any(:c)"),
                {"c": faltan}).all()
        finally:
            db.close()
        encontradas = {f.clave: f.valor for f in filas}
        vencimiento = ahora + _CACHE_AJUSTES_TTL_S
        with _cache_ajustes_lock:
            for c in faltan:
                _cache_ajustes[c] = (vencimiento, encontradas.get(c))
    with _cache_ajustes_lock:
        return {c: _cache_ajustes[c][1] for c in claves}


def invalidar_cache_ajustes(clave: str | None = None) -> None:
    """Se llama justo después de escribir en `liga.ajustes` desde este proceso: la próxima
    lectura vuelve a ir a la BD en vez de esperar al TTL. `None` limpia toda la caché."""
    with _cache_ajustes_lock:
        if clave is None:
            _cache_ajustes.clear()
        else:
            _cache_ajustes.pop(clave, None)


def _ajuste_booleano(clave: str, por_defecto: bool) -> bool:
    """Un ajuste de `liga.ajustes`, con caché de proceso: RLS solo deja verlo al admin (plan
    §7.3), y estos dos los consulta cualquier petición pública. Ausente = comportamiento de hoy."""
    valor = _leer_ajustes_cacheados((clave,))[clave]
    return por_defecto if valor is None else bool(valor)


def registro_abierto() -> bool:
    return _ajuste_booleano(CLAVE_REGISTRO_ABIERTO, por_defecto=True)


def liga_visible() -> bool:
    return _ajuste_booleano(CLAVE_LIGA_VISIBLE, por_defecto=True)


def alta_usuario(email: str, alias: str | None, actor: str) -> dict:
    """Alta a mano desde admin: crea la cuenta en Supabase Auth ya confirmada (no manda correo, no
    hace falta SMTP) con una contraseña temporal que solo se devuelve aquí, una vez. El trigger
    `liga.alta_usuario` crea perfil, datos privados y rol; el alias, si viene y vale, se fija
    después: si la BD lo rechaza (formato, reservado, repetido) la cuenta queda con el suyo por
    defecto y se avisa, sin deshacer el alta."""
    if not settings.supabase_secret_key or not settings.supabase_url:
        raise HTTPException(503, "El alta de usuarios todavía no está activada.")
    clave = secrets.token_urlsafe(9)
    try:
        r = httpx.post(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
            # Solo `apikey`: las claves `sb_secret_...` no valen en `Authorization: Bearer`.
            headers={"apikey": settings.supabase_secret_key},
            json={"email": email, "password": clave, "email_confirm": True},
            timeout=10)
    except httpx.HTTPError as e:
        raise HTTPException(503, "No se pudo dar de alta ahora. Prueba en un momento.") from e
    if r.status_code in (409, 422):
        existe = "email_exists" in r.text or "already" in r.text.lower()
        raise HTTPException(
            409 if existe else 422,
            "Ese correo ya tiene cuenta." if existe else "Ese correo no vale.")
    if r.status_code not in (200, 201):
        logger.warning("Supabase Auth respondió %s al dar de alta una cuenta", r.status_code)
        raise HTTPException(503, "No se pudo dar de alta ahora. Prueba en un momento.")
    uid = r.json()["id"]

    db = fabrica_sistema()
    try:
        aplicado = False
        if alias:
            try:
                with db.begin_nested():
                    db.execute(text(
                        "update liga.perfiles set alias = :a where id = cast(:u as uuid)"),
                        {"a": alias, "u": uid})
                aplicado = True
            except DBAPIError:
                aplicado = False
        final = db.execute(text(
            "select alias from liga.perfiles where id = cast(:u as uuid)"), {"u": uid}).scalar()
        auditar(db, "admin.usuario.alta", f"usuario:{uid}", {"alias": final}, actor)
        db.commit()
    finally:
        db.close()
    return {"id": uid, "email": email, "alias": final,
            "alias_aplicado": aplicado or not alias, "clave_temporal": clave}


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


# ---- Estado real de la IA (plan §10, F6): «si va o no va», visto desde /liga/admin/ajustes ---


def estado_ia() -> dict:
    """El estado que de verdad usa la app ahora mismo, no lo que hay guardado: `ENABLE_LLM` de
    este despliegue, si las claves de proveedor están puestas (nunca su valor), el gasto del mes
    frente al tope y, por finalidad, si funciona y por qué no si no funciona -- reusa
    `ia.comun.razon_no_disponible`, no duplica la lógica."""
    from app.config import settings

    db = fabrica_sistema()
    try:
        gastado = db.execute(text("""
            select coalesce(sum(cost_usd), 0) from llm_call
            where stage = any(:etapas) and at >= date_trunc('month', now())
        """), {"etapas": [s for s, _ in _FINALIDADES_COSTE.values()]}).scalar_one()
        tope = db.execute(text("select valor from liga.ajustes where clave = :c"),
                          {"c": CLAVE_TOPE_MENSUAL}).scalar()
        finalidades = [
            {"finalidad": f, "funciona": (razon := ia_comun.razon_no_disponible(f, db=db)) is None,
             "razon": razon}
            for f in _FINALIDADES_COSTE
        ]
        return {
            "enable_llm": settings.enable_llm,
            "deepseek_key_presente": settings.llm_api_key_present,
            "typesafe_key_presente": bool(settings.typesafe_api_key),
            "gasto_mes_usd": Decimal(str(gastado)),
            "tope_mensual_usd": Decimal(str(tope)) if tope is not None else None,
            "finalidades": finalidades,
        }
    finally:
        db.close()


def dar_creditos_pro_mensual(db: Session, jornada_id: int, actor: str | None) -> dict:
    """Créditos Pro del mes (plan §16), en la misma transacción que forma la jornada: idempotente
    por usuario y jornada gracias a la propia `cargar_creditos`. Sin importe decidido todavía en
    `liga.ajustes` (`creditos.pro_mensual`), no da nada — se deja para cuando se fije la cifra.

    Una sola sentencia (set-based): antes era un `for` en Python con un round trip por usuario
    Pro, dentro del candado `formar` (hallazgo de procesos: escala mal si crecen los usuarios
    Pro, alarga cuánto tiempo se sostiene el candado)."""
    importe = db.execute(text("select valor from liga.ajustes where clave = :c"),
                         {"c": CLAVE_PRO_MENSUAL}).scalar()
    if importe is None:
        return {"dado": False, "motivo": "sin importe definido en liga.ajustes"}
    idem = f"pro_mensual:{jornada_id}"
    usuarios = db.execute(text("""
        select u.usuario_id,
               liga.cargar_creditos(u.usuario_id, cast(:i as numeric), 'pro_mensual', :k)
        from (
            select distinct usuario_id from liga.planes_usuario
            where plan = 'pro' and desde <= now() and (hasta is null or hasta > now())
        ) u
    """), {"i": str(importe), "k": idem}).scalars().all()
    if usuarios:
        auditar(db, "proceso.formar.pro_mensual", f"jornada:{jornada_id}",
                {"usuarios": len(usuarios), "importe": str(importe)}, actor)
    return {"dado": True, "usuarios": len(usuarios), "importe": str(importe)}
