"""Descubrimiento de candidatos (fase 2 del pipeline, ver docs/momentum-sala-real-x.md §1):
detecta rupturas de menciones sobre lo que guarda `apewisdom.py`, corre los dos filtros
gratis (sector + estadística) a demanda por candidato, y el gate LLM uno a uno -- nunca en
bloque y nunca automático. Decidido 8-sep-2026: el gate de un candidato es una decisión
totalmente aparte del gate de las señales del universo fijo, con su propia cola y su propio
botón por fila -- así Manuel elige cuál merece la pena, no evalúa todo lo que rompe menciones.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import yfinance as yf
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app import push
from app.db import SessionLocal
from app.llm.trace import CallRecord
from app.models import MomentumCandidato, MomentumGateLlamada, MomentumUniverso
from app.momentum import gate_config, news_gate, signals

logger = logging.getLogger(__name__)

# Umbral provisional de "ruptura de menciones" -- sin semanas de histórico propio no hay forma
# honesta de calibrarlo (ver doc §1); se revisa en cuanto haya datos reales. El mínimo evita
# que series diminutas (2 menciones -> 6 es "x3") disparen ruido.
RUPTURA_MULT = 3
RUPTURA_MIN_MENCIONES = 20
DIAS_SIN_REPETIR = 30  # no reabrir un candidato ya fichado hace poco, aunque siga rompiendo

# Sectores/industrias ya descartados con datos reales (ver doc §1: cannabis, EV especulativo,
# nuclear tradicional y minería crítica genérica quedaron peor que el universo actual). Solo
# excluye lo ya probado -- nunca por capitalización, nunca "parece raro".
_INDUSTRIA_EXCLUIDA = {"cannabis", "auto manufacturers", "other industrial metals & mining"}
_SECTOR_EXCLUIDO = {"utilities"}

# Candado por candidato -- evita dos gates a la vez sobre el MISMO id (doble clic, dos
# pestañas). Por id y no global: cada candidato es independiente, no hace falta bloquear todos
# (a diferencia de gate_runner, que sí sirve una cola serie de señales).
_gate_lock = threading.Lock()
_gate_en_curso: set[int] = set()
# Último estado conocido del gate en segundo plano de cada candidato -- lo sondea el frontend
# (ver `gate_progreso_candidato`). En memoria, un solo proceso, se resetea al reiniciar (mismo
# patrón que `gate_progress.py`).
_gate_estado: dict[int, dict] = {}


@dataclass
class _Recorder:
    """Duck-typing de `LLMTrace`: solo `.record()`. Una llamada por evaluación -- ver
    `gate_runner._Recorder`, misma idea, copia pequeña para no acoplar los dos módulos."""

    calls: list = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.calls = []

    def record(self, call: CallRecord) -> None:
        self.calls.append(call)


def detectar_rupturas(db: Session) -> int:
    """Sobre la foto de HOY en `momentum_apewisdom`: tickers fuera del universo con menciones
    disparadas frente a hace 24h. Crea una fila esqueleto por candidato nuevo -- gratis, sin
    tocar sector/estadística/gate todavía, eso lo dispara Manuel fila a fila. Avisa por push,
    tag propio para no pisar los avisos de señales reales."""
    hoy = date.today()
    filas = db.execute(text("""
        select ticker, mentions, mentions_24h_ago from momentum_apewisdom where fecha = :hoy
    """), {"hoy": hoy}).mappings().all()
    limite = hoy - timedelta(days=DIAS_SIN_REPETIR)
    creados, nuevos_tickers = 0, []
    for f in filas:
        ticker = f["ticker"]
        m24, menc = f["mentions_24h_ago"] or 0, f["mentions"] or 0
        if ticker in signals.UNIVERSO or m24 <= 0 or menc < RUPTURA_MIN_MENCIONES:
            continue
        if menc < m24 * RUPTURA_MULT:
            continue
        ya_existe = db.execute(text("""
            select 1 from momentum_candidatos where ticker = :t and fecha_evaluacion >= :limite
        """), {"t": ticker, "limite": limite}).first()
        if ya_existe:
            continue
        db.add(MomentumCandidato(ticker=ticker, fecha_evaluacion=hoy, decision="pendiente",
                                 decidido_por="sistema"))
        creados += 1
        nuevos_tickers.append(ticker)
    db.commit()
    if creados:
        plural = "s" if creados != 1 else ""
        push.send_to_all(
            db, title=f"Omega: {creados} candidato{plural} nuevo{plural}",
            body=", ".join(nuevos_tickers), url="/omega", tag="agentic-omega-candidato",
        )
    return creados


def sincronizar_universo(db: Session) -> int:
    """Única fuente de verdad del universo: la tabla `momentum_universo` -- ya no hay tickers
    hardcodeados en signals.py (database-first, decidido 9-sep-2026, ver
    [[supabase-db-first]]). Dos pasos, ambos idempotentes, seguro llamarlo en cada lectura:
    1. Vuelca a la tabla los candidatos recién incorporados que aún no tengan fila propia
       (mismo trabajo que antes hacía esta función solo en memoria -- ahora queda en BBDD,
       origen='incorporado'). Sector = el real de yfinance (la parte antes de la barra), no se
       fuerza a uno de los sub-géneros curados -- estos llegaron por descubrimiento, no por ETF.
    2. Recarga desde cero `signals.UNIVERSO/SECTOR/NOMBRE` (memoria del proceso) con TODO lo
       que hay en la tabla -- así un alta o baja hecha directamente en BBDD también se refleja,
       no solo los altos vía "Incorporar"."""
    nuevos = db.execute(text("""
        select c.ticker, c.nombre, c.filtro_sector_detalle from momentum_candidatos c
        where c.decision = 'incorporado'
          and not exists (select 1 from momentum_universo u where u.ticker = c.ticker)
    """)).mappings().all()
    añadidos: set[str] = set()     # un ticker puede venir de dos candidatos incorporados
    for r in nuevos:
        sector = (r["filtro_sector_detalle"] or "").split(" / ")[0].strip() or "Descubierto"
        if r["ticker"] in añadidos or db.get(MomentumUniverso, r["ticker"]) is not None:
            continue                   # nunca pisa una fila existente
        añadidos.add(r["ticker"])
        db.add(MomentumUniverso(ticker=r["ticker"], sector=sector,
                                nombre=r["nombre"] or r["ticker"], origen="incorporado"))
    if nuevos:
        db.commit()
    rows = db.execute(text(
        "select ticker, sector, nombre from momentum_universo order by ticker"
    )).mappings().all()
    signals.UNIVERSO[:] = [r["ticker"] for r in rows]
    signals.SECTOR.clear()
    signals.SECTOR.update({r["ticker"]: r["sector"] for r in rows})
    signals.NOMBRE.clear()
    signals.NOMBRE.update({r["ticker"]: r["nombre"] for r in rows})
    return len(nuevos)


def backfill_señales(ticker: str, db: Session) -> None:
    """Tras incorporar: calcula y guarda YA el historial completo de señales del ticker
    (resueltas para Validación/Historial, y la activa si tiene una abierta) -- mismo trabajo
    que hace el cron diario para cualquiera de los 34 fijos, para que "Incorporar" no deje al
    ticker esperando hasta mañana (bug real 8-sep-2026: Manuel incorporó QCOM con una alerta
    activa detectada por el propio filtro de estadística, y no aparecía en Alertas activas
    porque sincronizar_universo solo tocaba la lista en memoria, nunca `momentum_senales`).
    Mejor esfuerzo: si yfinance falla aquí, el cron de mañana lo recupera solo."""
    from app.scheduler import procesar_señales  # import perezoso, evita el circular con scheduler
    try:
        procesar_señales(db, signals.compute_signals([ticker]), universo=list(signals.UNIVERSO))
    except Exception:
        logger.exception("Backfill de señales tras incorporar %s falló", ticker)


def crear_manual(ticker: str, db: Session) -> dict:
    """Alta manual -- Manuel ficha un ticker que él mismo detectó, sin esperar a ApeWisdom.
    Cae en la misma cola "por revisar" que uno automático, mismo pipeline desde aquí."""
    ticker = ticker.strip().upper()
    if not ticker:
        raise ValueError("Ticker vacío.")
    if ticker in signals.UNIVERSO:
        raise ValueError("Ya está en el universo fijo.")
    ya_pendiente = db.execute(text("""
        select 1 from momentum_candidatos where ticker = :t and decision = 'pendiente'
    """), {"t": ticker}).first()
    if ya_pendiente:
        raise ValueError("Ya hay un candidato pendiente con ese ticker.")
    nuevo = MomentumCandidato(ticker=ticker, fecha_evaluacion=date.today(), decision="pendiente",
                              decidido_por="sistema")
    db.add(nuevo)
    db.commit()
    return dict(db.execute(text("select * from momentum_candidatos where id = :id"),
                           {"id": nuevo.id}).mappings().first())


def _info_yfinance(ticker: str) -> dict:
    """Reintento único -- una respuesta vacía por fallo puntual de red no es lo mismo que
    'sin sector' (mismo motivo que el reintento de `signals.fetch()`)."""
    for _ in range(2):
        try:
            info = yf.Ticker(ticker).info
            if info:
                return info
        except Exception:
            logger.warning("Sin datos de yfinance para %s.", ticker, exc_info=True)
        time.sleep(1.0)
    return {}


def _stats_estadistica(señales: list[dict]) -> str:
    """Mismo cálculo que 'Validación histórica' (media/mediana/% positivas) pero sobre el
    histórico fresco del candidato -- pasar el filtro no basta, Manuel necesita ver si esas
    señales fueron buenas de verdad antes de decidir."""
    resueltas = [s for s in señales if s.get("resuelta")]
    if not resueltas:
        return f"{len(señales)} señal(es), ninguna resuelta todavía."
    rets = sorted(float(s["ret"]) for s in resueltas)
    n = len(rets)
    media = sum(rets) / n
    mediana = rets[n // 2] if n % 2 else (rets[n // 2 - 1] + rets[n // 2]) / 2
    pct_pos = sum(1 for x in rets if x > 0) / n * 100
    return (f"{len(señales)} señal(es), {n} resuelta(s): media {media:+.1f}%, "
            f"mediana {mediana:+.1f}%, {pct_pos:.0f}% positivas.")


def comprobar_filtros(candidato_id: int, db: Session) -> dict:
    """Etapas 1+2, gratis y automáticas: sector (yfinance, excluye solo lo ya descartado con
    datos reales) + estadística (¿el motor de señales encuentra alguna entrada en su histórico?).
    Nunca decide por Manuel -- solo informa. Si falla cualquiera, la fila pasa a "evaluados"
    igualmente (nada más que comprobar), pero la decisión de incorporar o no sigue siendo
    100% suya (decidido 8-sep-2026, corrigiendo un sesgo real: antes se auto-descartaba)."""
    row = db.execute(text("select * from momentum_candidatos where id = :id"),
                     {"id": candidato_id}).mappings().first()
    if row is None:
        raise ValueError("Candidato no encontrado.")
    ticker = row["ticker"]

    info = _info_yfinance(ticker)
    sector = str(info.get("sector") or "").strip()
    industria = str(info.get("industry") or "").strip()
    nombre = str(info.get("shortName") or "").strip()
    if not info:
        sector_pass, sector_detalle = False, "Sin datos de yfinance -- reintenta más tarde."
    else:
        excluido = industria.lower() in _INDUSTRIA_EXCLUIDA or sector.lower() in _SECTOR_EXCLUIDO
        sector_pass = not excluido
        sector_detalle = f"{sector or '—'} / {industria or '—'}"

    señales = signals.señales_de_ticker(ticker)
    estad_pass = len(señales) > 0
    estad_detalle = (_stats_estadistica(señales) if estad_pass
                     else "Sin ninguna entrada con el patrón zigzag/suelo.")

    db.execute(update(MomentumCandidato).where(MomentumCandidato.id == candidato_id).values(
        filtro_sector_pass=sector_pass, filtro_sector_detalle=sector_detalle,
        estadistica_pass=estad_pass, estadistica_detalle=estad_detalle,
        nombre=nombre or row["nombre"],
    ))
    db.commit()
    return dict(db.execute(text("select * from momentum_candidatos where id = :id"),
                           {"id": candidato_id}).mappings().first())


def lanzar_gate_candidato(candidato_id: int, db: Session) -> None:
    """Única llamada LLM del candidato -- sobre su señal más reciente, igual criterio que el
    gate del universo fijo (ver news_gate.py).

    Valida al momento (barato: BD + señales ya calculadas) y lanza la llamada real en un hilo
    aparte -- si se esperara aquí, el timeout del navegador/proxy corta la conexión antes de que
    DeepSeek responda (mismo bug que ya forzó a hacer async el gate de señales el 7-sep y el
    escaneo el 9-sep; visto en producción con este mismo endpoint el 14-sep-2026 -- la
    suposición de "es UNA llamada, van segundos" dejó de sostenerse).

    Candado por id: un doble clic (o dos pestañas) sobre el MISMO candidato no debe lanzar dos
    llamadas reales en paralelo."""
    row = db.execute(text("select * from momentum_candidatos where id = :id"),
                     {"id": candidato_id}).mappings().first()
    if row is None:
        raise ValueError("Candidato no encontrado.")
    if not (row["filtro_sector_pass"] and row["estadistica_pass"]):
        raise ValueError("Faltan los filtros de sector/estadística, o no pasaron.")
    ticker = row["ticker"]
    señales = signals.señales_de_ticker(ticker)
    if not señales:
        raise ValueError("Sin señales que evaluar (el histórico pudo cambiar desde el filtro).")
    reciente = max(señales, key=lambda s: s["entry_date"])

    with _gate_lock:
        if candidato_id in _gate_en_curso:
            raise ValueError("Ya hay un gate en curso para este candidato.")
        _gate_en_curso.add(candidato_id)
        _gate_estado[candidato_id] = {"status": "running", "error": None}
    threading.Thread(target=_gate_en_segundo_plano,
                     args=(candidato_id, ticker, row["nombre"], reciente), daemon=True).start()


def gate_progreso_candidato(candidato_id: int) -> dict:
    with _gate_lock:
        return dict(_gate_estado.get(candidato_id, {"status": "idle", "error": None}))


# Techo duro de TODO el trabajo del gate (noticias + LLM), no solo de la llamada a DeepSeek
# (que ya tiene su propio timeout de 45s, ver news_gate.py): el fetch de noticias hace varias
# peticiones de hasta 15s cada una ANTES de llegar al LLM, y en local (Windows + curl_cffi) se
# ha visto colgarse muy por encima de sus propios timeouts (visto 14-sep-2026: más de 3 minutos
# sin resolver). Python no puede matar un hilo a medias, así que esto NO cancela el trabajo --
# lo abandona y libera el candado para que Manuel no se quede bloqueado esperando una respuesta
# que quizá nunca llegue.
_GATE_TIMEOUT_S = 90.0


def _gate_en_segundo_plano(candidato_id: int, ticker: str, nombre: str | None,
                           reciente: dict) -> None:
    t0 = time.monotonic()
    logger.info("Gate candidato %s (%s): lanzado, techo %.0fs.", candidato_id, ticker,
               _GATE_TIMEOUT_S)
    db = SessionLocal()
    pool = ThreadPoolExecutor(max_workers=1)
    cerrar_db = True
    try:
        future = pool.submit(_lanzar_gate_candidato, candidato_id, ticker, nombre, reciente, db)
        try:
            future.result(timeout=_GATE_TIMEOUT_S)
        except FutureTimeoutError as exc:
            # El hilo interno sigue vivo por detrás -- no se cierra `db` bajo sus pies, se deja
            # que muera solo cuando (si) el fetch/LLM colgado termine.
            cerrar_db = False
            raise RuntimeError(
                f"Sin respuesta en {_GATE_TIMEOUT_S:.0f}s -- abandonado, reintenta más tarde."
            ) from exc
        with _gate_lock:
            _gate_estado[candidato_id] = {"status": "done", "error": None}
        logger.info("Gate candidato %s (%s): terminado en %.1fs.", candidato_id, ticker,
                   time.monotonic() - t0)
    except Exception as exc:  # noqa: BLE001 -- el fallo se guarda para que el frontend lo enseñe
        logger.exception("Gate candidato %s (%s): fallo tras %.1fs.", candidato_id, ticker,
                         time.monotonic() - t0)
        with _gate_lock:
            _gate_estado[candidato_id] = {"status": "error", "error": str(exc)}
    finally:
        if cerrar_db:
            db.close()
        pool.shutdown(wait=False)
        with _gate_lock:
            _gate_en_curso.discard(candidato_id)


def _lanzar_gate_candidato(candidato_id: int, ticker: str, nombre: str | None, reciente: dict,
                          db: Session) -> None:
    llamada = MomentumGateLlamada(candidato_id=candidato_id, ticker=ticker,
                                  lanzado_at=datetime.now(UTC))
    db.add(llamada)
    db.commit()
    fila = update(MomentumGateLlamada).where(MomentumGateLlamada.id == llamada.id)

    recorder = _Recorder()
    provider = gate_config.get_gate_provider(db)
    try:
        r = news_gate.evaluar(
            ticker, nombre or ticker, ath=float(reciente["ath"]),
            entry_date=reciente["entry_date"].date(), entry_price=float(reciente["entry_price"]),
            caida_pct=float(reciente["caida_pct"]), desde=reciente["desde_noticias"].date(),
            recorder=recorder, provider=provider,
        )
    except Exception as exc:
        c = recorder.calls[0] if recorder.calls else None
        db.execute(fila.values(
            terminado_at=datetime.now(UTC), model=c.model if c else None,
            reasoning_effort=c.reasoning_effort if c else None,
            cost_usd=c.cost_usd if c else None, latency_ms=c.latency_ms if c else None,
            ok=False, error=str(exc),
        ))
        db.commit()
        raise

    c = recorder.calls[0] if recorder.calls else None
    db.execute(fila.values(
        terminado_at=datetime.now(UTC), model=c.model if c else None,
        reasoning_effort=c.reasoning_effort if c else None,
        prompt_cache_hit_tokens=c.prompt_cache_hit_tokens if c else None,
        prompt_cache_miss_tokens=c.prompt_cache_miss_tokens if c else None,
        completion_tokens=c.completion_tokens if c else None,
        cost_usd=c.cost_usd if c else None, latency_ms=c.latency_ms if c else None,
        ok=True, pasa=r.pasa, motivo=r.motivo,
    ))
    # El gate informa, no decide -- ni siquiera si pasa. Incorporar o descartar es SIEMPRE
    # tu clic explícito (corregido 8-sep-2026: antes esto se decidía solo).
    db.execute(update(MomentumCandidato).where(MomentumCandidato.id == candidato_id)
               .values(gate_pass=r.pasa, gate_detalle=r.motivo))
    db.commit()
