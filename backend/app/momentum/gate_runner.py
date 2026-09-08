"""Runner del gate en segundo plano -- mismo patrón que `app/pipeline.py` (el escaneo del
ranker): 17 llamadas reales en serie tardan minutos, así que la web no espera la respuesta,
lanza el hilo y sondea `gate_progress`. Sin esto, el timeout del navegador corta la conexión
mucho antes de terminar y no queda ni rastro de qué se hizo (visto en producción 7-sep-2026).

Cada señal se evalúa y se guarda AL MOMENTO (commit por señal), y cada llamada al LLM se traza
en `momentum_gate_llamadas` ANTES de lanzarla -- así queda constancia aunque el proceso muera
a mitad, que es justo lo que faltaba la primera vez que se usó esto de verdad.
"""
from __future__ import annotations

import threading
import time
from datetime import UTC, date, datetime

from sqlalchemy import bindparam, text

from app.db import SessionLocal
from app.llm.trace import CallRecord
from app.momentum import gate_progress, news_gate, signals

_lock = threading.Lock()
_running = False


class _Recorder:
    """Duck-typing de `LLMTrace`: solo necesita `.record()`. Una llamada por evaluación, así
    que una lista basta -- no hace falta lock propio (vive dentro de un único hilo)."""

    def __init__(self) -> None:
        self.calls: list[CallRecord] = []

    def record(self, call: CallRecord) -> None:
        self.calls.append(call)


def esta_corriendo() -> bool:
    with _lock:
        return _running


def start(ids: list[int]) -> bool:
    """Lanza el gate SOLO sobre los ids elegidos (Manuel decide cuáles, señal a señal -- nunca
    un "evaluar todas" a ciegas) si no hay uno ya en marcha. `False` = ya corría.

    El total se fija AQUÍ, antes de arrancar el hilo -- si se fijara dentro de `_run()` habría
    una ventana de carrera donde el primer sondeo del frontend puede ver el estado "idle"/"done"
    de la vez anterior."""
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    gate_progress.iniciar(len(ids))
    threading.Thread(target=_run, args=(ids,), daemon=True).start()
    return True


def _parse_fecha(v):  # noqa: ANN001
    return date.fromisoformat(v) if isinstance(v, str) else v


def _run(ids: list[int]) -> None:
    global _running
    db = SessionLocal()
    try:
        pendientes = db.execute(text("""
            select * from momentum_senales
            where id in :ids and gate_resultado is null and estado != 'descartada'
        """).bindparams(bindparam("ids", expanding=True)), {"ids": ids}).mappings().all()
        for m in pendientes:
            ticker = m["ticker"]
            gate_progress.marca_ticker(ticker)
            entry_date = _parse_fecha(m["entry_date"])
            desde = _parse_fecha(m["desde_noticias"])

            lanzado_at = datetime.now(UTC)
            llamada_id = db.execute(text("""
                insert into momentum_gate_llamadas (senal_id, ticker, lanzado_at)
                values (:senal_id, :ticker, :lanzado_at)
                returning id
            """), {
                "senal_id": m["id"], "ticker": ticker, "lanzado_at": lanzado_at,
            }).scalar()
            db.commit()

            recorder = _Recorder()
            t0 = time.monotonic()
            try:
                r = news_gate.evaluar(
                    ticker, signals.NOMBRE.get(ticker, ticker),
                    ath=float(m["ath"]), entry_date=entry_date, entry_price=float(m["entry_price"]),
                    caida_pct=float(m["caida_pct"]), desde=desde, recorder=recorder,
                )
                c = recorder.calls[0] if recorder.calls else None
                db.execute(text("""
                    update momentum_gate_llamadas set terminado_at = :fin, model = :model,
                        reasoning_effort = :re, prompt_cache_hit_tokens = :hit,
                        prompt_cache_miss_tokens = :miss, completion_tokens = :ct,
                        cost_usd = :cost, latency_ms = :lat, ok = true,
                        pasa = :pasa, motivo = :motivo
                    where id = :id
                """), {
                    "fin": datetime.now(UTC), "id": llamada_id,
                    "model": c.model if c else None, "re": c.reasoning_effort if c else None,
                    "hit": c.prompt_cache_hit_tokens if c else None,
                    "miss": c.prompt_cache_miss_tokens if c else None,
                    "ct": c.completion_tokens if c else None,
                    "cost": c.cost_usd if c else None,
                    "lat": c.latency_ms if c else int((time.monotonic() - t0) * 1000),
                    "pasa": r.pasa, "motivo": r.motivo,
                })
                nuevo_estado = "nueva" if r.pasa else "descartada"
                db.execute(text("""
                    update momentum_senales
                    set gate_resultado = :res, gate_detalle = :detalle, estado = :estado
                    where id = :id
                """), {"res": "pasa" if r.pasa else "falla", "detalle": r.motivo,
                       "estado": nuevo_estado, "id": m["id"]})
                db.commit()
                gate_progress.tick(True)
            except Exception as exc:  # noqa: BLE001 -- una señal rota no debe tumbar el resto
                c = recorder.calls[0] if recorder.calls else None
                db.execute(text("""
                    update momentum_gate_llamadas set terminado_at = :fin, model = :model,
                        reasoning_effort = :re, prompt_cache_hit_tokens = :hit,
                        prompt_cache_miss_tokens = :miss, completion_tokens = :ct,
                        cost_usd = :cost, latency_ms = :lat, ok = false, error = :error
                    where id = :id
                """), {
                    "fin": datetime.now(UTC), "id": llamada_id,
                    "model": c.model if c else None, "re": c.reasoning_effort if c else None,
                    "hit": c.prompt_cache_hit_tokens if c else None,
                    "miss": c.prompt_cache_miss_tokens if c else None,
                    "ct": c.completion_tokens if c else None,
                    "cost": c.cost_usd if c else None,
                    "lat": c.latency_ms if c else int((time.monotonic() - t0) * 1000),
                    "error": str(exc),
                })
                db.commit()
                gate_progress.tick(False)
        gate_progress.terminar()
    except Exception as exc:  # noqa: BLE001 -- fallo antes/entre señales (la query, etc.)
        gate_progress.terminar(error=str(exc))
    finally:
        db.close()
        with _lock:
            _running = False
