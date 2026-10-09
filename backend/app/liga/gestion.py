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

import json
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
from app.liga.models import AvisoError
from app.liga.procesos.comun import auditar, fabrica_sistema

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AjusteMeta:
    """Lo que el panel de ajustes necesita para explicarse solo (feedback de Manuel: los
    interruptores de hoy no dicen qué hacen ni si van). `defecto` es el valor que usa de verdad
    la app cuando la clave no está en `liga.ajustes` -- tiene que coincidir con el código real
    (`gestion.py`/`ia/comun.py`), no es solo decorativo."""

    grupo: Literal["Emergencia", "IA", "Créditos", "Procesos", "Premio"]
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
    # Sin configuración explícita se conserva la liga visible y el registro cerrado.
    "liga.registro.abierto": AjusteMeta(
        grupo="Emergencia", titulo="Registro de nuevos usuarios",
        ayuda="Deja que se registre gente nueva en la liga. Apagado: nadie nuevo puede "
              "registrarse (los que ya están, siguen jugando).",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
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
    "ia.tope_mensual_usd": AjusteMeta(
        grupo="IA", titulo="Tope de gasto mensual en IA",
        ayuda="Si el gasto real del mes en IA de los usuarios (conversor, pruebas y lecturas) "
              "llega a este importe, se apagan esas llamadas hasta el mes siguiente. Sin valor: "
              "no hay tope.",
        tipo="dolares", unidad="$/mes", minimo=Decimal(0), maximo=None, defecto=None),
    "ia.formacion.activo": AjusteMeta(
        grupo="IA", titulo="Pregunta propia al formar la jornada",
        ayuda="Deja que el sistema conteste con IA (Jev) la pregunta propia de cada estrategia al "
              "formar la jornada. Apagado: esas estrategias juegan sin su pregunta.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "ia.tope_formacion_usd": AjusteMeta(
        grupo="IA", titulo="Tope de gasto mensual al formar la jornada",
        ayuda="Si el gasto del mes en las preguntas de la formación llega a este importe, esas "
              "estrategias juegan sin pregunta hasta el mes siguiente. Aparte del tope de los "
              "usuarios. Sin valor: no hay tope.",
        tipo="dolares", unidad="$/mes", minimo=Decimal(0), maximo=None, defecto=None),
    "procesos.formar.limite_preguntas_s": AjusteMeta(
        grupo="IA", titulo="Tiempo máximo para las preguntas al formar",
        ayuda="Segundos que espera la formación a que la IA conteste las preguntas propias. Al "
              "agotarse, las estrategias sin todas sus respuestas juegan sin pregunta.",
        tipo="entero", unidad="s", minimo=Decimal(60), maximo=Decimal(1800), defecto=600),
    "premio.visible": AjusteMeta(
        grupo="Premio", titulo="Enseñar el premio",
        ayuda="Muestra en la liga el premio anual, sus escalones y cuántas cuentas optan. "
              "Apagado hasta que un abogado revise las bases legales.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=False),
    "premio.umbral_basico": AjusteMeta(
        grupo="Premio", titulo="Cuentas para activar el premio",
        ayuda="Cuentas elegibles (con 10 jornadas jugadas) que hacen falta al cerrar la temporada "
              "para repartir el primer escalón del premio. Con menos, no se activa.",
        tipo="entero", unidad="cuentas", minimo=Decimal(1), maximo=Decimal(100000), defecto=100),
    "premio.umbral_completo": AjusteMeta(
        grupo="Premio", titulo="Cuentas para el premio completo",
        ayuda="Cuentas elegibles que hacen falta para repartir el premio completo, el segundo "
              "escalón. Si se pone por debajo del anterior, vale el anterior.",
        tipo="entero", unidad="cuentas", minimo=Decimal(1), maximo=Decimal(100000), defecto=250),
    "ia.margen_objetivo": AjusteMeta(
        grupo="IA", titulo="Margen objetivo del panel de coste",
        ayuda="Cuántas veces por encima del coste real se marca una finalidad como rentable en "
              "el panel de coste. No apaga nada, solo colorea el panel.",
        tipo="multiplicador", unidad="×", minimo=Decimal(0), maximo=None, defecto=3.0),
    "creditos.bienvenida": AjusteMeta(
        grupo="Créditos", titulo="Créditos de bienvenida",
        ayuda="Créditos que recibe una sola vez cada cuenta nueva al crearse. Solo afecta a las "
              "cuentas que se creen desde ahora; 0 lo apaga.",
        tipo="dolares", unidad="créditos", minimo=Decimal(0), maximo=None, defecto=30),
    # Foto automática de la jornada (backlog, plan §8/§13): al terminar el escaneo mensual de
    # decisión, designa sola la foto+escaneo de la próxima jornada sin foto. Encendido por
    # defecto; el botón manual sigue de reserva si se apaga o si algo no encaja.
    "procesos.foto.auto": AjusteMeta(
        grupo="Procesos", titulo="Foto automática de la jornada",
        ayuda="Al terminar el escaneo mensual de decisión, designa sola la foto y el escaneo de "
              "la próxima jornada sin foto. Apagado: solo vale el botón manual.",
        tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True),
}
CATALOGO["procesos.formar.auto"] = AjusteMeta(
    grupo="Procesos", titulo="Formar la jornada sola",
    ayuda="Cada 5 minutos comprueba si hay una jornada que ya puede formarse (pasado su corte de "
          "las 18:00 de Nueva York del último día de bolsa anterior, con su foto y su escaneo "
          "designados) y la forma. Es el camino normal. Apagado (emergencia): solo vale el botón "
          "de Admin.",
    tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True)
CATALOGO["procesos.cerrar.auto"] = AjusteMeta(
    grupo="Procesos", titulo="Cerrar la jornada sola",
    ayuda="Cada 5 minutos, desde las 17:30 de Nueva York del último día de bolsa, cierra la "
          "jornada que acaba si están los cierres del S&P y de todos sus valores. Si falta alguno "
          "no cierra y avisa. Apagado (emergencia): solo vale el botón de Admin.",
    tipo="interruptor", unidad=None, minimo=None, maximo=None, defecto=True)
AJUSTES_CONOCIDOS = frozenset(CATALOGO)
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
    return _ajuste_booleano(CLAVE_REGISTRO_ABIERTO, por_defecto=False)


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


def registrar_aviso_error(usuario_id: str | None, codigo: str | None, pantalla: str, mensaje: str,
                          nota: str | None, contexto: dict) -> None:
    """Deja la nota para el admin. Se escribe como sistema porque quien avisa puede no tener
    sesión; el contexto es técnico y pequeño: si se pasa de tamaño, se descarta antes que romper
    el aviso."""
    contexto = {str(k)[:40]: (v[:200] if isinstance(v, str) else v) for k, v in contexto.items()}
    if len(json.dumps(contexto, default=str)) > 1500:
        contexto = {}
    db = fabrica_sistema()
    try:
        db.add(AvisoError(codigo=codigo, usuario_id=usuario_id, creado_por=usuario_id,
                          pantalla=pantalla, mensaje=mensaje, nota=nota, contexto=contexto))
        db.commit()
    finally:
        db.close()
    logger.warning("Aviso de error [%s] en %s: %s", codigo or "sin código", pantalla, mensaje[:200])


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


class DerechoYaVigente(Exception):
    """El usuario ya tiene un Pro o un pase vigentes; `clave` es el texto de la API."""

    def __init__(self, clave: str) -> None:
        super().__init__(clave)
        self.clave = clave


def hay_derecho_vigente(db: Session, usuario_id: str, tabla: str, condicion: str = "") -> bool:
    """Si hay algún derecho vigente de cualquier origen. Un derecho sin fin (`hasta` nulo) cuenta:
    por eso se pregunta con `exists` y no con un máximo de fechas, que daría nulo."""
    consulta = (f"select exists (select 1 from liga.{tabla} "
                "where usuario_id = cast(:u as uuid) "
                f"{condicion} and desde <= now() and (hasta is null or hasta > now()))")
    return bool(db.execute(text(consulta), {"u": usuario_id}).scalar())


def fijar_plan_pro(usuario_id: str, hasta: datetime | None, actor: str) -> None:
    db = fabrica_sistema()
    try:
        if hay_derecho_vigente(db, usuario_id, "planes_usuario", "and plan = 'pro'"):
            raise DerechoYaVigente("api_error_admin_pro_ya_activo")
        db.execute(text(
            "insert into liga.planes_usuario (usuario_id, plan, hasta, origen, concedido_por) "
            "values (cast(:u as uuid), 'pro', :h, 'admin', cast(:a as uuid))"),
            {"u": usuario_id, "h": hasta, "a": actor})
        auditar(db, "admin.plan", f"usuario:{usuario_id}",
                {"plan": "pro", "hasta": hasta.isoformat() if hasta else None}, actor)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def quitar_plan_pro(usuario_id: str, actor: str) -> None:
    """Cierra ya el Pro que concedió el admin. El Pro pagado con Lemon no se toca: lo cierra su
    propio evento de cobro, que es quien sabe si la persona sigue pagando."""
    db = fabrica_sistema()
    try:
        db.execute(text(
            "update liga.planes_usuario set hasta = now() "
            "where usuario_id = cast(:u as uuid) and plan = 'pro' and origen = 'admin' "
            "and desde <= now() and (hasta is null or hasta > now())"), {"u": usuario_id})
        auditar(db, "admin.plan", f"usuario:{usuario_id}", {"plan": "gratis"}, actor)
        db.commit()
    finally:
        db.close()


def fijar_pase_liga(usuario_id: str, hasta: datetime | None, actor: str) -> None:
    db = fabrica_sistema()
    try:
        if hay_derecho_vigente(db, usuario_id, "pases_liga"):
            raise DerechoYaVigente("api_error_admin_pase_ya_activo")
        db.execute(text(
            "insert into liga.pases_liga (usuario_id, hasta, origen, concedido_por) "
            "values (cast(:u as uuid), :h, 'admin', cast(:a as uuid))"),
            {"u": usuario_id, "h": hasta, "a": actor})
        auditar(db, "admin.pase", f"usuario:{usuario_id}",
                {"pase": "liga", "hasta": hasta.isoformat() if hasta else None}, actor)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def quitar_pase_liga(usuario_id: str, actor: str) -> None:
    """Como el plan: cierra ya solo el pase que concedió el admin, no el pagado."""
    db = fabrica_sistema()
    try:
        db.execute(text(
            "update liga.pases_liga set hasta = now() "
            "where usuario_id = cast(:u as uuid) and origen = 'admin' "
            "and desde <= now() and (hasta is null or hasta > now())"), {"u": usuario_id})
        auditar(db, "admin.pase", f"usuario:{usuario_id}", {"pase": None}, actor)
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
}
_ETAPAS_ESCANEO = ("prescore", "mid", "deep", "constructor", "macro")
CLAVE_TOPE_MENSUAL = "ia.tope_mensual_usd"
CLAVE_TOPE_FORMACION = "ia.tope_formacion_usd"
CLAVE_MARGEN_OBJETIVO = "ia.margen_objetivo"
_MARGEN_OBJETIVO_DEFECTO = Decimal(3)
_USD_POR_CREDITO = Decimal("0.01")


