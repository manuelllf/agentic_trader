"""Runner del escaneo en segundo plano.

El escaneo (pre-score Flash del universo entero + informe V4-Pro en los finalistas) tarda
~15 min → se ejecuta en un hilo aparte y la web consulta el estado. El propio servicio borra
scores/propuesta previos y persiste la foto nueva.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime

from app import scan_progress
from app.db import SessionLocal
from app.scan_service import run_scan_and_store, write_scan_failure

_state: dict = {
    "status": "idle",       # idle | running | done | error
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
}
_lock = threading.Lock()


def get_status() -> dict:
    with _lock:
        return dict(_state)


def _run(sample_size: int | None, decide: bool, force_mid_layer: bool,
        llm_overrides: dict | None, reutilizar_ultima_foto: bool) -> None:
    db = SessionLocal()
    try:
        result = run_scan_and_store(db, sample_size=sample_size, decide=decide,
                                    force_mid_layer=force_mid_layer,
                                    llm_overrides=llm_overrides,
                                    reutilizar_ultima_foto=reutilizar_ultima_foto)
        with _lock:
            _state.update(status="done", result=result, error=None,
                          finished_at=datetime.now(UTC).isoformat())
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state.update(status="error", error=str(exc),
                          finished_at=datetime.now(UTC).isoformat())
        scan_progress.set_stage("error")
        try:
            write_scan_failure(db, exc)   # el informe persistido sí sobrevive a reinicios
        except Exception:
            pass
    finally:
        db.close()


def start(sample_size: int | None = None, decide: bool = True,
         force_mid_layer: bool = False, llm_overrides: dict | None = None,
         reutilizar_ultima_foto: bool = False) -> bool:
    """Arranca el escaneo si no hay uno en marcha. Devuelve True si lo lanzó.

    `decide=False` (botón "simulación" de Sala Real): universo completo, escanea y
    persiste ranking/watchlist/memoria/traza — TODO menos tocar la cartera. `force_mid_layer`
    hace que ese escaneo sea el circuito EXACTO de un mensual real (capa media incluida) sin
    tocar el comportamiento del cron semanal automático. `llm_overrides`: config por etapa
    (modelo/reasoning/temperature/top_p) del modal de la simulación — ver `run_scan_and_store`.
    `reutilizar_ultima_foto`: checkbox de los dos modales — ver `run_scan_and_store`.
    """
    with _lock:
        if _state["status"] == "running":
            return False
        _state.update(status="running", started_at=datetime.now(UTC).isoformat(),
                      finished_at=None, result=None, error=None)
    threading.Thread(target=_run, args=(sample_size, decide, force_mid_layer, llm_overrides,
                                        reutilizar_ultima_foto),
                     daemon=True).start()
    return True
