"""«Leer a fondo» y «Leer mi cartera» (plan §10 y F6-B): el informe profundo de una empresa,
solo de las que el motor ya eligió. Orden de barato a caro:

  (a) `liga.lecturas` ya la tiene para (ticker, foto) -> se sirve tal cual, sin llamar a nada;
  (b) el escaneo de decisión de esa foto ya analizó la empresa a fondo (Alpha) -> se copia su
      informe, sin llamar a ninguna IA (`public.scan_run_finalist.report`);
  (c) si no, una llamada nueva (DeepSeek Flash), reutilizando `agents.scorer.score` — el mismo
      informe que genera Alpha, para UNA empresa.

Se cobra siempre 5 créditos (D16) salvo que el usuario ya la haya comprado (un movimiento con su
`lectura_id`); comprar de nuevo la misma nunca cobra dos veces (idempotente)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.liga.ia import comun, precios
from app.liga.models import Lectura
from app.liga.procesos.comun import fabrica_sistema

logger = logging.getLogger("app.liga.ia")

_MODELO = "deepseek-flash"
_LARGO_TEXTO = 20000


@dataclass(frozen=True)
class LecturaResultado:
    id: int
    ticker: str
    foto_id: int
    texto: str
    fuentes: list
    de_cache: bool  # ya existía en `liga.lecturas`: no ha hecho falta llamar a nada


def _de_cache(db: Session, ticker: str, foto_id: int) -> Lectura | None:
    return db.execute(text(
        "select id, ticker, foto_id, texto, fuentes from liga.lecturas "
        "where ticker = :t and foto_id = :f"), {"t": ticker, "f": foto_id}).one_or_none()


def _desde_finalista(db: Session, ticker: str, foto_id: int, scan_run_id: int) -> Lectura | None:
    """Alpha ya la analizó a fondo en el escaneo de esta jornada: se copia su informe, sin
    llamar a ninguna IA. `llm_call_id`: el de la llamada original si se encuentra (mismo
    `scan_run_id`/ticker/etapa `deep`); si no, `None` -- ya se pagó y se contó en su día, esto
    solo es la copia."""
    fila = db.execute(text("""
        select report from scan_run_finalist
        where scan_run_id = :s and ticker = :t and report is not null and report <> ''
    """), {"s": scan_run_id, "t": ticker}).one_or_none()
    if fila is None:
        return None
    llm_call_id = db.execute(text("""
        select id from llm_call where scan_run_id = :s and ticker = :t and stage = 'deep'
        order by at desc limit 1
    """), {"s": scan_run_id, "t": ticker}).scalar()
    lectura = Lectura(ticker=ticker, foto_id=foto_id, texto=fila.report[:_LARGO_TEXTO],
                      fuentes=[], llm_call_id=llm_call_id)
    db.add(lectura)
    db.flush()
    return lectura


def _nueva_llamada(db: Session, ticker: str, foto_id: int,
                   usuario_id: str | None) -> Lectura | None:
    """Sin nada reutilizable: una llamada nueva, con el mismo pipeline de informe profundo que
    Alpha (`agents.scorer.score`), para esta única empresa. `None` si el LLM no responde o la
    empresa no se puede analizar (sin datos)."""
    from app.agents import scorer as scorer_mod
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod

    data, error = fund_mod.gather(ticker, db=db)
    if data is None:
        logger.warning("Lectura de %s: no se pudo reunir sus datos (%s)", ticker, error)
        return None
    macro_block = macro_mod.bloque_macro(macro_mod.get_macro(db))

    contenido, llamada = comun.llamar_ia(
        finalidad="lectura", usuario_id=usuario_id, modelo=_MODELO,
        system=scorer_mod.SYSTEM, user=scorer_mod._user_prompt(data, macro_block, None),  # noqa: SLF001
        temperature=1.0, timeout=180)
    llm_call_id = comun.registrar_llamada(finalidad="lectura", usuario_id=usuario_id,
                                          llamada=llamada)
    if contenido is None:
        return None
    try:
        obj = json.loads(contenido[contenido.find("{"): contenido.rfind("}") + 1])
        texto = str(obj.get("report") or "").strip()
    except (json.JSONDecodeError, AttributeError):
        texto = ""
    if not texto:
        return None
    lectura = Lectura(ticker=ticker, foto_id=foto_id, texto=texto[:_LARGO_TEXTO], fuentes=[],
                      llm_call_id=llm_call_id)
    db.add(lectura)
    db.flush()
    return lectura


def obtener_o_crear(ticker: str, foto_id: int, scan_run_id: int,
                    usuario_id: str | None = None) -> LecturaResultado | None:
    """La lectura de una empresa para esta foto, por el camino más barato que haya. `None` si no
    hay informe reutilizable y la llamada nueva falla."""
    db = fabrica_sistema()
    try:
        fila = _de_cache(db, ticker, foto_id)
        if fila is not None:
            return LecturaResultado(fila.id, fila.ticker, fila.foto_id, fila.texto,
                                    list(fila.fuentes or []), de_cache=True)
        lectura = _desde_finalista(db, ticker, foto_id, scan_run_id)
        if lectura is None:
            lectura = _nueva_llamada(db, ticker, foto_id, usuario_id)
        if lectura is None:
            db.rollback()
            return None
        db.commit()
        return LecturaResultado(lectura.id, lectura.ticker, lectura.foto_id, lectura.texto,
                                list(lectura.fuentes or []), de_cache=False)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ya_comprada(usuario_id: str, lectura_id: int) -> bool:
    db = fabrica_sistema()
    try:
        return db.execute(text(
            "select 1 from liga.creditos_movimientos where usuario_id = :u and lectura_id = :l"),
            {"u": usuario_id, "l": lectura_id}).one_or_none() is not None
    finally:
        db.close()


def exigir_saldo_para(usuario_id: str, ticker: str, foto_id: int) -> None:
    """Si esa lectura ya es suya no se cobra; si no, sin saldo no se genera (ni se paga)."""
    db = fabrica_sistema()
    try:
        fila = _de_cache(db, ticker, foto_id)
    finally:
        db.close()
    if fila is not None and ya_comprada(usuario_id, fila.id):
        return
    comun.exigir_saldo(usuario_id, precios.precio_lectura())


def comprar(usuario_id: str, lectura_id: int, idempotencia: str) -> Decimal:
    """Cobra la lectura si no la tenía ya; siempre idempotente por `idempotencia`. Devuelve los
    créditos cobrados (0 si ya era suya)."""
    if ya_comprada(usuario_id, lectura_id):
        return Decimal(0)
    precio = precios.precio_lectura()
    db = fabrica_sistema()
    try:
        try:
            db.execute(text(
                "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), 'lectura', "
                ":k, null, :l)"),
                {"u": usuario_id, "i": str(-precio), "k": f"lectura:{idempotencia}",
                 "l": lectura_id})
        except DBAPIError as e:
            db.rollback()
            if getattr(e.orig, "sqlstate", None) == "23514":
                raise HTTPException(402, "No te quedan créditos suficientes.") from e
            raise
        db.commit()
    finally:
        db.close()
    return precio


def leer_cartera(usuario_id: str, estrategia_id, idempotencia: str) -> dict:  # noqa: ANN001
    """«Leer mi cartera»: una lectura por cada elegida de la última prueba de ESTA estrategia que
    el usuario no tenga ya comprada (plan §10). Cobra solo las que faltan por comprar."""
    from app.liga import estrategias as estrategias_mod

    info = estrategias_mod.cartera_estrategia(estrategia_id)
    if info is None:
        raise HTTPException(409, "Todavía no has probado esta estrategia.")
    foto_id, scan_run_id, tickers = info
    comun.exigir_saldo(usuario_id, precios.precio_lectura() * len(tickers))
    resultados: list[LecturaResultado] = []
    cobradas = 0
    for ticker in tickers:
        r = obtener_o_crear(ticker, foto_id, scan_run_id, usuario_id)
        if r is None:
            continue
        if not ya_comprada(usuario_id, r.id):
            comprar(usuario_id, r.id, f"{idempotencia}:{ticker}")
            cobradas += 1
        resultados.append(r)
    return {"lecturas": resultados, "creditos_cobrados": precios.precio_lectura() * cobradas}
