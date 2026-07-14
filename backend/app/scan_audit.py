"""Traza de auditoría del embudo del escaneo (diagnóstico, sin LLM ni dinero).

Reemplaza en cada escaneo una foto por ticker de HASTA DÓNDE llegó: pre-score → finalista →
seleccionado → en cartera. No es histórico (solo el último escaneo). Instrumento para comprobar
que el corte de finalistas ya no colapsa en un solo sector; no toca el flujo del escaneo.
"""

from __future__ import annotations

from app.models import ScanAudit, _utcnow


def _stage(reached_deep: bool, selected: bool, funded: bool) -> str:
    if funded:
        return "cartera"
    if selected:
        return "seleccionado"
    if reached_deep:
        return "finalista"
    return "prescore"


def record(db, *, prescored: list, failed: list[str], finalists: list[str],
           deep: dict, selected: list, construction) -> None:
    """Escribe la traza del embudo del escaneo actual (reemplaza la anterior).

    `prescored` = [(PrescoreResult, NameData)]; `failed` = tickers sin datos; `deep` = {ticker:
    ScoreResult}; `selected` = filas top-10; `construction.positions` = la cartera final con pesos.
    Best-effort: el caller lo envuelve en try (un fallo aquí nunca debe tirar el escaneo).
    """
    finalist_set = set(finalists)
    selected_set = {r.ticker for r in selected}
    funded = {p.ticker: p.weight_pct for p in construction.positions}
    now = _utcnow()

    db.query(ScanAudit).delete()
    rows: list[ScanAudit] = []
    for p, d in prescored:
        t = p.ticker
        in_deep, is_sel, is_fund = t in finalist_set, t in selected_set, t in funded
        rows.append(ScanAudit(
            scan_at=now, ticker=t, sector=d.sector, prescore=p.score,
            reached_deep=in_deep, deep_score=deep[t].score if t in deep else None,
            selected=is_sel, funded=is_fund, weight_pct=funded.get(t),
            stage=_stage(in_deep, is_sel, is_fund),
        ))
    for t in failed:
        rows.append(ScanAudit(scan_at=now, ticker=t, stage="datos"))
    db.add_all(rows)
    db.commit()
