"""Traza de auditoría del embudo del escaneo (diagnóstico, sin LLM ni dinero).

Guarda por escaneo una foto por ticker de HASTA DÓNDE llegó: pre-score → finalista →
seleccionado → en cartera, con su precio del día. Es HISTÓRICA: cada escaneo AÑADE sus filas
(todas con el mismo `scan_at`, que hace de identificador) y solo se poda lo que pasa de
`RETENTION_DAYS`. Sin historial no se puede medir nada a posteriori — ni si las descartadas lo
hicieron mejor que las compradas, ni cómo derivan los scores de un escaneo al siguiente.

Almacenar ≠ inyectar: esto es telemetría para evaluación OFFLINE y NUNCA entra a un prompt.
"""

from __future__ import annotations

from datetime import timedelta

from app.models import ScanAudit, _utcnow

RETENTION_DAYS = 90


def _stage(reached_deep: bool, selected: bool, funded: bool) -> str:
    if funded:
        return "cartera"
    if selected:
        return "seleccionado"
    if reached_deep:
        return "finalista"
    return "prescore"


def record(db, *, prescored: list, failed: list[str], finalists: list[str],
           deep: dict, selected: list, construction, pre_errors: list | None = None) -> None:
    """Añade la traza del embudo de ESTE escaneo (no borra las anteriores) y poda las viejas.

    `prescored` = [(PrescoreResult, NameData)]; `failed` = tickers sin datos; `deep` = {ticker:
    ScoreResult} (solo los VÁLIDOS: un profundo no parseable no tiene score que guardar);
    `selected` = filas top-10; `construction.positions` = la cartera final con pesos;
    `pre_errors` = [(PrescoreResult, NameData)] cuyo pre-score no parseó (si no se registran,
    desaparecen del embudo sin dejar rastro).
    Best-effort: el caller lo envuelve en try (un fallo aquí nunca debe tirar el escaneo).
    """
    finalist_set = set(finalists)
    selected_set = {r.ticker for r in selected}
    funded = {p.ticker: p.weight_pct for p in construction.positions}
    now = _utcnow()

    rows: list[ScanAudit] = []
    for p, d in prescored:
        t = p.ticker
        in_deep, is_sel, is_fund = t in finalist_set, t in selected_set, t in funded
        rows.append(ScanAudit(
            scan_at=now, ticker=t, sector=d.sector, prescore=p.score, price=d.price,
            reached_deep=in_deep, deep_score=deep[t].score if t in deep else None,
            selected=is_sel, funded=is_fund, weight_pct=funded.get(t),
            stage=_stage(in_deep, is_sel, is_fund),
        ))
    for p, d in (pre_errors or []):
        # prescore=None a propósito: no hubo puntuación, hubo fallo (no cuenta como pre-scoreado).
        rows.append(ScanAudit(scan_at=now, ticker=p.ticker, sector=d.sector, price=d.price,
                              stage="prescore_error"))
    for t in failed:
        rows.append(ScanAudit(scan_at=now, ticker=t, stage="datos"))
    db.add_all(rows)

    db.query(ScanAudit).filter(ScanAudit.scan_at < now - timedelta(days=RETENTION_DAYS)).delete()
    db.commit()
