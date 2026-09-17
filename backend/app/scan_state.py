"""Estado del escaneo persistido en `Meta`: informe del último escaneo (lo que lee la web en
`/scan/report`) y el cursor de la ventana rotatoria del semanal. Además, el singleton de
memoria vectorial (mejora opcional, nunca requisito del escaneo)."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Meta

logger = logging.getLogger(__name__)

_CURSOR_KEY = "scan_cursor"   # offset persistido de la ventana rotatoria del semanal
_REPORT_KEY = "last_scan_report"   # informe del último escaneo (JSON en Meta; ver /scan/report)


def _write_scan_report(db: Session, *, mode: str | None, result: dict | None,
                       issues: list[str], error: str | None = None,
                       changes: list[str] | None = None) -> None:
    """Persiste informe de último escaneo en Meta (fuente de verdad de la web)."""
    r = result or {}
    report = {
        "at": datetime.now(UTC).isoformat(),
        "mode": mode, "error": error, "issues": issues, "changes": changes or [],
        "universe": r.get("universe"),
        "scanned": r.get("scanned"), "prescored": r.get("prescored"), "deep": r.get("deep"),
        # Refreshed: solo observatorio (decisión reemplaza ranking entero, no refresca).
        "refreshed": r.get("refreshed"),
        "cost": r.get("cost"),
        # Outlook de este escaneo (antes observatorio lo descartaba; ahora siempre visible).
        "outlook": r.get("outlook"),
    }
    db.merge(Meta(key=_REPORT_KEY, value=json.dumps(report, ensure_ascii=False)))
    db.commit()


def write_scan_failure(db: Session, exc: Exception) -> None:
    """Marca escaneo fallido en Meta (sin esto, cron caído pasa invisible en web)."""
    db.rollback()   # la sesión puede venir sucia del fallo a mitad
    _write_scan_report(db, mode=None, result=None, issues=[], error=str(exc))


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
