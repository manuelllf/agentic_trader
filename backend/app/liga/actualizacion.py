"""Actualización semanal voluntaria; sus cachés nunca alimentan la foto del mes."""

from __future__ import annotations

import ctypes
import gc
import logging
import threading
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import text

from app import scan_service
from app.agents import scorer as scorer_mod
from app.config import settings
from app.i18n import translate
from app.liga import estrategias
from app.liga.auth import Identidad
from app.liga.db import sesion_como
from app.liga.ia import comun, precios
from app.liga.ia import pregunta as ia_pregunta
from app.liga.motor.seleccion import NotasJev, Respuesta, seleccionar, sin_pregunta
from app.liga.procesos.comun import TZ_BOLSA, fabrica_sistema
from app.liga.procesos.datos import hash_pregunta
from app.scan_audit import _columnas_jev
from app.screener import fundamentals as fund_mod
from app.screener import macro as macro_mod

logger = logging.getLogger(__name__)
_CACHE = threading.Lock()
_DIMENSIONES = ("fundamentals", "valuation", "financing", "catalyst")


class ErrorActualizacion(RuntimeError):
    """Motivo interno sin incluir la respuesta del proveedor ni la receta del usuario."""


def hoy():
    return datetime.now(TZ_BOLSA).date()


def puede_actualizar(db, usuario_id) -> bool:
    return db.execute(text("""
        select not exists (
            select 1 from liga.actualizaciones where usuario_id = :u
            and estado in ('en_curso', 'hecha')
            and creado_en > now() - interval '7 days')
    """), {"u": usuario_id}).scalar_one()


def ultima(db, usuario_id) -> dict | None:
    fila = db.execute(text("""
        select id, estado, hechas, total, creado_en as creada,
            case when estado in ('en_curso', 'hecha')
                 then creado_en + interval '7 days' else now() end as puede_repetir_el
        from liga.actualizaciones where usuario_id = :u
        order by creado_en desc, id desc limit 1
    """), {"u": usuario_id}).mappings().one_or_none()
    return dict(fila) if fila else None


def _candidatas(body):
    receta = estrategias.validar_entrada(
        body.idea, [r.model_dump() for r in body.reglas], body.excluidas, body.pregunta,
        body.pesos, body.n_empresas, body.reparto, body.max_por_sector,
    )
    contexto = estrategias.contexto_de_referencia()
    # Primero se ordena por las notas disponibles: la pregunta se responde después.
    resultado = seleccionar(list(contexto.empresas), sin_pregunta(receta), contexto.notas)
    return contexto, [f.ticker for f in resultado.pasan[:300]]


