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
import queue
import threading
from datetime import UTC, datetime

from app import scan_progress
from app.db import SessionLocal

logger = logging.getLogger(__name__)

# Circuit breaker: fallos SEGUIDOS (se resetea a 0 en cuanto hay un éxito) antes de cortar la
# tanda entera. Un bloqueo real de Yahoo se ve como una racha sostenida, no fallos sueltos
# (medido en local, 24-ago-2026: a 6 hilos pasa de 100% a ~85% en un puñado de cientos de
# tickers una vez empieza) -- 100 seguidos no lo explica el ruido normal (deslistados sueltos).
_CORTE_FALLOS_SEGUIDOS = 100

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
            countries: list[str] | None = None,
            exchanges: list[str] | None = None) -> list[tuple[str, str | None]]:
    """(ticker, yahoo_symbol) -- `yahoo_symbol` solo viene relleno para `alcance=global` en
    mercados no-US (ver `universe_global._resolver_simbolos`); NASDAQ ya cotiza bare en Yahoo."""
    from app.screener import universe as universe_mod
    from app.screener import universe_global

    if alcance == "global":
        nombres = universe_global.simbolos(db, asset_type="Stock",
                                           countries=countries, exchanges=exchanges)
        if not nombres:
            raise RuntimeError("No hay universo global sincronizado todavía "
                               "(POST /admin/universo-global), o el filtro país/mercado no "
                               "encuentra ningún ticker.")
    else:
        tickers, info = universe_mod.universe_for_scan(db)
        if info["fuente"] == "seed":
            raise RuntimeError("Sin universo: NASDAQ no responde y no hay foto del cierre.")
        nombres = [(t, None) for t in tickers]
    return nombres[:limite] if limite else nombres


def capturar(db, alcance: str = "nasdaq", limite: int | None = None,  # noqa: ANN001
            countries: list[str] | None = None, exchanges: list[str] | None = None) -> dict:
    """Recorre el universo pedido y guarda una foto por nombre. No puntúa nada.

    Cola + workers (no `ThreadPoolExecutor.map`): con `.map` TODA la lista se lanza a la cola
    de una vez, así que un corte a mitad de tanda no frena los hilos ya en marcha. Con cola
    compartida, cada worker mira `corte` antes de coger el siguiente ticker -- el circuit
    breaker para peticiones de verdad, no solo deja de contar."""
    from app import scan_service
    from app.screener import fundamentals as fund_mod

    nombres = _tickers(db, alcance, limite, countries=countries, exchanges=exchanges)
    fund_mod._GATHER_PACE_S = scan_service._GATHER_PACE_S
    scan_progress.reset()
    scan_progress.set_stage("foto", total=len(nombres), unit="tickers")
    inicio = datetime.now(UTC)

    cola: queue.Queue[tuple[str, str | None]] = queue.Queue()
    for t in nombres:
        cola.put(t)

    stats_lock = threading.Lock()
    stats = {"ok": 0, "fallos": 0, "seguidos": 0}
    corte = threading.Event()
    motivo_corte: list[str] = []

    def _worker() -> None:
        while not corte.is_set():
            try:
                ticker, yahoo_symbol = cola.get_nowait()
            except queue.Empty:
                return
            data, err = fund_mod.gather(ticker, db=db, yahoo_symbol=yahoo_symbol)
            with stats_lock:
                if data is not None:
                    stats["ok"] += 1
                    stats["seguidos"] = 0
                else:
                    stats["fallos"] += 1
                    stats["seguidos"] += 1
                    if stats["seguidos"] >= _CORTE_FALLOS_SEGUIDOS and not corte.is_set():
                        corte.set()
                        motivo_corte.append(
                            f"{_CORTE_FALLOS_SEGUIDOS} fallos seguidos (último: {ticker}: {err})")
                scan_progress.tick(ok=data is not None,
                                   reason=f"{ticker}: {err}" if data is None else None)

    hilos = [threading.Thread(target=_worker, daemon=True)
             for _ in range(scan_service._GATHER_WORKERS)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    scan_progress.set_stage("done")

    dur = (datetime.now(UTC) - inicio).total_seconds()
    cortado = bool(motivo_corte)
    if cortado:
        logger.warning("Foto (%s) CORTADA: %s", alcance, motivo_corte[0])
    logger.info("Foto (%s): %d/%d nombres capturados en %.0fs.",
               alcance, stats["ok"], len(nombres), dur)
    return {"alcance": alcance, "pedidos": len(nombres), "capturados": stats["ok"],
            "sin_datos": stats["fallos"], "segundos": round(dur, 1),
            "at": inicio.isoformat(), "cortado": cortado,
            "motivo_corte": motivo_corte[0] if motivo_corte else None}


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
