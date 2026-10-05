"""Pregunta propia (plan §10 y F6-B): sí/no calibrado, empresa a empresa, con Jev (primitiva
noul). Solo para recetas Pro con `pregunta`. La caché es de todos (`liga.respuestas_ia`, por
pregunta normalizada, ticker y foto): una vez respondida, nadie vuelve a pagar la llamada, pero
SÍ paga el crédito (D16: cacheada o no, cuenta como evaluada).

Se evalúan todas las candidatas que pasan las reglas (el motor ya define ese conjunto:
`motor.seleccion.candidatas_pregunta`), varias a la vez."""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
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
# Jev acepta 1.200 peticiones por minuto (20 por segundo). Medido: a 20 a la vez rinde unas 12 por
# segundo sin un solo error, es decir, todo el universo en unos 4 minutos.
TRABAJADORES = 20
# Compartida por todo el proceso: dos pruebas o una formación a la vez no suman más de 20.
_PUERTA = threading.BoundedSemaphore(TRABAJADORES)


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
    evaluadas: int          # candidatas que entran en el precio
    desde_cache: int
    nuevas: int
    coste_usd: float
    cortada: bool = False   # se agotó la hora límite: quedan candidatas sin contestar


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
                         fabrica: Fabrica | None = None, finalidad: str = "pregunta",
                         hasta: float | None = None, reloj=time.monotonic,  # noqa: ANN001
                         trabajadores: int = TRABAJADORES) -> ResultadoPregunta:
    """Rellena la caché para las `candidatas` que aún no tengan respuesta a esta pregunta y foto;
    el resto sale de caché. `usuario_id` va en la auditoría de cada llamada; `None` cuando lo
    lanza la jornada (a coste del sistema, nunca a petición directa de un usuario), que usa la
    finalidad `formacion` con su interruptor y su tope. `hasta`: hora límite (`reloj`, por
    defecto `time.monotonic`); al llegar, se deja de preguntar y lo ya contestado queda guardado.
    Se pregunta a `trabajadores` a la vez y las que fallan se reintentan una vez.
    `fabrica`: por defecto la del sistema; un proceso con la suya propia la pasa (tests,
    savepoints) -- ver `procesos.formar.rellenar_preguntas`."""
    f = fabrica or fabrica_sistema
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
    # sesión nueva por candidata nueva, con su propio commit). Solo la toca este hilo: los demás
    # solo llaman a Jev.
    db = f()

    def preguntar(ticker: str):  # noqa: ANN202
        with _PUERTA:       # entre todas las peticiones, nunca más de las que Jev admite
            return comun.llamar_ia_jev(
                finalidad=finalidad, modelo=_MODELO, state=estado_empresa(empresas[ticker]),
                pregunta=pregunta, fabrica=fabrica, verificar=False)

    def guardar(ticker: str, resultado, llamada) -> bool:  # noqa: ANN001
        """Apunta la llamada y guarda su respuesta; `False` si Jev no contestó."""
        nonlocal coste_total, nuevas
        coste_total += llamada.coste_usd
        llm_call_id = comun.registrar_llamada(finalidad=finalidad, usuario_id=usuario_id,
                                              llamada=llamada, fabrica=fabrica)
        if resultado is None:
            return False
        p, _confianza = resultado
        si, seguridad = _seguridad(p)
        try:
            # `begin_nested` = savepoint: si esta fila choca (unique concurrente), solo se
            # deshace ELLA, no el resto del lote ya escrito en esta misma sesión compartida.
            with db.begin_nested():
                db.add(RespuestaIA(pregunta_hash=pregunta_hash, ticker=ticker, foto_id=foto_id,
                                   si=si, seguridad=seguridad, llm_call_id=llm_call_id))
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
            return True
        ya[ticker] = Respuesta(si, seguridad)
        nuevas += 1
        return True

    try:
        a_preguntar = [t for t in faltan if t in empresas]
        fallidas, cortada = _a_la_vez(a_preguntar, preguntar, guardar, trabajadores, hasta, reloj)
        if fallidas and not cortada:       # un único reintento de las que no contestaron
            _, cortada = _a_la_vez(fallidas, preguntar, guardar, trabajadores, hasta, reloj)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return ResultadoPregunta(respuestas=ya, evaluadas=len(candidatas), desde_cache=len(candidatas)
                             - nuevas, nuevas=nuevas, coste_usd=coste_total, cortada=cortada)


def _a_la_vez(tickers: list[str], preguntar, guardar, trabajadores: int,  # noqa: ANN001
              hasta: float | None, reloj) -> tuple[list[str], bool]:  # noqa: ANN001
    """Pregunta a Jev hasta `trabajadores` a la vez y entrega cada resultado a `guardar` desde este
    mismo hilo. Devuelve las que no contestaron y si se cortó por la hora límite. Con tanta
    candidata hace falta: una a una, 2.850 empresas serían unos 38 minutos."""
    fallidas: list[str] = []
    cortada = False
    en_vuelo: dict[Future, str] = {}

    def recoger(hechos) -> None:  # noqa: ANN001
        for futuro in hechos:
            ticker = en_vuelo.pop(futuro)
            resultado, llamada = futuro.result()
            if not guardar(ticker, resultado, llamada):
                fallidas.append(ticker)

    with ThreadPoolExecutor(max_workers=trabajadores) as pool:
        for ticker in tickers:
            if hasta is not None and reloj() >= hasta:
                cortada = True
                break
            en_vuelo[pool.submit(preguntar, ticker)] = ticker
            if len(en_vuelo) >= 2 * trabajadores:
                hechos, _ = wait(list(en_vuelo), return_when=FIRST_COMPLETED)
                recoger(hechos)
        hechos, _ = wait(list(en_vuelo))
        recoger(hechos)
    return fallidas, cortada


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
