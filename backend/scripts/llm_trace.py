"""Lee la traza de llamadas al LLM de un escaneo (`llm_call`).

Uso (desde la carpeta backend):
    uv run python scripts/llm_trace.py                  # resumen del último escaneo
    uv run python scripts/llm_trace.py --lista          # qué escaneos tienen traza
    uv run python scripts/llm_trace.py 42               # resumen del escaneo 42
    uv run python scripts/llm_trace.py 42 AVGO          # las llamadas de AVGO, con razonamiento
    uv run python scripts/llm_trace.py 42 AVGO --dudas  # + distribución de los tokens dudosos
    uv run python scripts/llm_trace.py 42 --fallos      # solo las que fallaron

Read-only: no toca nada.
"""

from __future__ import annotations

import math
import sys

from sqlalchemy import func

from app import models  # noqa: F401  (registra las tablas en la metadata)
from app.db import SessionLocal
from app.models import LLMCall, LLMCallLogprob


def _fmt_coste(c: float) -> str:
    return f"${c:.4f}"


def _resumen(db, scan_run_id: int | None) -> None:  # noqa: ANN001
    filas = (
        db.query(
            LLMCall.stage, LLMCall.model,
            func.count(LLMCall.id), func.sum(LLMCall.cost_usd),
            func.sum(LLMCall.prompt_cache_hit_tokens), func.sum(LLMCall.prompt_cache_miss_tokens),
            func.sum(LLMCall.completion_tokens), func.avg(LLMCall.latency_ms),
            func.count(LLMCall.reasoning),
        )
        .filter(LLMCall.scan_run_id == scan_run_id)
        .group_by(LLMCall.stage, LLMCall.model)
        .all()
    )
    if not filas:
        print(f"Sin traza para el escaneo {scan_run_id}.")
        return
    print(f"── Escaneo {scan_run_id} ─────────────────────────────")
    print(f"{'etapa':<12} {'modelo':<20} {'n':>5} {'coste':>10} {'hit%':>6} "
          f"{'out tok':>9} {'ms':>7} {'razon.':>7}")
    for etapa, modelo, n, coste, hit, miss, out, ms, con_razon in filas:
        prompt = (hit or 0) + (miss or 0)
        pct = f"{(hit or 0) / prompt * 100:.0f}%" if prompt else "n/d"
        print(f"{etapa:<12} {modelo:<20} {n:>5} {_fmt_coste(coste or 0):>10} {pct:>6} "
              f"{out or 0:>9} {ms or 0:>7.0f} {con_razon:>7}")

    fallos = (db.query(LLMCall.stage, LLMCall.error, func.count(LLMCall.id))
              .filter(LLMCall.scan_run_id == scan_run_id, LLMCall.ok.is_(False))
              .group_by(LLMCall.stage, LLMCall.error).all())
    if fallos:
        print("\nFallos:")
        for etapa, error, n in fallos:
            print(f"  {etapa}: {error} ({n})")


def _distribucion(db, llm_call_id: int, umbral: float = 0.98) -> list[str]:  # noqa: ANN001
    """Las fichas de la nota donde el modelo DUDÓ, con sus alternativas (`llm_call_logprob`,
    relacional — solo hay filas si la etapa es prescore/mid). Un token al 0,99 no dice nada;
    uno al 0,55 con un 0,40 detrás es una decisión que pudo salir al revés."""
    filas = (db.query(LLMCallLogprob)
             .filter(LLMCallLogprob.llm_call_id == llm_call_id)
             .order_by(LLMCallLogprob.parte, LLMCallLogprob.logprob.desc()).all())
    por_parte: dict[int, list[LLMCallLogprob]] = {}
    for f in filas:
        por_parte.setdefault(f.parte, []).append(f)
    lineas: list[str] = []
    for parte, grupo in sorted(por_parte.items()):
        elegido = next((f for f in grupo if f.elegido), None)
        if elegido is None or math.exp(elegido.logprob) >= umbral:
            continue
        alts = " · ".join(f"{f.token!r} {math.exp(f.logprob):.3f}"
                          for f in grupo if not f.elegido)
        lineas.append(f"     parte {parte}: {elegido.token!r} {math.exp(elegido.logprob):.3f}"
                      + (f"   ← {alts}" if alts else ""))
    return lineas


def _detalle(db, scan_run_id: int | None, ticker: str | None, solo_fallos: bool,  # noqa: ANN001
             con_dudas: bool) -> None:
    q = db.query(LLMCall).filter(LLMCall.scan_run_id == scan_run_id)
    if ticker:
        q = q.filter(LLMCall.ticker == ticker.upper())
    if solo_fallos:
        q = q.filter(LLMCall.ok.is_(False))
    filas = q.order_by(LLMCall.at).all()
    if not filas:
        print("Sin llamadas que encajen con el filtro.")
        return
    for c in filas:
        print(f"\n── {c.at:%Y-%m-%d %H:%M:%S} · {c.stage} · {c.ticker or '—'} · {c.model} "
              f"(reasoning={c.reasoning_effort or 'default'}) ──")
        print(f"   {_fmt_coste(c.cost_usd)} · cache {c.prompt_cache_hit_tokens} hit / "
              f"{c.prompt_cache_miss_tokens} miss · {c.completion_tokens} out · {c.latency_ms} ms"
              + (f" · confianza {c.confidence:.4f}" if c.confidence is not None else ""))
        if c.error:
            print(f"   ERROR: {c.error}")
        if c.reasoning:
            print("   RAZONAMIENTO:")
            for linea in c.reasoning.splitlines():
                print(f"     {linea}")
        if c.content:
            print(f"   RESPUESTA: {c.content}")
        if con_dudas:
            dudas = _distribucion(db, c.id)
            print("   DONDE DUDÓ:")
            for linea in dudas or ["     (ningún token por debajo de 0,98)"]:
                print(linea)


def main() -> None:
    args = list(sys.argv[1:])
    solo_fallos = "--fallos" in args
    con_dudas = "--dudas" in args
    args = [a for a in args if a not in ("--fallos", "--dudas")]
    db = SessionLocal()
    try:
        if "--lista" in args:
            filas = (db.query(LLMCall.scan_run_id, func.count(LLMCall.id),
                              func.min(LLMCall.at), func.sum(LLMCall.cost_usd))
                     .group_by(LLMCall.scan_run_id)
                     .order_by(LLMCall.scan_run_id.desc()).all())
            if not filas:
                print("No hay traza todavía (lanza un escaneo primero).")
                return
            for run_id, n, desde, coste in filas:
                print(f"  escaneo {run_id or '—':>6}: {n:>6} llamadas · {desde:%Y-%m-%d %H:%M} · "
                      f"{_fmt_coste(coste or 0)}")
            return

        scan_run_id = int(args[0]) if args and args[0].isdigit() else None
        if scan_run_id is None:
            scan_run_id = db.query(func.max(LLMCall.scan_run_id)).scalar()
            if scan_run_id is None:
                print("No hay traza todavía (lanza un escaneo primero).")
                return
        ticker = next((a for a in args if not a.isdigit()), None)

        if ticker or solo_fallos or con_dudas:
            _detalle(db, scan_run_id, ticker, solo_fallos, con_dudas)
        else:
            _resumen(db, scan_run_id)
    finally:
        db.close()


if __name__ == "__main__":
    main()
