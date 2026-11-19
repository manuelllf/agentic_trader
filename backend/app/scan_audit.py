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

from sqlalchemy import select

from app.models import ScanAudit, _utcnow

RETENTION_DAYS = 90
DETAIL_TOP = 120        # tope de nombres del detalle (ver `funnel`): la API no es el volcado


def _columnas_jev(dimensiones: dict | None) -> dict:
    """Nivel ×100 y confianza ×1000 en `smallint` (ver `ScanAudit.jev_*`)."""
    out: dict = {}
    for k, (nivel, conf) in (dimensiones or {}).items():
        out[f"jev_{k}"] = round(nivel * 100)
        out[f"jev_{k}_conf"] = None if conf is None else round(conf * 1000)
    return out


def record(db, *, prescored: list, failed: list[str], pre_errors: list | None = None,
           decide: bool | None = None, tecnicos: set[str] | None = None,
           jev_cartera: set[str] | None = None):  # noqa: ANN201
    """Añade la traza del embudo de ESTE escaneo (no borra las anteriores) y poda las viejas.
    Devuelve el `scan_at` del lote: el escaneo lo usa para colgarle su `scan_run_id`.

    `prescored` = [(PrescoreResult, NameData)]; `failed` = tickers sin datos; `pre_errors` =
    [(PrescoreResult, NameData)] cuyo pre-score no parseó (si no se registran, desaparecen del
    embudo sin dejar rastro); `decide` = si el escaneo decidía cartera; `tecnicos` = universo
    técnico del escaneo; `jev_cartera` = tickers de la cartera mecánica de Jev (None = no se
    calculó). Best-effort: el caller lo envuelve en try (un fallo aquí nunca debe tirar el escaneo).
    """
    now = _utcnow()
    rows: list[ScanAudit] = []
    for p, d in prescored:
        t = p.ticker
        rows.append(ScanAudit(
            scan_at=now, ticker=t, sector=d.sector, prescore=p.score, price=d.price,
            pasa_filtro_tecnico=(t in tecnicos) if tecnicos is not None else None,
            decide=decide, stage="prescore",
            jev_funded=(t in jev_cartera) if jev_cartera is not None else None,
            **_columnas_jev(p.dimensiones),
        ))
    for p, d in (pre_errors or []):
        # prescore=None a propósito: no hubo puntuación, hubo fallo (no cuenta como pre-scoreado).
        rows.append(ScanAudit(scan_at=now, ticker=p.ticker, sector=d.sector, price=d.price,
                              stage="prescore_error", decide=decide))
    for t in failed:
        rows.append(ScanAudit(scan_at=now, ticker=t, stage="datos", decide=decide))
    db.add_all(rows)

    db.query(ScanAudit).filter(ScanAudit.scan_at < now - timedelta(days=RETENTION_DAYS)).delete()
    db.commit()
    return now


def enlazar(db, scan_at, scan_run_id: int) -> int:  # noqa: ANN001
    """Cuelga del escaneo las filas de su lote (todas llevan el mismo `scan_at` exacto)."""
    n = (db.query(ScanAudit)
         .filter(ScanAudit.scan_at == scan_at, ScanAudit.scan_run_id.is_(None))
         .update({"scan_run_id": scan_run_id}, synchronize_session=False))
    db.commit()
    return n


def scan_dates(db, limit: int = 8) -> list:  # noqa: ANN001
    """Los `limit` escaneos guardados más recientes (su `scan_at`), del nuevo al viejo."""
    stmt = (select(ScanAudit.scan_at).group_by(ScanAudit.scan_at)
            .order_by(ScanAudit.scan_at.desc()).limit(limit))
    return list(db.execute(stmt).scalars())




