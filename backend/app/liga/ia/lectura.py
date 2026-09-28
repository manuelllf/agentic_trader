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


def _reunir(ticker: str, db: Session) -> tuple[str | None, str | None]:
    """Datos + bloque macro para el prompt (`gather` sí necesita la sesión: mira si hay foto
    reciente reutilizable). Vive en su propia función para que la sesión de BD se pueda cerrar
    ANTES de la llamada al proveedor -- ver `_nueva_llamada`."""
    from app.agents import scorer as scorer_mod
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod

    # `gather` y `get_macro` usan las cachés de datos compartidas (una captura suelta en
    # `fundamentals_snapshot` y el macro en `meta`), las mismas que rellena cualquier escaneo:
    # no tocan carteras, operaciones ni nada de las salas.
    data, error = fund_mod.gather(ticker, db=db)
    if data is None:
        logger.warning("Lectura de %s: no se pudo reunir sus datos (%s)", ticker, error)
        return None, error
    macro_block = macro_mod.bloque_macro(macro_mod.get_macro(db))
    return scorer_mod._user_prompt(data, macro_block, None), None  # noqa: SLF001


def _nueva_llamada(ticker: str, foto_id: int, usuario_id: str | None) -> Lectura | None:
    """Sin nada reutilizable: una llamada nueva, con el mismo pipeline de informe profundo que
    Alpha (`agents.scorer.score`), para esta única empresa. `None` si el LLM no responde o la
    empresa no se puede analizar (sin datos).

    Ninguna sesión de BD queda abierta durante la llamada al proveedor (hasta 180 s, hallazgo
    crítico de rendimiento): se reúnen los datos con una sesión corta, se cierra, se llama sin
    ninguna sesión y se abre una última sesión corta solo para guardar el resultado."""
    from app.agents import scorer as scorer_mod

    db = fabrica_sistema()
    try:
        user_prompt, _error = _reunir(ticker, db)
    finally:
        db.close()
    if user_prompt is None:
        return None

    contenido, llamada = comun.llamar_ia(
        finalidad="lectura", usuario_id=usuario_id, modelo=_MODELO,
        system=scorer_mod.SYSTEM, user=user_prompt, temperature=1.0, timeout=180)
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

    db = fabrica_sistema()
    try:
        lectura = Lectura(ticker=ticker, foto_id=foto_id, texto=texto[:_LARGO_TEXTO], fuentes=[],
                          llm_call_id=llm_call_id)
        db.add(lectura)
        db.flush()
        db.commit()
        db.refresh(lectura)
        return lectura
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


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
        if lectura is not None:
            db.commit()
            return LecturaResultado(lectura.id, lectura.ticker, lectura.foto_id, lectura.texto,
                                    list(lectura.fuentes or []), de_cache=False)
        db.rollback()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    # Sin nada reutilizable: la llamada nueva no mantiene esta sesión (ni ninguna) abierta.
    lectura = _nueva_llamada(ticker, foto_id, usuario_id)
    if lectura is None:
        return None
    return LecturaResultado(lectura.id, lectura.ticker, lectura.foto_id, lectura.texto,
                            list(lectura.fuentes or []), de_cache=False)


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


