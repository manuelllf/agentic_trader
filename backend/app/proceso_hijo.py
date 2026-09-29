"""Trabajos pesados en un proceso aparte, para que su memoria vuelva al sistema al terminar.

El proceso de la web casi nunca devuelve al sistema lo que libera tras un trabajo grande; uno
hijo sí, porque al morir se lo lleva todo. Hablan por líneas JSON: el padre manda los
argumentos (y "cancelar" si hace falta) y el hijo devuelve el progreso, el resultado o el error.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import subprocess
import sys
import threading
import time
from decimal import Decimal
from pathlib import Path

from app import recursos

logger = logging.getLogger(__name__)

_RAIZ = Path(__file__).resolve().parent.parent
# `-c` y no `-m app.proceso_hijo`: como script este módulo sería `__main__` y una segunda copia
# distinta de sí mismo, y el `Cancelado` que lanzan las tareas no sería el que se captura aquí.
_ARRANQUE = "from app.proceso_hijo import principal; principal()"
_PERIODO_ESTADO_S = 1.0


class Cancelado(RuntimeError):
    """El trabajo paró porque se pidió: no es un fallo."""


class ProcesoHijoError(RuntimeError):
    """El trabajo falló dentro del hijo; `tipo` es el nombre de la excepción original."""

    def __init__(self, mensaje: str, tipo: str | None = None) -> None:
        super().__init__(mensaje)
        self.tipo = tipo


# ---- lado del padre ---------------------------------------------------------------------------

def _vigilar_cancelacion(proc: subprocess.Popen, cancel_event: threading.Event,
                         terminado: threading.Event) -> None:
    while not terminado.is_set():
        if cancel_event.wait(0.5):
            try:
                proc.stdin.write("cancelar\n")
                proc.stdin.flush()
            except (OSError, ValueError):
                pass                          # el hijo ya no está: nada que cancelar
            return


def _linea_json(linea: str) -> dict | None:
    try:
        msg = json.loads(linea)
    except json.JSONDecodeError:
        logger.warning("El proceso hijo dijo algo que no es JSON: %.200s", linea.rstrip())
        return None
    return msg if isinstance(msg, dict) else None


def ejecutar(tarea: str, args: dict | None = None, *,
             cancel_event: threading.Event | None = None,
             on_estado=None):  # noqa: ANN001, ANN201
    """Corre `tarea` ("modulo:funcion", que recibe `(args, cancelado)`) en un proceso nuevo y
    espera su resultado. `on_estado` recibe el progreso que va contando el hijo. Lanza
    `Cancelado` si se paró a petición y `ProcesoHijoError` si falló o murió sin contestar."""
    inicio = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, "-c", _ARRANQUE, tarea], cwd=_RAIZ, text=True, encoding="utf-8",
        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    terminado = threading.Event()
    final: dict | None = None
    try:
        proc.stdin.write(json.dumps(args or {}, default=_json) + "\n")
        proc.stdin.flush()
        if cancel_event is not None:
            threading.Thread(target=_vigilar_cancelacion, args=(proc, cancel_event, terminado),
                             daemon=True).start()
        for linea in proc.stdout:
            msg = _linea_json(linea)
            if msg is None:
                continue
            if msg.get("t") == "estado":
                if on_estado is not None:
                    on_estado(msg["v"])
            else:
                final = msg
    except BaseException:
        proc.kill()
        raise
    finally:
        terminado.set()
        codigo = proc.wait()
        proc.stdout.close()
        try:
            proc.stdin.close()
        except OSError:
            pass                              # tubería rota: el hijo ya murió

    if final is None:
        raise ProcesoHijoError(
            f"El proceso de {tarea} terminó sin dar resultado (código {codigo}).")
    if final["t"] == "cancelado":
        raise Cancelado(final.get("msg", "Trabajo cancelado."))
    if final["t"] == "error":
        raise ProcesoHijoError(final.get("msg", "Error sin mensaje."), final.get("tipo"))
    pico = final.get("pico_mb")
    logger.info("Proceso hijo %s: %.0f s%s", tarea, time.monotonic() - inicio,
                "" if pico is None else f", pico de memoria {pico:.0f} MB")
    return final.get("v")


# ---- lado del hijo ----------------------------------------------------------------------------

def _json(o):  # noqa: ANN001, ANN202
    return float(o) if isinstance(o, Decimal) else str(o)


class _Canal:
    """La salida hacia el padre. Tras el mensaje final no sale nada más: un progreso rezagado
    no puede pisar el resultado."""

    def __init__(self, salida) -> None:  # noqa: ANN001
        self._salida = salida
        self._lock = threading.Lock()
        self._cerrado = False

    def enviar(self, msg: dict, final: bool = False) -> None:
        with self._lock:
            if self._cerrado:
                return
            self._cerrado = final
            try:
                self._salida.write(json.dumps(msg, default=_json) + "\n")
                self._salida.flush()
            except OSError:
                pass                          # el padre ya no escucha


def _escuchar_padre(cancelado: threading.Event) -> None:
    for linea in sys.stdin:
        if linea.strip() == "cancelar":
            cancelado.set()
    cancelado.set()                           # tubería cerrada: el padre murió, nadie recogerá nada


def _bombear_estado(canal: _Canal) -> None:
    from app import scan_progress

    ultimo = None
    while True:
        actual = scan_progress.snapshot()
        if actual != ultimo:
            canal.enviar({"t": "estado", "v": actual})
            ultimo = actual
        time.sleep(_PERIODO_ESTADO_S)


def _resolver(tarea: str):  # noqa: ANN202
    modulo, _, funcion = tarea.partition(":")
    return getattr(importlib.import_module(modulo), funcion)


def principal() -> None:
    """Punto de entrada del hijo: `python -c` con el nombre de la tarea en `argv[1]`."""
    from app.liga.filtro_logs import instalar as instalar_filtro_logs

    canal = _Canal(sys.stdout)
    sys.stdout = sys.stderr                   # lo que la tarea imprima va al log, no al canal
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    instalar_filtro_logs()

    args = json.loads(sys.stdin.readline() or "{}")
    cancelado = threading.Event()
    threading.Thread(target=_escuchar_padre, args=(cancelado,), daemon=True).start()
    threading.Thread(target=_bombear_estado, args=(canal,), daemon=True).start()
    try:
        valor = _resolver(sys.argv[1])(args, cancelado)
        final = {"t": "ok", "v": valor, "pico_mb": recursos.pico_mb()}
    except Cancelado as exc:
        final = {"t": "cancelado", "msg": str(exc)}
    except BaseException as exc:  # noqa: BLE001 — lo que sea, el padre tiene que enterarse
        logger.exception("Falló el proceso hijo %s", sys.argv[1])
        final = {"t": "error", "tipo": type(exc).__name__, "msg": str(exc) or type(exc).__name__}
    from app import scan_progress

    canal.enviar({"t": "estado", "v": scan_progress.snapshot()})
    canal.enviar(final, final=True)
    logging.shutdown()
    # `os._exit`: un hilo de otra librería sin cerrar no puede dejar el proceso vivo reteniendo
    # justo la memoria que todo esto quiere devolver.
    os._exit(0)
