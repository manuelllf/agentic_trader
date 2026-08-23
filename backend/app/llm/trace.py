"""Traza de llamadas al LLM: una fila por llamada, con lo que hasta ahora se tiraba.

El `reasoning_content` de DeepSeek ya se paga dentro de `completion_tokens` y se descartaba; el
desglose cache hit/miss también, y es la diferencia entre un tramo y otro 30x en precio.

Se recoge por proveedor (cada etapa tiene su propia instancia, así que la etapa la sabe el
proveedor) y se vuelca en bloque al terminar el escaneo: 3.000 INSERT sueltos desde 500 hilos
saturarían el pool de conexiones sin comprar nada.

El TICKER no lo conoce el proveedor: viaja por `ticker_ctx()`, un contexto por hilo. Cada
nombre se procesa entero dentro de un hilo del ThreadPoolExecutor, así que un `threading.local`
es exacto aquí — y evita meter un parámetro de telemetría en `LLMProvider`, que obligaría a
tocar todos los FakeLLM de los tests (mismo motivo por el que `chat_logprobs` va por duck-typing).
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime

_ctx = threading.local()


@contextmanager
def ticker_ctx(ticker: str | None):
    """Marca a qué nombre pertenecen las llamadas hechas dentro del bloque, en ESTE hilo."""
    previo = getattr(_ctx, "ticker", None)
    _ctx.ticker = ticker
    try:
        yield
    finally:
        _ctx.ticker = previo


def current_ticker() -> str | None:
    return getattr(_ctx, "ticker", None)


@dataclass
class NotaLogprob:
    """Una fila hermana de `CallRecord`: un candidato (elegido o alternativa) de UNA ficha
    numérica de la nota. Ver `app.models.LLMCallLogprob` — nunca viaja como JSON."""

    parte: int
    elegido: bool
    token: str
    logprob: float


@dataclass
class CallRecord:
    at: datetime
    stage: str
    ticker: str | None
    model: str
    reasoning_effort: str | None
    content: str | None
    reasoning: str | None
    confidence: float | None
    prompt_cache_hit_tokens: int
    prompt_cache_miss_tokens: int
    completion_tokens: int
    cost_usd: float
    latency_ms: int
    ok: bool
    error: str | None
    # Solo prescore/mid la rellenan (ver `deepseek._notas_logprob`); vacía en el resto.
    notas: list[NotaLogprob] = field(default_factory=list)


class LLMTrace:
    """Acumulador en memoria compartido por los proveedores de un mismo escaneo."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calls: list[CallRecord] = []

    def record(self, call: CallRecord) -> None:
        with self._lock:
            self._calls.append(call)

    def __len__(self) -> int:
        with self._lock:
            return len(self._calls)

    def flush(self, db, scan_run_id: int | None) -> int:  # noqa: ANN001
        """Persiste lo acumulado y vacía el buffer. Devuelve cuántas filas de `llm_call` escribió.

        `bulk_insert_mappings` no da el id autogenerado, y las filas de `llm_call_logprob` lo
        necesitan (FK) — por eso van con `db.add()` + `flush()` intermedio, no en bloque. A
        cadencia mensual única (~3.200 llamadas/mes) esto es una sola sesión, no 3.000 inserts
        concurrentes: el problema que evitaba el bulk (saturar el pool desde 500 hilos) no
        aplica aquí, este flush corre en un único hilo al final del escaneo.
        """
        from app.models import LLMCall, LLMCallLogprob

        with self._lock:
            pendientes, self._calls = self._calls, []
        if not pendientes:
            return 0
        for c in pendientes:
            fila = LLMCall(scan_run_id=scan_run_id, **{
                k: v for k, v in vars(c).items() if k != "notas"})
            db.add(fila)
            db.flush()   # asigna fila.id sin comprometer la transacción
            for n in c.notas:
                db.add(LLMCallLogprob(llm_call_id=fila.id, parte=n.parte,
                                      elegido=n.elegido, token=n.token, logprob=n.logprob))
        db.commit()
        return len(pendientes)
