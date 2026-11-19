"""Guarda en BD lo que produce el escaneo (noticias usadas, items de trade, desglose de coste) y
suma el uso/coste que devuelven los proveedores de LLM — nada de esto decide nada, solo persiste
o agrega lo que ya se decidió en otro sitio."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ScanRunCostBreakdown


def _llm_usage(**etapas) -> dict:
    """Suma el uso (llamadas/tokens/coste) de varias etapas nombradas. Tolera `None`/FakeLLM
    sin `usage` (capa media desactivada, tests).

    `by_model` desglosa por modelo (Flash del prescore vs V4-Pro del resto) y `by_stage` por
    ETAPA — necesario aparte porque macro/profundo/constructor comparten el mismo modelo (V4-Pro)
    desde que se dejó OpenRouter: sin `by_stage`, `by_model["deepseek-v4-pro"]` mezclaría las
    tres y ScanRun.cost dejaría de decir en qué paso se fue el dinero, justo lo que `by_model`
    existe para evitar.

    `cache_hit/miss_tokens` y `peak_calls` vienen del proveedor: un escaneo caro puede serlo por
    mal aprovechamiento de la caché (el tramo miss cuesta 30x el de hit) o por haber caído en
    horario peak (el doble), y sin el desglose las dos causas son indistinguibles del total.
    """
    campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
              "cache_miss_tokens", "peak_calls", "cost_usd")
    total = dict.fromkeys(campos, 0)
    total.update(by_model={}, by_stage={})
    for etapa, llm in etapas.items():
        u = getattr(llm, "usage", None)
        if not isinstance(u, dict):
            continue
        for k in campos:
            total[k] += u.get(k, 0)
        for modelo, stats in (u.get("by_model") or {}).items():
            acc = total["by_model"].setdefault(modelo, dict.fromkeys(campos, 0))
            for k in campos:
                acc[k] += stats.get(k, 0)
        total["by_stage"][etapa] = {k: u.get(k, 0) for k in campos}
    prompt_facturado = total["cache_hit_tokens"] + total["cache_miss_tokens"]
    total["cache_hit_ratio"] = (
        round(total["cache_hit_tokens"] / prompt_facturado, 4) if prompt_facturado else None
    )
    total["cost_usd"] = round(total["cost_usd"], 4)
    return total


def _sector(data_by_t: dict, ticker: str) -> str:
    """Sector de un ticker (o 'UCITS' si es un instrumento del allowlist, que no se puntúa)."""
    d = data_by_t.get(ticker)
    return d.sector if d else "UCITS"






def _guardar_cost_breakdown(db: Session, scan_run_id: int, cost: dict) -> None:
    campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
              "cache_miss_tokens", "peak_calls", "cost_usd")
    for dimension, bucket in (("model", cost.get("by_model") or {}),
                              ("stage", cost.get("by_stage") or {})):
        for clave, stats in bucket.items():
            db.add(ScanRunCostBreakdown(scan_run_id=scan_run_id, dimension=dimension, clave=clave,
                                        **{k: stats.get(k, 0) for k in campos}))
