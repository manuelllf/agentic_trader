"""Tareas que los tests de `proceso_hijo` mandan al hijo, que las importa por nombre."""

from __future__ import annotations

import os
import threading
import time

from app import scan_progress
from app.proceso_hijo import Cancelado


def suma(args: dict, cancelado: threading.Event) -> dict:  # noqa: ARG001
    scan_progress.set_stage("prescore", total=2, unit="lotes")
    scan_progress.tick(ok=True)
    print("ruido de una librería que escribe en stdout")
    return {"suma": args["a"] + args["b"]}


def falla(args: dict, cancelado: threading.Event) -> None:  # noqa: ARG001
    raise ValueError("no cuadra")


def hasta_que_cancelen(args: dict, cancelado: threading.Event) -> None:  # noqa: ARG001
    while not cancelado.is_set():
        time.sleep(0.05)
    raise Cancelado("paro pedido")


def muere_sin_avisar(args: dict, cancelado: threading.Event) -> None:  # noqa: ARG001
    os._exit(3)