def _tope_para_panel(valor: object) -> Decimal | None:
    """El panel enseña «sin tope» ante un valor mal guardado; la IA ya queda parada por su lado
    (`ia.comun.razon_no_disponible`) y el motivo sale en el estado de cada finalidad."""
    try:
        return ia_comun.tope_mensual(valor)
    except ValueError:
        return None


def _decimal_o(valor: object, defecto: Decimal) -> Decimal:
    if valor is None or isinstance(valor, bool):
        return defecto
    try:
        return Decimal(str(valor))
    except InvalidOperation:
        return defecto


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
        margen_objetivo = _decimal_o(margen_objetivo, _MARGEN_OBJETIVO_DEFECTO)
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
            "tope_mensual_usd": _tope_para_panel(tope_mensual),
            "margen_objetivo": margen_objetivo,
            "desglose": _desglose_coste(db, mes, siguiente),
        }
    finally:
        db.close()


def _desglose_coste(db: Session, desde: date, hasta: date) -> list[dict]:
    """Dónde va el gasto del mes, solo informativo (no entra en totales ni margen): la pregunta
    propia en pruebas de usuarios frente a la formación de la jornada (que tiene su propio tope)
    y el escaneo mensual por etapa y modelo."""
    filas = []
    for parte, etapa in (("pregunta_pruebas", "liga_pregunta"),
                         ("pregunta_formacion", "liga_formacion")):
        pagado, llamadas = db.execute(text("""
            select coalesce(sum(cost_usd), 0)::numeric, count(*) from llm_call
            where stage = :etapa and at >= :desde and at < :hasta
        """), {"etapa": etapa, "desde": desde, "hasta": hasta}).one()
        filas.append({"parte": parte, "detalle": None, "pagado_usd": Decimal(str(pagado)),
                      "llamadas": llamadas})
    escaneo = db.execute(text("""
        select stage || ' / ' || model, coalesce(sum(cost_usd), 0)::numeric, count(*)
        from llm_call
        where stage = any(:etapas) and at >= :desde and at < :hasta
        group by stage, model order by 2 desc
    """), {"etapas": list(_ETAPAS_ESCANEO), "desde": desde, "hasta": hasta}).all()
    filas += [{"parte": "escaneo", "detalle": detalle, "pagado_usd": Decimal(str(pagado)),
               "llamadas": llamadas} for detalle, pagado, llamadas in escaneo]
    return filas


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
        gastado_formacion = db.execute(text("""
            select coalesce(sum(cost_usd), 0) from llm_call
            where stage = 'liga_formacion' and at >= date_trunc('month', now())
        """)).scalar_one()
        tope_formacion = db.execute(text("select valor from liga.ajustes where clave = :c"),
                                    {"c": CLAVE_TOPE_FORMACION}).scalar()
        finalidades = [
            {"finalidad": f, "funciona": (razon := ia_comun.razon_no_disponible(f, db=db)) is None,
             "razon": razon}
            for f in (*_FINALIDADES_COSTE, "formacion")
        ]
        return {
            "enable_llm": settings.enable_llm,
            "deepseek_key_presente": settings.llm_api_key_present,
            "typesafe_key_presente": bool(settings.typesafe_api_key),
            "gasto_mes_usd": Decimal(str(gastado)),
            "tope_mensual_usd": _tope_para_panel(tope),
            "gasto_formacion_usd": Decimal(str(gastado_formacion)),
            "tope_formacion_usd": _tope_para_panel(tope_formacion),
            "finalidades": finalidades,
        }
    finally:
        db.close()

