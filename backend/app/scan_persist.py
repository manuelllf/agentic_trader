"""Guarda en BD lo que produce el escaneo (noticias usadas, items de trade, desglose de coste) y
suma el uso/coste que devuelven los proveedores de LLM — nada de esto decide nada, solo persiste
o agrega lo que ya se decidió en otro sitio."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import ScanRunCostBreakdown, ScoreNews


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


def _guardar_news_used(db: Session, score_id: int, news: list[str] | None) -> None:
    """Congela `NameData.news` como filas de `ScoreNews` — nunca como JSON. `None` = el gather no
    trajo noticias (no se distingue de "trajo cero"; ningún lector lo necesitaba).

    Borra las filas previas de este `score_id` antes de insertar: en un observatorio la fila de
    `Score` se REUTILIZA (no se recrea, ver `run_scan_and_store`), así que sin este borrado las
    noticias de escaneos anteriores se irían acumulando debajo de las nuevas en vez de reflejar
    solo lo que entró al prompt en ESTE escaneo."""
    db.query(ScoreNews).filter(ScoreNews.score_id == score_id).delete()
    for i, texto in enumerate(news or []):
        db.add(ScoreNews(score_id=score_id, posicion=i, texto=texto))


def _guardar_trade_items(db: Session, model_cls: type, fk_field: str, fk_id: int,
                         items: list[dict]) -> None:
    """Filas hermanas de `_TradeItemColumns` (`ProposalItem`/`ScanRunConstructionItem`), mismo
    shape que la salida de `portfolio_service.build_trades` — `posicion` conserva su orden."""
    for i, it in enumerate(items):
        db.add(model_cls(**{fk_field: fk_id}, posicion=i, ticker=it["ticker"], action=it["action"],
                          score=it.get("score"),
                          target_weight_pct=it.get("target_weight_pct") or 0.0,
                          price=it.get("price"), high_52w=it.get("high_52w"),
                          target_value=it.get("target_value", "0"),
                          target_shares=it.get("target_shares") or 0.0,
                          delta_shares=it.get("delta_shares") or 0.0,
                          thesis=it.get("thesis", ""), edge=it.get("edge", ""),
                          risk=it.get("risk", "")))


def _guardar_cost_breakdown(db: Session, scan_run_id: int, cost: dict) -> None:
    campos = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
              "cache_miss_tokens", "peak_calls", "cost_usd")
    for dimension, bucket in (("model", cost.get("by_model") or {}),
                              ("stage", cost.get("by_stage") or {})):
        for clave, stats in bucket.items():
            db.add(ScanRunCostBreakdown(scan_run_id=scan_run_id, dimension=dimension, clave=clave,
                                        **{k: stats.get(k, 0) for k in campos}))
