"""Foto de fundamentales A DEMANDA, desacoplada del escaneo.

Existe para separar dos cosas que hasta ahora iban pegadas: RECOGER los datos y PUNTUARLOS. Con
esto se puede fotografiar el mercado a las 10:00 y lanzar el scoring off-peak a las 13:00 (la
mitad de tarifa), porque el escaneo reutiliza la foto de las últimas 24h en vez de volver a
pedirle todo a Yahoo (ver `fundamentals.foto_reciente`).

Ritmo real: 2 hilos y 0,4s de pausa por petición (los únicos valores validados contra el bloqueo
de Yahoo, ver `scan_service`) → ~3.000 nombres son ~20 min. El universo global de 63.000 son
horas, no minutos: por eso `limite` existe.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from app import scan_progress
from app.db import SessionLocal

logger = logging.getLogger(__name__)

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


def _tickers(db, alcance: str, limite: int | None,  # noqa: ANN001
            countries: list[str] | None = None, exchanges: list[str] | None = None) -> list[str]:
    from app.screener import universe as universe_mod
    from app.screener import universe_global

    if alcance == "global":
        nombres = universe_global.tickers(db, asset_type="Stock",
                                          countries=countries, exchanges=exchanges)
        if not nombres:
            raise RuntimeError("No hay universo global sincronizado todavía "
                               "(POST /admin/universo-global), o el filtro país/mercado no "
                               "encuentra ningún ticker.")
    else:
        nombres, info = universe_mod.universe_for_scan(db)
        if info["fuente"] == "seed":
            raise RuntimeError("Sin universo: NASDAQ no responde y no hay foto del cierre.")
    return nombres[:limite] if limite else nombres


def capturar(db, alcance: str = "nasdaq", limite: int | None = None,  # noqa: ANN001
            countries: list[str] | None = None, exchanges: list[str] | None = None) -> dict:
    """Recorre el universo pedido y guarda una foto por nombre. No puntúa nada."""
    from app import scan_service
    from app.screener import fundamentals as fund_mod

    nombres = _tickers(db, alcance, limite, countries=countries, exchanges=exchanges)
    fund_mod._GATHER_PACE_S = scan_service._GATHER_PACE_S
    scan_progress.reset()
    scan_progress.set_stage("foto", total=len(nombres), unit="tickers")
    inicio = datetime.now(UTC)

    ok = 0
    fallos: list[str] = []
    with ThreadPoolExecutor(max_workers=scan_service._GATHER_WORKERS) as ex:
        for ticker, (data, err) in zip(
            nombres, ex.map(lambda t: fund_mod.gather(t, db=db), nombres), strict=False
        ):
            if data is not None:
                ok += 1
            else:
                fallos.append(f"{ticker}: {err}")
            scan_progress.tick(ok=data is not None, reason=fallos[-1] if data is None else None)
    scan_progress.set_stage("done")

    dur = (datetime.now(UTC) - inicio).total_seconds()
    logger.info("Foto (%s): %d/%d nombres capturados en %.0fs.", alcance, ok, len(nombres), dur)
    return {"alcance": alcance, "pedidos": len(nombres), "capturados": ok,
            "sin_datos": len(fallos), "segundos": round(dur, 1),
            "at": inicio.isoformat()}


def _run(alcance: str, limite: int | None,
        countries: list[str] | None, exchanges: list[str] | None) -> None:
    db = SessionLocal()
    try:
        result = capturar(db, alcance=alcance, limite=limite,
                          countries=countries, exchanges=exchanges)
        with _lock:
            _state.update(status="done", result=result, error=None,
                          finished_at=datetime.now(UTC).isoformat())
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallo capturando la foto de fundamentales.")
        with _lock:
            _state.update(status="error", error=str(exc),
                          finished_at=datetime.now(UTC).isoformat())
        scan_progress.set_stage("error")
    finally:
        db.close()


def start(alcance: str = "nasdaq", limite: int | None = None,
         countries: list[str] | None = None, exchanges: list[str] | None = None) -> bool:
    """Lanza la captura en segundo plano. False si ya hay una foto o un escaneo en marcha
    (comparten `scan_progress` y el cupo de peticiones a Yahoo: solaparlos es pedir el 401)."""
    from app import pipeline

    with _lock:
        if _state["status"] == "running" or pipeline.get_status()["status"] == "running":
            return False
        _state.update(status="running", started_at=datetime.now(UTC).isoformat(),
                      finished_at=None, result=None, error=None)
    threading.Thread(target=_run, args=(alcance, limite, countries, exchanges),
                     daemon=True).start()
    return True
