"""Runner del escaneo diario de momentum en segundo plano -- mismo patrón que `gate_runner.py`
(y que `app/pipeline.py` del ranker): `compute_signals()` sobre el universo entero (~9s medidos
en local con 28 tickers, más en producción con más red) puede superar el timeout de 15s del
cliente. Antes `POST /admin/scan` esperaba la respuesta entera dentro de la propia petición --
bug real: el navegador podía dar "timeout" con el escaneo ya completado y comiteado por detrás,
igual que ya le pasó al gate el 7-sep-2026. Ahora solo LANZA el hilo y responde al momento;
`GET /momentum/scan/progreso` se sondea desde la web.
"""
from __future__ import annotations

import logging
import threading

from app.db import SessionLocal
from app.momentum import candidatos as candidatos_mod
from app.momentum import scan_progress, signals

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_running = False


def esta_corriendo() -> bool:
    with _lock:
        return _running


def start() -> bool:
    """Lanza el escaneo si no hay uno ya en marcha. `False` = ya corría."""
    global _running
    with _lock:
        if _running:
            return False
        _running = True
    threading.Thread(target=_run, daemon=True).start()
    return True


def _run() -> None:
    global _running
    from app.scheduler import procesar_señales  # import perezoso, evita el circular con scheduler

    db = SessionLocal()
    try:
        candidatos_mod.sincronizar_universo(db)
        universo = list(signals.UNIVERSO)
        scan_progress.iniciar(len(universo))
        todas = signals.compute_signals(
            universo, progreso_cb=lambda i, _total, t: scan_progress.avance(i, t))
        resultado = procesar_señales(db, todas)
        scan_progress.terminar(nuevas=resultado["nuevas"], resueltas=resultado["resueltas"])
    except Exception:  # noqa: BLE001
        # El detalle entero (incl. el SQL y los parámetros de un error de SQLAlchemy) va SOLO al
        # log del servidor -- al panel del usuario un mensaje corto, nunca el stacktrace.
        logger.exception("Fallo en el escaneo manual de momentum")
        scan_progress.terminar(error="No se pudo completar el escaneo. Revisa los logs del servidor.")
    finally:
        db.close()
        with _lock:
            _running = False
