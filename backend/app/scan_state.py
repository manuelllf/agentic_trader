"""Estado del escaneo: el informe del último (lo que lee la web en `/scan/report`, sacado de
`scan_runs`) y el cursor de la ventana rotatoria del semanal en `Meta`. Además, el singleton de
memoria vectorial (mejora opcional, nunca requisito del escaneo)."""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.models import Meta, ScanRun, ScanRunChange, ScanRunJevItem, utc_iso

logger = logging.getLogger(__name__)

_CURSOR_KEY = "scan_cursor"   # offset persistido de la ventana rotatoria del semanal


def informe(db: Session) -> dict | None:
    """El informe del último escaneo, completo o reventado. None si aún no hubo ninguno."""
    run = db.query(ScanRun).order_by(ScanRun.scan_at.desc(), ScanRun.id.desc()).first()
    if run is None:
        return None
    fallo = run.error is not None
    changes = (db.query(ScanRunChange).filter_by(scan_run_id=run.id)
               .order_by(ScanRunChange.posicion).all())
    jev = (db.query(ScanRunJevItem).filter_by(scan_run_id=run.id)
           .order_by(ScanRunJevItem.posicion).all())
    return {
        "at": utc_iso(run.scan_at),
        "mode": "decisión" if run.decide else "observatorio",
        "error": run.error, "issues": run.issues, "changes": [c.texto for c in changes],
        # Reventado: sin cifras del embudo ni coste (a 0 parecerían medidas reales).
        "universe": None if fallo else run.universe,
        "scanned": None if fallo else run.counter_scanned,
        "prescored": None if fallo else run.counter_prescored,
        "deep": None if fallo else run.counter_deep,
        "refreshed": run.refreshed,
        "cost": None if fallo else run.cost,
        "outlook": run.outlook or None,
        "jev_cartera": [{"ticker": j.ticker, "industry": j.industry, "score": j.score,
                         "confidence": j.confidence, "weight_pct": j.weight_pct} for j in jev],
        "jev_macro": run.jev_macro,
    }


def write_scan_failure(db: Session, exc: Exception, decide: bool) -> None:
    """Fila de `scan_runs` con el error: sin ella, un cron caído pasaría invisible en la web."""
    db.rollback()   # la sesión puede venir sucia del fallo a mitad
    modo = "decisión" if decide else "observatorio"
    db.add(ScanRun(cadence=f"{modo}/error", decide=decide, error=str(exc) or type(exc).__name__))
    db.commit()


def _scan_cursor(db: Session) -> int:
    """Offset actual de la ventana rotatoria (0 si aún no existe o está corrupto)."""
    row = db.get(Meta, _CURSOR_KEY)
    try:
        return int(row.value) if row else 0
    except (TypeError, ValueError):
        return 0


def _advance_scan_cursor(db: Session, step: int) -> None:
    """Avanza el offset `step` posiciones para que el próximo semanal teja el siguiente tramo."""
    row = db.get(Meta, _CURSOR_KEY)
    if row:
        row.value = str(_scan_cursor(db) + step)
    else:
        db.add(Meta(key=_CURSOR_KEY, value=str(step)))
    db.commit()


def _memory_store():
    """Singleton de memoria vectorial; None si faltan deps o falla (es una mejora, no requisito)."""
    try:
        from app import memory
        return memory.get_store()
    except Exception:
        logger.warning("Memoria vectorial no disponible — se omite.")
        return None
