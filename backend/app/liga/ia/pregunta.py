"""Pregunta propia (plan §10 y F6-B): sí/no calibrado, empresa a empresa, con Jev (primitiva
noul). Solo para recetas Pro con `pregunta`. La caché es de todos (`liga.respuestas_ia`, por
pregunta normalizada, ticker y foto): una vez respondida, nadie vuelve a pagar la llamada, pero
SÍ paga el crédito (D16: cacheada o no, cuenta como evaluada).

Solo se evalúan las `TOPE_PREGUNTA` mejores candidatas por las otras 4 notas (el motor ya define
ese conjunto: `motor.seleccion.candidatas_pregunta`) — nunca el universo entero."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.liga.ia import comun, precios
from app.liga.models import RespuestaIA
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import Respuesta
from app.liga.procesos import datos as procesos_datos
from app.liga.procesos.comun import Fabrica, fabrica_sistema

logger = logging.getLogger("app.liga.ia")

_MODELO = "jev-latest"


def _seguridad(p: float) -> tuple[bool, str]:
    """Umbrales del plan F6-B, simétricos: sí (>=0,85 alta / >=0,65 media / >=0,5 baja) y su
    espejo para el no."""
    if p >= 0.85:
        return True, "alta"
    if p >= 0.65:
        return True, "media"
    if p >= 0.5:
        return True, "baja"
    if p >= 0.35:
        return False, "baja"
    if p >= 0.15:
        return False, "media"
    return False, "alta"


def estado_empresa(empresa: EmpresaFoto) -> str:
    """El estado que ve Jev: solo campos que ya trae la foto, sin llamar a ninguna fuente nueva
    (F6-B) — mismo tipo de bloque que el prescore, pero sin noticias ni técnico, que la foto no
    guarda."""
    partes = [f"{empresa.ticker} ({empresa.nombre or 's/n'}) — {empresa.sector or 's/d'}/"
             f"{empresa.industria or 's/d'}"]
    campos = (
        ("Precio", empresa.precio, ""), ("Máximo 52 semanas", empresa.max_52s, ""),
        ("PER (TTM)", empresa.per, ""), ("Capitalización (USD)", empresa.market_cap_usd, ""),
        ("Rentabilidad por dividendo", empresa.dividend_yield_pct, "%"),
        ("Crecimiento de ventas", empresa.crecimiento_ventas, " (tanto por uno)"),
        ("Margen operativo", empresa.margen_operativo, " (tanto por uno)"),
        ("ROE", empresa.roe, " (tanto por uno)"), ("Deuda total (USD)", empresa.deuda_total, ""),
        ("Caja total (USD)", empresa.caja_total, ""), ("EBITDA (USD)", empresa.ebitda, ""),
    )
    for etiqueta, valor, sufijo in campos:
        if valor is not None:
            partes.append(f"{etiqueta}: {valor}{sufijo}")
    return "\n".join(partes)


@dataclass(frozen=True)
class ResultadoPregunta:
    respuestas: dict[str, Respuesta]
    evaluadas: int          # candidatas (top TOPE_PREGUNTA) que entran en el precio
    desde_cache: int
    nuevas: int
    coste_usd: float


def _cache(db: Session, pregunta_hash: str, foto_id: int,
          tickers: list[str]) -> dict[str, Respuesta]:
    if not tickers:
        return {}
    filas = db.execute(text("""
        select ticker, si, seguridad from liga.respuestas_ia
        where pregunta_hash = :h and foto_id = :f and ticker = any(:t)
    """), {"h": pregunta_hash, "f": foto_id, "t": tickers}).all()
    return {f.ticker: Respuesta(f.si, f.seguridad) for f in filas}


def responder_pendientes(*, pregunta: str, foto_id: int, empresas: dict[str, EmpresaFoto],
                         candidatas: list[str], usuario_id: str | None = None,
                         fabrica: Fabrica | None = None) -> ResultadoPregunta:
    """Rellena la caché para las `candidatas` que aún no tengan respuesta a esta pregunta y foto;
    el resto sale de caché. `usuario_id` va en la auditoría de cada llamada; `None` cuando lo
    lanza la jornada (día 1, a coste del sistema, nunca a petición directa de un usuario).
    `fabrica`: por defecto la del sistema; un proceso con la suya propia la pasa (tests,
    savepoints) -- ver `procesos.formar.rellenar_preguntas`."""
    f = fabrica or fabrica_sistema
    finalidad = "pregunta"
    pregunta_hash = procesos_datos.hash_pregunta(pregunta)
    db = f()
    try:
        ya = _cache(db, pregunta_hash, foto_id, candidatas)
    finally:
        db.close()
    faltan = [t for t in candidatas if t not in ya]
    coste_total = 0.0
    nuevas = 0
    if not faltan:
        return ResultadoPregunta(respuestas=ya, evaluadas=len(candidatas),
                                 desde_cache=len(candidatas), nuevas=0, coste_usd=0.0)
    # Una sola comprobación del interruptor/tope para todo el lote (hasta 300 candidatas), no una
    # por candidata (hallazgo de rendimiento: cada una abría 2-3 consultas más de las que hacen
    # falta). Si no está disponible, `HTTPException(503)` sube tal cual -- el llamador decide.
    comun.verificar_disponible(finalidad, fabrica)
    # Una única sesión de sistema para los `INSERT` de `respuestas_ia` de todo el lote (antes: una
    # sesión nueva por candidata nueva, con su propio commit).
    db = f()
    try:
        for ticker in faltan:
            empresa = empresas.get(ticker)
            if empresa is None:
                continue
            resultado, llamada = comun.llamar_ia_jev(
                finalidad=finalidad, modelo=_MODELO, state=estado_empresa(empresa),
                pregunta=pregunta, fabrica=fabrica, verificar=False)
            coste_total += llamada.coste_usd
            if resultado is None:
                comun.registrar_llamada(finalidad=finalidad, usuario_id=usuario_id,
                                        llamada=llamada, fabrica=fabrica)
                continue
            p, _confianza = resultado
            si, seguridad = _seguridad(p)
            llm_call_id = comun.registrar_llamada(finalidad=finalidad, usuario_id=usuario_id,
                                                  llamada=llamada, fabrica=fabrica)
            try:
                # `begin_nested` = savepoint: si esta fila choca (unique concurrente), solo se
                # deshace ELLA, no el resto del lote ya escrito en esta misma sesión compartida.
                with db.begin_nested():
                    db.add(RespuestaIA(pregunta_hash=pregunta_hash, ticker=ticker,
                                       foto_id=foto_id, si=si, seguridad=seguridad,
                                       llm_call_id=llm_call_id))
                    db.flush()
            except Exception:
                # Ya la escribió otra petición concurrente con la misma pregunta/ticker/foto
                # (unique): no es un fallo, se relee de la caché.
                fila = db.execute(text("""
                    select si, seguridad from liga.respuestas_ia
                    where pregunta_hash = :h and ticker = :t and foto_id = :f
                """), {"h": pregunta_hash, "t": ticker, "f": foto_id}).one_or_none()
                if fila is not None:
                    ya[ticker] = Respuesta(fila.si, fila.seguridad)
                continue
            ya[ticker] = Respuesta(si, seguridad)
            nuevas += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return ResultadoPregunta(respuestas=ya, evaluadas=len(candidatas), desde_cache=len(candidatas)
                             - nuevas, nuevas=nuevas, coste_usd=coste_total)


def coste_pendiente(*, pregunta: str, foto_id: int, candidatas: list[str],
                    fabrica: Fabrica | None = None) -> dict:
    """Cuántas respuestas faltan en caché y el precio en créditos (D16: TODAS las evaluadas
    cuentan, cacheadas incluidas)."""
    db = (fabrica or fabrica_sistema)()
    try:
        ya = _cache(db, procesos_datos.hash_pregunta(pregunta), foto_id, candidatas)
    finally:
        db.close()
    faltan = len(candidatas) - len(ya)
    return {"evaluadas": len(candidatas), "en_cache": len(ya), "faltan": faltan,
           "creditos": precios.precio_pregunta(len(candidatas))}