def comprar(usuario_id: str, lectura_id: int) -> Decimal:
    """Cobra la lectura si no la tenía ya. Idempotente por (usuario, lectura) -- la clave para
    `liga.cargar_creditos` se deriva aquí, nunca de lo que mande el cliente: dos peticiones casi
    simultáneas para el MISMO ticker (doble click, reintento de red, dos pestañas) usan la misma
    clave, y el candado por usuario de `cargar_creditos` las serializa sin duplicar el cobro --
    antes (idempotencia del cliente, distinta en cada click) las dos pasaban.

    El propio candado (`pg_advisory_xact_lock` por usuario, mismo que usa `cargar_creditos` por
    dentro) se toma aquí TAMBIÉN antes de mirar si ya era suya: tomarlo dos veces en la misma
    transacción no bloquea (Postgres lo permite), pero así la comprobación de `ya_comprada` que
    decide qué se DEVUELVE al llamador (0 o el precio) queda protegida por el mismo candado que
    protege el cobro -- si no, dos peticiones que pasan la comprobación antes de que ninguna haya
    insertado su movimiento acaban devolviendo "cobrado" las dos, aunque el libro de créditos
    solo registre un cargo (correcto en dinero, pero engañoso en lo que ve el usuario)."""
    if ya_comprada(usuario_id, lectura_id):
        return Decimal(0)
    precio = precios.precio_lectura()
    clave = f"lectura:{usuario_id}:{lectura_id}"
    db = fabrica_sistema()
    try:
        db.execute(text(
            "select pg_advisory_xact_lock(hashtextextended('liga.creditos:' || :u, 0))"),
            {"u": usuario_id})
        ya = db.execute(text(
            "select 1 from liga.creditos_movimientos where usuario_id = cast(:u as uuid) "
            "and lectura_id = :l"), {"u": usuario_id, "l": lectura_id}).one_or_none() is not None
        if ya:
            db.commit()  # suelta el candado; nada que deshacer, no se ha escrito nada
            return Decimal(0)
        try:
            db.execute(text(
                "select liga.cargar_creditos(cast(:u as uuid), cast(:i as numeric), 'lectura', "
                ":k, null, :l)"),
                {"u": usuario_id, "i": str(-precio), "k": clave, "l": lectura_id})
        except DBAPIError as e:
            db.rollback()
            if getattr(e.orig, "sqlstate", None) == "23514":
                raise HTTPException(402, "No te quedan créditos suficientes.") from e
            raise
        db.commit()
    finally:
        db.close()
    return precio


def _tickers_pendientes(usuario_id: str, foto_id: int, tickers: list[str]) -> list[str]:
    """De estos tickers, los que el usuario aún NO tiene comprados para esta foto -- en una sola
    consulta (antes: `exigir_saldo` pedía saldo para TODOS, sin restar lo ya comprado; hallazgo
    de dinero #7)."""
    if not tickers:
        return []
    db = fabrica_sistema()
    try:
        comprados = set(db.execute(text("""
            select l.ticker from liga.lecturas l
            join liga.creditos_movimientos m on m.lectura_id = l.id
            where m.usuario_id = cast(:u as uuid) and l.foto_id = :f and l.ticker = any(:t)
        """), {"u": usuario_id, "f": foto_id, "t": tickers}).scalars().all())
    finally:
        db.close()
    return [t for t in tickers if t not in comprados]


def leer_cartera(usuario_id: str, estrategia_id, idempotencia: str) -> dict:  # noqa: ANN001
    """«Leer mi cartera»: una lectura por cada elegida de la última prueba de ESTA estrategia que
    el usuario no tenga ya comprada (plan §10). Cobra solo las que faltan por comprar.

    Un `exigir_saldo` inicial por lo que de verdad falta por comprar (no por `len(tickers)`,
    hallazgo #7: antes pedía saldo para TODAS, aunque ya tuviera la mayoría). Cada ticket se cobra
    con `comprar()`, que ya es atómico e idempotente por (usuario, lectura) (hallazgo #5): si el
    saldo se agota a media tirada (concurrencia con otra compra, o la estimación inicial se quedó
    corta), se para ahí y se devuelve lo conseguido hasta ese punto en vez de tirar toda la
    respuesta -- ningún ticket se cobra dos veces ni se pierde sin aviso (hallazgo #6)."""
    from app.liga import estrategias as estrategias_mod

    info = estrategias_mod.cartera_estrategia(estrategia_id)
    if info is None:
        raise HTTPException(409, "Todavía no has probado esta estrategia.")
    foto_id, scan_run_id, tickers = info
    precio = precios.precio_lectura()
    pendientes = _tickers_pendientes(usuario_id, foto_id, tickers)
    if pendientes:
        comun.exigir_saldo(usuario_id, precio * len(pendientes))
    resultados: list[LecturaResultado] = []
    cobradas = 0
    for ticker in tickers:
        r = obtener_o_crear(ticker, foto_id, scan_run_id, usuario_id)
        if r is None:
            continue
        if not ya_comprada(usuario_id, r.id):
            try:
                comprar(usuario_id, r.id)
            except HTTPException as e:
                if e.status_code == 402:
                    # Saldo agotado a media tirada: se corta aquí y se devuelve lo conseguido,
                    # en vez de perder la respuesta entera por lo que ya se ha cobrado bien.
                    break
                raise
            cobradas += 1
        resultados.append(r)
    return {"lecturas": resultados, "creditos_cobrados": precio * cobradas}
