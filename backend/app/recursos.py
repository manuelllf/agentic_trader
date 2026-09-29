"""Recursos del contenedor: las CPUs que le tocan de verdad y la memoria que ocupa el proceso."""

from __future__ import annotations

import functools
import logging
import math
import os
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

_CUOTA_CPU = Path("/sys/fs/cgroup/cpu.max")
_TOPE_HILOS_CALCULO = 4
# Por debajo de esto una variación de memoria es ruido y no merece línea en el log.
_AVISO_MB = 25


def cpus_reales() -> int:
    """CPUs de la cuota del contenedor. `os.cpu_count()` ve las de la máquina entera (48 en
    Railway aunque el plan dé 8), y todo lo que dimensiona hilos con él se pasa."""
    try:
        cuota, periodo = _CUOTA_CPU.read_text().split()
        if cuota != "max":
            return max(1, math.ceil(int(cuota) / int(periodo)))
    except (OSError, ValueError):
        pass
    return os.cpu_count() or 1


def hilos_calculo() -> int:
    """Hilos para cálculo en paralelo (embeddings, DuckDB): cada uno reserva sus buffers."""
    return min(cpus_reales(), _TOPE_HILOS_CALCULO)


def _campo_status(nombre: str) -> int | None:
    """Campo numérico de /proc/self/status; None donde no existe (Windows)."""
    try:
        with open("/proc/self/status") as f:
            for linea in f:
                if linea.startswith(nombre + ":"):
                    return int(linea.split()[1])
    except (OSError, ValueError):
        pass
    return None


def rss_mb() -> float | None:
    kb = _campo_status("VmRSS")
    return None if kb is None else kb / 1024


def pico_mb() -> float | None:
    kb = _campo_status("VmHWM")
    return None if kb is None else kb / 1024


def medido(nombre: str) -> Callable:
    """Decorador para los trabajos programados: deja en el log cuánta memoria ganó o soltó el
    proceso al terminar. Sin esto no hay forma de saber cuál de ellos engorda el servicio."""
    def decorador(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def envuelta(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
            antes = rss_mb()
            try:
                return fn(*args, **kwargs)
            finally:
                despues = rss_mb()
                if antes is not None and despues is not None and abs(despues - antes) >= _AVISO_MB:
                    logger.info("Memoria tras %s: %.0f → %.0f MB (%+.0f)",
                                nombre, antes, despues, despues - antes)
        return envuelta
    return decorador


def registrar_estado() -> None:
    """Una línea con la memoria y los hilos del proceso: la serie que permite ver si sube."""
    rss = rss_mb()
    if rss is not None:
        logger.info("Memoria del proceso: %.0f MB, %s hilos", rss, _campo_status("Threads"))
