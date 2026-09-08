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
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import yfinance as yf
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import push
from app.llm.trace import CallRecord
from app.momentum import news_gate, signals

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
# pestañas). Por id y no global: cada candidato es independiente, no hace falta bloquear todos.
_gate_lock = threading.Lock()
_gate_en_curso: set[int] = set()


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
        db.execute(text("""
            insert into momentum_candidatos (ticker, fecha_evaluacion, decision, decidido_por)
            values (:t, :hoy, 'pendiente', 'sistema')
        """), {"t": ticker, "hoy": hoy})
        creados += 1
        nuevos_tickers.append(ticker)
    db.commit()
    if creados:
        plural = "s" if creados != 1 else ""
        push.send_to_all(
            db, title=f"Sala Real X: {creados} candidato{plural} nuevo{plural}",
            body=", ".join(nuevos_tickers), url="/momentum", tag="agentic-momentum-candidato",
        )
    return creados


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
    id_ = db.execute(text("""
        insert into momentum_candidatos (ticker, fecha_evaluacion, decision, decidido_por)
        values (:t, :hoy, 'pendiente', 'sistema')
        returning id
    """), {"t": ticker, "hoy": date.today()}).scalar()
    db.commit()
    return dict(db.execute(text("select * from momentum_candidatos where id = :id"),
                           {"id": id_}).mappings().first())


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
    Si falla cualquiera, se descarta por defecto -- Manuel puede pisarlo igual (ver doc §1)."""
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

    decision, decidido_por = row["decision"], row["decidido_por"]
    if not (sector_pass and estad_pass):
        decision, decidido_por = "descartado", "sistema"
    elif decidido_por == "sistema":
        # Reintento tras un fallo puntual (yfinance caído, etc.) que ahora sí pasa -- vuelve a
        # "pendiente" para que aparezca el botón de gate. Una decisión MANUAL nunca se pisa así.
        decision, decidido_por = "pendiente", "sistema"

    db.execute(text("""
        update momentum_candidatos
        set filtro_sector_pass = :sp, filtro_sector_detalle = :sd,
            estadistica_pass = :ep, estadistica_detalle = :ed,
            nombre = :nombre, decision = :decision, decidido_por = :decidido_por
        where id = :id
    """), {
        "sp": sector_pass, "sd": sector_detalle, "ep": estad_pass, "ed": estad_detalle,
        "nombre": nombre or row["nombre"], "decision": decision, "decidido_por": decidido_por,
        "id": candidato_id,
    })
    db.commit()
    return dict(db.execute(text("select * from momentum_candidatos where id = :id"),
                           {"id": candidato_id}).mappings().first())


def lanzar_gate_candidato(candidato_id: int, db: Session) -> dict:
    """Única llamada LLM del candidato -- sobre su señal más reciente, igual criterio que el
    gate del universo fijo (ver news_gate.py). Síncrona: es UNA llamada (~segundos), no hace
    falta el hilo en segundo plano de `gate_runner` (pensado para 17+ llamadas en serie).

    Candado por id: un doble clic (o dos pestañas) sobre el MISMO candidato no debe lanzar dos
    llamadas reales en paralelo."""
    with _gate_lock:
        if candidato_id in _gate_en_curso:
            raise ValueError("Ya hay un gate en curso para este candidato.")
        _gate_en_curso.add(candidato_id)
    try:
        return _lanzar_gate_candidato(candidato_id, db)
    finally:
        with _gate_lock:
            _gate_en_curso.discard(candidato_id)


def _lanzar_gate_candidato(candidato_id: int, db: Session) -> dict:
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

    lanzado_at = datetime.now(UTC)
    llamada_id = db.execute(text("""
        insert into momentum_gate_llamadas (candidato_id, ticker, lanzado_at)
        values (:candidato_id, :ticker, :lanzado_at)
        returning id
    """), {"candidato_id": candidato_id, "ticker": ticker, "lanzado_at": lanzado_at}).scalar()
    db.commit()

    recorder = _Recorder()
    try:
        r = news_gate.evaluar(
            ticker, row["nombre"] or ticker, ath=float(reciente["ath"]),
            entry_date=reciente["entry_date"].date(), entry_price=float(reciente["entry_price"]),
            caida_pct=float(reciente["caida_pct"]), desde=reciente["desde_noticias"].date(),
            recorder=recorder,
        )
    except Exception as exc:
        c = recorder.calls[0] if recorder.calls else None
        db.execute(text("""
            update momentum_gate_llamadas set terminado_at = :fin, model = :model,
                reasoning_effort = :re, cost_usd = :cost, latency_ms = :lat,
                ok = false, error = :error
            where id = :id
        """), {
            "fin": datetime.now(UTC), "id": llamada_id,
            "model": c.model if c else None, "re": c.reasoning_effort if c else None,
            "cost": c.cost_usd if c else None, "lat": c.latency_ms if c else None,
            "error": str(exc),
        })
        db.commit()
        raise

    c = recorder.calls[0] if recorder.calls else None
    db.execute(text("""
        update momentum_gate_llamadas set terminado_at = :fin, model = :model,
            reasoning_effort = :re, prompt_cache_hit_tokens = :hit,
            prompt_cache_miss_tokens = :miss, completion_tokens = :ct,
            cost_usd = :cost, latency_ms = :lat, ok = true, pasa = :pasa, motivo = :motivo
        where id = :id
    """), {
        "fin": datetime.now(UTC), "id": llamada_id,
        "model": c.model if c else None, "re": c.reasoning_effort if c else None,
        "hit": c.prompt_cache_hit_tokens if c else None,
        "miss": c.prompt_cache_miss_tokens if c else None,
        "ct": c.completion_tokens if c else None, "cost": c.cost_usd if c else None,
        "lat": c.latency_ms if c else None, "pasa": r.pasa, "motivo": r.motivo,
    })
    db.execute(text("""
        update momentum_candidatos
        set gate_pass = :gp, gate_detalle = :gd, decision = :decision, decidido_por = 'sistema'
        where id = :id
    """), {"gp": r.pasa, "gd": r.motivo, "decision": "incorporado" if r.pasa else "descartado",
           "id": candidato_id})
    db.commit()
    return dict(db.execute(text("select * from momentum_candidatos where id = :id"),
                           {"id": candidato_id}).mappings().first())
