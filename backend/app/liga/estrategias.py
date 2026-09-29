"""Servicio de estrategias: valida recetas con el motor, mapea errores de la BD a mensajes claros
y hace de puente hacia lo que RLS le veta a `authenticated` (la foto, las notas de Jev y la caché
de la pregunta propia — plan §7.3: «lo lee el sistema y la API sirve solo lo necesario: buscador y
porqués»). Cada lectura o escritura de sistema abre su propia sesión y la cierra, como
`acceso._email_de`: nunca se expone `db_sistema` a una ruta (lo vigila `test_liga_puertas`).
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.errores import codigo_error, mensaje_interno
from app.liga import nombres
from app.liga.models import Receta as RecetaModelo
from app.liga.motor.catalogo import CATALOGO, CATALOGO_VERSION, SECTORES_ES, EmpresaFoto
from app.liga.motor.seleccion import (
    ETIQUETAS_PESO,
    MAX_EXCLUIDAS,
    MAX_POR_SECTOR,
    N_EMPRESAS,
    PASO_PESO,
    PESO_MAXIMO,
    PESOS,
    REPARTOS,
    SIN_NOTAS,
    SIN_RESPUESTA,
    TOPE_PREGUNTA,
    NotasJev,
    Respuesta,
    Seleccion,
    candidatas_pregunta,
    seleccionar,
)
from app.liga.motor.seleccion import Receta as RecetaMotor
from app.liga.motor.seleccion import validar_receta as _validar_receta_motor
from app.liga.procesos import datos as procesos_datos
from app.liga.procesos.comun import ErrorProceso, fabrica_sistema
from app.liga.procesos.foto import _escaneo, _foto  # noqa: PLC2701 — reuso deliberado (plan §7)

logger = logging.getLogger("app.liga")

# --- Errores de la BD a 4xx en castellano --------------------------------------------------------

# Códigos con que los disparadores y funciones propios hacen `raise exception '...'` (sql/liga):
# su mensaje está escrito para la persona.
_SQLSTATE_PROPIOS = {"P0001", "P0002", "23514"}


def mapear_error(e: DBAPIError) -> HTTPException:
    """El texto de un `raise exception '...' using errcode = ...` propio (un trigger del plan
    §7) ya viene en castellano, pensado para el usuario -- se reenvía tal cual. Pero una
    violación NATIVA de `CHECK`/`NOT NULL`/FK que no pasa por ningún trigger con mensaje propio
    trae el texto genérico de Postgres, que nombra tablas y constraints internas
    (`diag.constraint_name` viene relleno en ese caso; en un `raise exception` a mano, no) --
    esa se cambia por un mensaje genérico y el original se queda solo en el log."""
    orig = e.orig
    sqlstate = getattr(orig, "sqlstate", None)
    diag = getattr(orig, "diag", None)
    mensaje = str(getattr(diag, "message_primary", None) or orig)
    if sqlstate == "42501":
        return HTTPException(403, mensaje)
    if sqlstate == "23505":
        return HTTPException(409, mensaje)
    constraint = getattr(diag, "constraint_name", None) if diag is not None else None
    if constraint:
        logger.warning("Error de BD sin mensaje propio (sqlstate=%s, constraint=%s): %s",
                       sqlstate, constraint, mensaje)
        return HTTPException(422, "Esos datos no son válidos.")
    # Un NOT NULL nativo trae la columna; el `raise exception ... errcode '23502'` de un
    # disparador propio, no.
    columna = getattr(diag, "column_name", None) if diag is not None else None
    if sqlstate in _SQLSTATE_PROPIOS or (sqlstate == "23502" and not columna):
        return HTTPException(422, mensaje)
    if sqlstate and sqlstate[:2] in ("22", "23"):    # dato fuera de rango o de formato
        logger.warning("Dato rechazado por la BD (sqlstate=%s): %s", sqlstate, mensaje)
        return HTTPException(422, "Esos datos no son válidos.")
    # Conexión caída, tiempo agotado, sintaxis...: no es algo que la persona pueda corregir ni
    # debe leer (nombra host, rol o tablas). Se registra con un código y se le da una salida.
    codigo = codigo_error()
    logger.error("Error de BD no controlado [%s] (sqlstate=%s): %s", codigo, sqlstate, mensaje)
    return HTTPException(503, mensaje_interno(codigo))


# --- Catálogo para el constructor -----------------------------------------------------------------


def catalogo_payload() -> dict:
    reglas = [
        {
            "clave": r.clave,
            "titulo": r.titulo,
            "parametros": [
                {"nombre": p.nombre, "etiqueta": p.etiqueta, "tipo": p.tipo,
                 "minimo": p.minimo, "maximo": p.maximo, "paso": p.paso, "defecto": p.defecto}
                for p in r.parametros
            ],
        }
        for r in CATALOGO.values()
    ]
    return {
        "version": CATALOGO_VERSION,
        "sectores": dict(SECTORES_ES),
        "reglas": reglas,
        "pesos": {"claves": list(PESOS), "etiquetas": dict(ETIQUETAS_PESO),
                  "maximo": PESO_MAXIMO, "paso": PASO_PESO},
        "n_empresas": list(N_EMPRESAS),
        "repartos": list(REPARTOS),
        "max_por_sector": MAX_POR_SECTOR,
        "max_excluidas": MAX_EXCLUIDAS,
        "tope_pregunta": TOPE_PREGUNTA,
    }


def validar_entrada(idea: str | None, reglas: list[dict], excluidas: list[str],
                    pregunta: str | None, pesos: dict[str, int], n_empresas: int, reparto: str,
                    max_por_sector: int) -> RecetaMotor:
    """La receta de la petición, validada con el motor; `HTTPException(422)` si no vale."""
    tiene_pregunta = bool((pregunta or "").strip())
    if tiene_pregunta and not pesos.get("pregunta"):
        raise HTTPException(422, "Escribiste una pregunta pero no le has dado peso. Súbele el peso "
                                 "o quítala.")
    if pesos.get("pregunta") and not tiene_pregunta:
        raise HTTPException(422, "Le has dado peso a tu pregunta pero no la has escrito. "
                                 "Escríbela o pon su peso a 0.")
    limpias = tuple(sorted({t.strip().upper() for t in excluidas if t.strip()}))
    receta = RecetaMotor(reglas=reglas, excluidas=limpias, pesos=pesos, n_empresas=n_empresas,
                         reparto=reparto, max_por_sector=max_por_sector,
                         catalogo_version=CATALOGO_VERSION)
    errores = _validar_receta_motor(receta)
    if errores:
        raise HTTPException(422, " ".join(errores))
    return receta


def receta_salida(r) -> dict:  # noqa: ANN001 — vale para la fila ORM y para la de SQL crudo
    return {
        "id": r.id, "idea": r.idea, "reglas": list(r.reglas or []),
        "excluidas": list(r.excluidas or []), "catalogo_version": r.catalogo_version,
        "pregunta": r.pregunta,
        "pesos": {"negocio": r.peso_negocio, "precio": r.peso_precio, "deuda": r.peso_deuda,
                  "pronto": r.peso_pronto, "pregunta": r.peso_pregunta},
        "n_empresas": r.n_empresas, "reparto": r.reparto, "max_por_sector": r.max_por_sector,
        "creada": r.creada,
    }


# --- Exclusiones («Quitar»): las recetas no se editan, se versionan -------------------------------


def nueva_version_excluidas(db: Session, estrategia_id: uuid.UUID, ticker: str,
                            quitar: bool) -> RecetaModelo:
    """La receta vigente, igual salvo por un ticker más o menos en `excluidas`. Si el ticker ya
    estaba (o ya no estaba), no hace falta versión nueva: se devuelve la vigente tal cual."""
    fila = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                      {"e": estrategia_id}).one_or_none()
    if fila is None:
        raise HTTPException(404, "No existe esa estrategia.")
    if fila.receta_id is None:
        raise HTTPException(409, "Todavía no has guardado ninguna receta.")
    r = db.get(RecetaModelo, fila.receta_id)
    if r is None:
        raise HTTPException(404, "No existe esa receta.")
    excluidas = set(r.excluidas or [])
    si_esta = ticker in excluidas
    if quitar == (not si_esta):
        return r
    if not quitar and len(excluidas) >= MAX_EXCLUIDAS:
        raise HTTPException(422, f"Puedes quitar a mano hasta {MAX_EXCLUIDAS} empresas.")
    excluidas.discard(ticker) if quitar else excluidas.add(ticker)
    nueva = RecetaModelo(
        estrategia_id=estrategia_id, idea=r.idea, reglas=r.reglas, excluidas=sorted(excluidas),
        catalogo_version=r.catalogo_version, pregunta=r.pregunta, peso_negocio=r.peso_negocio,
        peso_precio=r.peso_precio, peso_deuda=r.peso_deuda, peso_pronto=r.peso_pronto,
        peso_pregunta=r.peso_pregunta, n_empresas=r.n_empresas, reparto=r.reparto,
        max_por_sector=r.max_por_sector)
    db.add(nueva)
    db.flush()
    db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
              {"r": nueva.id, "e": estrategia_id})
    return nueva


# --- Lo que RLS le veta a `authenticated`: foto, notas y caché de la pregunta ---------------------


@dataclass(frozen=True)
class Contexto:
    """La foto y las notas de una jornada, ya en la forma del motor (plan §8)."""

    foto_id: int
    scan_run_id: int
    plan_b: bool
    empresas: tuple[EmpresaFoto, ...]
    notas: dict[str, NotasJev]


def _sin_foto(e: ErrorProceso) -> HTTPException:
    # El texto del proceso es para el admin («lánzala desde Alpha»); el usuario solo ve el estado.
    return HTTPException(e.codigo, "Todavía no hay foto del mes: llega con la próxima jornada.")


# Caché en memoria de proceso de lo pesado de una foto (universo + notas: ~14 500 filas +
# ~41 000 de notas en el volumen real, plan §6): una foto completa NUNCA cambia una vez
# publicada, así que basta con un LRU minúsculo -- hoy solo hay una foto "actual" a la vez, pero
# `foto_y_notas_de` recalcula pruebas pasadas de fotos anteriores (hallazgo de rendimiento:
# `probar`/`coste_prueba`/`por_que` repetían este escaneo entero en cada petición de cada
# usuario, sin ninguna caché).
_CACHE_CTX_MAX = 2
_cache_ctx_lock = threading.Lock()
_cache_ctx: OrderedDict[
    tuple[int, int], tuple[tuple[EmpresaFoto, ...], dict[str, NotasJev]]] = OrderedDict()


def _empresas_y_notas(db: Session, foto_id: int,
                      scan_run_id: int) -> tuple[tuple[EmpresaFoto, ...], dict[str, NotasJev]]:
    clave = (foto_id, scan_run_id)
    with _cache_ctx_lock:
        en_cache = _cache_ctx.get(clave)
        if en_cache is not None:
            _cache_ctx.move_to_end(clave)
            return en_cache
    empresas = tuple(procesos_datos.cargar_empresas(db, foto_id))
    notas = procesos_datos.cargar_notas(db, scan_run_id)
    with _cache_ctx_lock:
        _cache_ctx[clave] = (empresas, notas)
        _cache_ctx.move_to_end(clave)
        while len(_cache_ctx) > _CACHE_CTX_MAX:
            _cache_ctx.popitem(last=False)
    return empresas, notas


def _contexto_desde(db: Session, foto_id: int | None) -> Contexto:
    try:
        foto = _foto(db, foto_id)
        scan_run_id, avisos = _escaneo(db, foto, None)
    except ErrorProceso as e:
        raise _sin_foto(e) from e
    empresas, notas = _empresas_y_notas(db, foto.id, scan_run_id)
    return Contexto(foto.id, scan_run_id, bool(avisos), empresas, notas)


def foto_y_notas_actuales() -> Contexto:
    """La última foto completa y las notas de su escaneo de decisión (o el plan B, plan §8)."""
    db = fabrica_sistema()
    try:
        return _contexto_desde(db, None)
    finally:
        db.close()


def foto_y_notas_de(foto_id: int) -> Contexto:
    """Para recomputar una prueba pasada: la misma foto, con el mejor escaneo de hoy para ella."""
    db = fabrica_sistema()
    try:
        return _contexto_desde(db, foto_id)
    finally:
        db.close()


def respuestas_sistema(pregunta: str | None, foto_id: int) -> dict[str, Respuesta]:
    """Solo de la caché (`liga.respuestas_ia`, vetada a `authenticated`): aquí no se llama a IA."""
    if not pregunta:
        return {}
    db = fabrica_sistema()
    try:
        return procesos_datos.cargar_respuestas(db, pregunta, foto_id)
    finally:
        db.close()


def candidatas_pregunta_de(ctx: Contexto, receta: RecetaModelo) -> list[str]:
    """Las hasta `TOPE_PREGUNTA` candidatas a las que se pregunta de verdad (F6-B): el motor ya
    define ese conjunto, solo hace falta traducir la receta guardada a la del motor."""
    return candidatas_pregunta(list(ctx.empresas), procesos_datos.receta_motor(receta), ctx.notas)


def buscar_universo(q: str, limite: int = 20) -> list[dict]:
    """Ticker, nombre y sector de la última foto completa: nunca el resto de las métricas."""
    termino = q.strip()
    if not termino:
        return []
    db = fabrica_sistema()
    try:
        try:
            foto = _foto(db, None)
        except ErrorProceso as e:
            raise _sin_foto(e) from e
        filas = db.execute(text("""
            select ticker, name, sector from (
                select distinct on (s.ticker) s.ticker, s.name, s.sector
                from fundamentals_snapshot s
                where s.foto_id = :f and (s.ticker ilike :q or s.name ilike :q)
                order by s.ticker, s.id desc
            ) u
            order by u.ticker
            limit :lim
        """), {"f": foto.id, "q": f"%{termino}%", "lim": limite}).all()
        return [{"ticker": f.ticker, "nombre": f.name, "sector": f.sector} for f in filas]
    finally:
        db.close()


# --- Escrituras que la BD reserva al sistema (plan §7.2 y §11) ------------------------------------


def crear_prueba_sistema(usuario_id: str, receta_id: int, foto_id: int,
                         n_evaluadas: int) -> uuid.UUID:
    """`liga.pruebas` no tiene INSERT para `authenticated`: lo escribe el backend como sistema."""
    db = fabrica_sistema()
    try:
        fila = db.execute(text("""
            insert into liga.pruebas (usuario_id, receta_id, foto_id, estado, n_evaluadas,
                                      idempotencia)
            values (:u, :r, :f, 'hecha', :n, :idem)
            returning id
        """), {"u": usuario_id, "r": receta_id, "f": foto_id, "n": n_evaluadas,
               "idem": uuid.uuid4().hex}).one()
        db.commit()
        return fila.id
    finally:
        db.close()


def resultado_prueba(prueba_id: uuid.UUID, ctx: Contexto, seleccion: Seleccion, receta) -> dict:  # noqa: ANN001
    """La cartera que saldría hoy, con el porqué de cada elegida y los recuentos de la maqueta."""
    elegidas = [
        {"ticker": el.ticker, "nombre": el.fila.empresa.nombre, "sector": el.fila.empresa.sector,
         "peso": el.peso, "porque": el.porque}
        for el in seleccion.elegidas
    ]
    sin_notas = sum(1 for f in seleccion.filas if f.fallo == SIN_NOTAS)
    sin_respuesta = sum(1 for f in seleccion.filas if f.fallo == SIN_RESPUESTA)
    return {
        "id": str(prueba_id), "foto_id": ctx.foto_id, "scan_run_id": ctx.scan_run_id,
        "plan_b": ctx.plan_b, "catalogo_version": receta.catalogo_version,
        "evaluadas": len(seleccion.filas), "pasan": len(seleccion.pasan),
        "elegidas": elegidas, "saltadas_por_sector": len(seleccion.saltadas_por_sector),
        "sin_peso": len(seleccion.sin_peso), "sin_notas": sin_notas,
        "sin_respuesta": sin_respuesta, "caja_pct": seleccion.caja_pct,
    }


# --- «Leer a fondo» / «Leer mi cartera» (F6-B): qué puede leer cada usuario -----------------------


def contexto_lectura(usuario_id: str, ticker: str) -> tuple[int, int] | None:
    """(foto_id, scan_run_id) desde donde se puede leer esta empresa para este usuario: sus
    posiciones actuales, o si no, las elegidas de su última prueba (cualquiera de sus
    estrategias). `None` si no puede leerla — el ticker no es suyo en ningún sentido."""
    db = fabrica_sistema()
    try:
        fila = db.execute(text("""
            select j.foto_id, j.scan_run_id from liga.posiciones p
            join liga.inscripciones i on i.id = p.inscripcion_id
            join liga.estrategias e on e.id = i.estrategia_id
            join liga.jornadas j on j.id = i.jornada_id
            where e.dueno_id = cast(:u as uuid) and p.ticker = :t
            order by j.numero desc limit 1
        """), {"u": usuario_id, "t": ticker}).one_or_none()
        if fila is not None:
            return fila.foto_id, fila.scan_run_id
        prueba = db.execute(text("""
            select receta_id, foto_id from liga.pruebas where usuario_id = cast(:u as uuid)
            order by creada desc limit 1
        """), {"u": usuario_id}).one_or_none()
        if prueba is None:
            return None
        receta = db.get(RecetaModelo, prueba.receta_id)
        if receta is None:
            return None
        ctx = _contexto_desde(db, prueba.foto_id)
        respuestas = procesos_datos.cargar_respuestas(db, receta.pregunta, ctx.foto_id)
    finally:
        db.close()
    seleccion = seleccionar(list(ctx.empresas), procesos_datos.receta_motor(receta), ctx.notas,
                            respuestas)
    if any(el.ticker == ticker for el in seleccion.elegidas):
        return ctx.foto_id, ctx.scan_run_id
    return None


def cartera_estrategia(estrategia_id: uuid.UUID) -> tuple[int, int, list[str]] | None:
    """(foto_id, scan_run_id, tickers) de la última prueba de ESTA estrategia (para «Leer mi
    cartera», que es del dueño de una receta concreta). `None` sin receta o sin prueba todavía."""
    db = fabrica_sistema()
    try:
        fila = db.execute(text(
            "select receta_id from liga.estrategias where id = :e"), {"e": estrategia_id}
        ).one_or_none()
        if fila is None or fila.receta_id is None:
            return None
        receta = db.get(RecetaModelo, fila.receta_id)
        if receta is None:
            return None
        ctx = _contexto_desde(db, None)
        respuestas = procesos_datos.cargar_respuestas(db, receta.pregunta, ctx.foto_id)
    finally:
        db.close()
    seleccion = seleccionar(list(ctx.empresas), procesos_datos.receta_motor(receta), ctx.notas,
                            respuestas)
    return ctx.foto_id, ctx.scan_run_id, [el.ticker for el in seleccion.elegidas]


# --- Copiar una estrategia (Pro; plan §11 y §2.1: «copiar» es de Pro) -----------------------------

_LARGO_NOMBRE = 28
_SUFIJO_COPIA = " (copia)"


def nombre_copia(nombre: str) -> str:
    """El nombre de origen con el sufijo, recortado al límite de la maqueta."""
    base = nombre[: _LARGO_NOMBRE - len(_SUFIJO_COPIA)].rstrip()
    return (base + _SUFIJO_COPIA)[:_LARGO_NOMBRE]


def copiar_estrategia(db: Session, origen_id: uuid.UUID) -> RecetaModelo:
    """Estrategia y receta nuevas a nombre del que llama, a partir de una que puede ver (RLS
    decide: la suya o una publicada visible si es Pro). Las de la casa no se copian nunca, y sin
    receta visible no hay qué copiar."""
    if not db.execute(text("select liga.es_pro()")).scalar_one():
        raise HTTPException(403, "Copiar una estrategia es de Pro.")
    origen = db.execute(text("""
        select tipo, nombre, forma, dibujo, color1, color2, iniciales, receta_id
        from liga.estrategias where id = :i
    """), {"i": origen_id}).one_or_none()
    if origen is None:
        raise HTTPException(404, "No existe esa estrategia.")
    if origen.tipo == "casa":
        raise HTTPException(403, "Las estrategias de la casa no se copian.")
    if origen.receta_id is None:
        raise HTTPException(409, "Esa estrategia todavía no tiene ninguna receta.")
    receta = db.get(RecetaModelo, origen.receta_id)
    if receta is None:
        raise HTTPException(404, "No puedes ver la receta de esa estrategia.")
    nueva_estrategia = db.execute(text("""
        insert into liga.estrategias (nombre, forma, dibujo, color1, color2, iniciales)
        values (:nombre, :forma, :dibujo, :color1, :color2, :iniciales)
        returning id
    """), {"nombre": nombres.validar_nombre(nombre_copia(origen.nombre)), "forma": origen.forma,
           "dibujo": origen.dibujo,
           "color1": origen.color1, "color2": origen.color2,
           "iniciales": origen.iniciales}).one()
    nueva_receta = RecetaModelo(
        estrategia_id=nueva_estrategia.id, idea=receta.idea, reglas=receta.reglas,
        excluidas=list(receta.excluidas or []), catalogo_version=receta.catalogo_version,
        pregunta=receta.pregunta, peso_negocio=receta.peso_negocio,
        peso_precio=receta.peso_precio, peso_deuda=receta.peso_deuda,
        peso_pronto=receta.peso_pronto, peso_pregunta=receta.peso_pregunta,
        n_empresas=receta.n_empresas, reparto=receta.reparto,
        max_por_sector=receta.max_por_sector)
    db.add(nueva_receta)
    db.flush()
    db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
              {"r": nueva_receta.id, "e": nueva_estrategia.id})
    db.refresh(nueva_receta)
    return nueva_receta