def iniciar(usuario_id, receta) -> int:
    receta = receta.model_copy(update={"pregunta": (receta.pregunta or "").strip() or None})
    ident = Identidad(uid=usuario_id, aal="aal1",
                      claims={"sub": usuario_id, "role": "authenticated"})
    with sesion_como(ident) as db:
        db.execute(text("select pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                   {"k": f"liga.actualizar:{usuario_id}"})
        if not puede_actualizar(db, usuario_id):
            fecha = db.execute(text("""
                select max(creado_en) + interval '7 days' from liga.actualizaciones
                where usuario_id = :u and estado in ('en_curso', 'hecha')
                  and creado_en > now() - interval '7 days'
            """), {"u": usuario_id}).scalar_one()
            raise HTTPException(409, {"mensaje": translate("liga_actualizacion_semanal"),
                                      "puede_repetir_el": fecha.isoformat()})
        _, candidatas = _candidatas(receta)
        if not candidatas:
            raise HTTPException(409, translate("liga_actualizacion_sin_candidatas"))
        actualizacion_id = db.execute(text("""
            insert into liga.actualizaciones (usuario_id, estado, total, pregunta_hash)
            values (:u, 'en_curso', :n, :h) returning id
        """), {"u": usuario_id, "n": len(candidatas),
               "h": hash_pregunta(receta.pregunta) if receta.pregunta else None}).scalar_one()
    # La transacción de usuario debe estar confirmada antes de arrancar el hilo.
    try:
        threading.Thread(target=_trabajo, args=(actualizacion_id, receta, usuario_id),
                         daemon=True).start()
    except Exception as exc:
        db = fabrica_sistema()
        try:
            _estado(db, actualizacion_id, "fallida")
        finally:
            db.close()
        logger.error("No se pudo lanzar actualización: %s", type(exc).__name__)
        raise
    return actualizacion_id


def _estado(db, actualizacion_id, estado):
    db.execute(text("update liga.actualizaciones set estado = :e where id = :i"),
               {"e": estado, "i": actualizacion_id})
    db.commit()


def frescas(notas, respuestas, pregunta, dia=None):
    db = fabrica_sistema()
    try:
        dia = dia or hoy()
        nuevas = dict(notas)
        for f in db.execute(text("select * from liga.notas_frescas where dia = :d"),
                            {"d": dia}).all():
            nuevas[f.ticker] = NotasJev.desde_bd(
                f.jev_fundamentals, f.jev_valuation, f.jev_financing, f.jev_catalyst)
        contestadas = dict(respuestas)
        if pregunta:
            for f in db.execute(text("""
                select ticker, si, seguridad from liga.respuestas_frescas
                where dia = :d and pregunta_hash = :h
            """), {"d": dia, "h": hash_pregunta(pregunta)}).all():
                contestadas[f.ticker] = Respuesta(f.si, f.seguridad)
        return nuevas, contestadas
    finally:
        db.close()


def _responder(actualizacion_id, body, contexto, candidatas, usuario_id, dia):
    if not body.pregunta:
        return
    importe = precios.precio_pregunta(len(candidatas))
    clave = comun.clave_cobro("pregunta", str(actualizacion_id), hash_pregunta(body.pregunta), dia)
    comun.reservar_creditos(usuario_id, importe, f"reserva:{clave}")
    liquidada = False
    try:
        resultado = ia_pregunta.responder_pendientes(
            pregunta=body.pregunta, foto_id=contexto.foto_id, dia=dia,
            empresas={e.ticker: e for e in contexto.empresas}, candidatas=candidatas,
            usuario_id=usuario_id)
        entregadas = len(resultado.respuestas)
        if entregadas:
            comun.liquidar_creditos(usuario_id, importe, precios.precio_pregunta(entregadas),
                                    "prueba", clave)
        else:
            comun.devolver_reserva(usuario_id, importe, clave)
        liquidada = True
        if entregadas != len(candidatas):
            raise ErrorActualizacion("respuestas_incompletas")
    except Exception:
        if not liquidada:
            comun.devolver_reserva(usuario_id, importe, clave)
        raise


def _ejecutar(db, actualizacion_id, body, usuario_id):
    contexto, candidatas = _candidatas(body)
    if not candidatas:
        raise ErrorActualizacion("sin_candidatas")
    dia = hoy()
    db.execute(text("update liga.actualizaciones set total = :n where id = :i"),
               {"n": len(candidatas), "i": actualizacion_id})
    db.commit()
    cfg = scan_service._stage_cfg(None, "prescore", settings.prescore_model,
                                  settings.prescore_reasoning_effort,
                                  settings.prescore_temperature)
    prescore_llm = None
    bloque = None
    for hechas, ticker in enumerate(candidatas, 1):
        cache = db.execute(text("""
            select 1 from liga.notas_frescas where ticker = :t and dia = :d
        """), {"t": ticker, "d": dia}).first()
        if cache is None:
            if prescore_llm is None:
                prescore_llm = scan_service._prescore_llm(cfg, False)
                macro = macro_mod.get_macro(db)
                bloque, _ = scan_service.bloque_macro_prescore(db, macro, prescore_llm)
                del macro
            datos, _error = fund_mod.gather(ticker, db=None, ttl_h=0)
            if datos is None:
                logger.info("Sin datos para %s: se queda la nota del escaneo.", ticker)
            else:
                resultado = scorer_mod.prescore_one(
                    prescore_llm, datos, bloque, **scan_service._sampling_kwargs(cfg))
                if resultado.error:
                    raise ErrorActualizacion("prescore_proveedor")
                columnas = _columnas_jev(resultado.dimensiones)
                if any(columnas.get(f"jev_{k}") is None for k in _DIMENSIONES):
                    raise ErrorActualizacion("prescore_sin_dimensiones")
                db.execute(text("""
                    insert into liga.notas_frescas
                        (ticker, dia, jev_fundamentals, jev_valuation, jev_financing, jev_catalyst)
                    values (:t, :d, :jev_fundamentals, :jev_valuation, :jev_financing,
                            :jev_catalyst)
                    on conflict do nothing
                """), {"t": ticker, "d": dia,
                       **{f"jev_{k}": columnas[f"jev_{k}"] for k in _DIMENSIONES}})
                del datos, resultado, columnas
        db.execute(text("update liga.actualizaciones set hechas = :n where id = :i"),
                   {"n": hechas, "i": actualizacion_id})
        db.commit()
    _responder(actualizacion_id, body, contexto, candidatas, usuario_id, dia)
    _estado(db, actualizacion_id, "hecha")


def _liberar_memoria():
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


def _trabajo(actualizacion_id, receta, usuario_id):
    db = None
    cerrojo = None
    try:
        # El candado separado sobrevive a los commits y evita duplicar proveedores entre réplicas.
        with _CACHE:
            cerrojo = fabrica_sistema()
            cerrojo.execute(text("select pg_advisory_xact_lock(hashtextextended(:k, 0))"),
                            {"k": "liga.cache_fresca"})
            db = fabrica_sistema()
            _ejecutar(db, actualizacion_id, receta, usuario_id)
    except Exception as exc:
        if db is None:
            db = fabrica_sistema()
        db.rollback()
        _estado(db, actualizacion_id, "fallida")
        motivo = str(exc) if isinstance(exc, ErrorActualizacion) else type(exc).__name__
        logger.error("Actualización fallida: %s", motivo)
    finally:
        try:
            if db is not None:
                for tabla in ("notas_frescas", "respuestas_frescas"):
                    db.execute(text(f"delete from liga.{tabla} where dia < :d - 8"), {"d": hoy()})
                db.commit()
        except Exception as exc:
            if db is not None:
                db.rollback()
            logger.error("Limpieza de actualización fallida: %s", type(exc).__name__)
        finally:
            if db is not None:
                db.close()
            if cerrojo is not None:
                cerrojo.close()
            _liberar_memoria()
