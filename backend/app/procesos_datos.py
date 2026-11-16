"""Candado común de los procesos de datos del panel: solo uno corre a la vez.

Antes cada proceso se miraba solo con los dos o tres que conocía (la foto con el escaneo, la poda
con ambos) y el universo global, las tasas de cambio y la analítica no se miraban con nadie. Aquí
queda una sola pregunta, `en_marcha()`, que consulta el estado de todos, y una sola puerta,
`lanzar()` / `exclusivo()`, que pregunta y arranca bajo el mismo cerrojo para que dos peticiones
seguidas no pasen las dos. El cron no se bloquea: se anota con `marcar()` para que se vea y para
que un lanzamiento a mano espere a que acabe.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

# Procesos que corren en un hilo propio y llevan su estado: (id, módulo con `get_status`).
_CON_ESTADO = ("escaneo", "fund", "global", "poda")

_guardia = threading.Lock()
_sincronos: dict[str, dict] = {}   # procesos que viven dentro de una petición o de un job


class Ocupado(RuntimeError):
    """Ya hay otro proceso en marcha; `proceso` es el id del que ocupa el sitio."""

    def __init__(self, proceso: str) -> None:
        super().__init__(proceso)
        self.proceso = proceso


def _estado_de(proceso: str) -> dict:
    # Import perezoso: estos módulos importan de aquí abajo en sus propios arranques.
    from app import foto_service, pipeline, poda
    from app.screener import universe_global

    modulo = {"escaneo": pipeline, "fund": foto_service, "global": universe_global,
              "poda": poda}[proceso]
    return modulo.get_status()


def en_marcha() -> dict | None:
    """El proceso que ocupa el sitio ahora: `{"id", "desde"}`, o None si está libre."""
    for proceso in _CON_ESTADO:
        estado = _estado_de(proceso)
        if estado["status"] == "running":
            return {"id": proceso, "desde": estado.get("started_at")}
    for nombre, info in _sincronos.items():
        return {"id": nombre, "desde": info["desde"]}
    return None


def progreso(proceso: str) -> dict | None:
    """Cuánto lleva un proceso en marcha, si lo cuenta: `{"hechas", "total", "unidad"}`."""
    from app import scan_progress

    if proceso in ("escaneo", "fund"):
        s = scan_progress.snapshot()
        if not s["total"]:
            return None
        return {"hechas": s["done"], "total": s["total"], "unidad": s["unit"]}
    if proceso == "poda":
        s = _estado_de("poda")
        if not s["total"]:
            return None
        return {"hechas": s["hechas"], "total": s["total"], "unidad": "llamadas"}
    return None


def lanzar(proceso: str, arrancar: Callable[[], bool]) -> None:
    """Arranca un proceso de fondo si el sitio está libre. `arrancar` devuelve False si su propio
    módulo lo rechaza (otra vez el mismo proceso): también es Ocupado."""
    with _guardia:
        otro = en_marcha()
        if otro:
            raise Ocupado(otro["id"])
        if not arrancar():
            raise Ocupado(proceso)


def _anotar(proceso: str) -> None:
    info = _sincronos.setdefault(proceso, {"n": 0, "desde": datetime.now(UTC).isoformat()})
    info["n"] += 1


def _quitar(proceso: str) -> None:
    with _guardia:
        info = _sincronos.get(proceso)
        if info is None:
            return
        info["n"] -= 1
        if info["n"] <= 0:
            del _sincronos[proceso]


@contextmanager
def exclusivo(proceso: str) -> Iterator[None]:
    """Ocupa el sitio mientras dura un proceso que trabaja dentro de la propia petición."""
    with _guardia:
        otro = en_marcha()
        if otro:
            raise Ocupado(otro["id"])
        _anotar(proceso)
    try:
        yield
    finally:
        _quitar(proceso)


@contextmanager
def marcar(proceso: str) -> Iterator[None]:
    """Anota un job del cron sin esperar ni rechazar: el cron manda, pero se ve y bloquea a mano."""
    with _guardia:
        _anotar(proceso)
    try:
        yield
    finally:
        _quitar(proceso)


# Qué trabajo registrado del scheduler lanza cada proceso. Fundamentales y poda son solo a mano.
_TRABAJOS = {"foto": "universe_snapshot", "global": "universo_global", "fund": None,
             "fx": "fx_sync", "analitica": "analytics_sync", "poda": None}


def horario() -> dict:
    """Cuándo se lanza solo cada proceso, leído de los trabajos registrados en el scheduler."""
    from app import scheduler as scheduler_mod
    from app.config import settings

    trabajos = {j.id: j for j in scheduler_mod.scheduler.get_jobs()}
    procesos = []
    for proceso, trabajo_id in _TRABAJOS.items():
        trabajo = trabajos.get(trabajo_id) if trabajo_id else None
        entrada: dict = {"proceso": proceso, "automatico": trabajo is not None}
        if trabajo is not None:
            campos = {c.name: str(c) for c in getattr(trabajo.trigger, "fields", [])}
            proxima = getattr(trabajo, "next_run_time", None)
            entrada.update(
                dias_semana=campos.get("day_of_week", "*"), dia_mes=campos.get("day", "*"),
                horas=campos.get("hour", "*"), minuto=campos.get("minute", "0"),
                zona=str(trabajo.trigger.timezone),
                proxima=proxima.isoformat() if proxima else None)
        procesos.append(entrada)
    return {"scheduler_activo": settings.enable_scheduler, "procesos": procesos}
