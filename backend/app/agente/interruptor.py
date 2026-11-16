"""Cortacircuitos del proveedor de IA: tras N fallos seguidos deja de llamar durante una pausa
y después prueba con una sola llamada. Vive en memoria: un reinicio lo cierra, y es lo correcto."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from enum import StrEnum

from app.agente.config import ajustes


class EstadoInterruptor(StrEnum):
    CERRADO = "cerrado"
    ABIERTO = "abierto"
    PRUEBA = "prueba"


class EnPausa(Exception):
    """El interruptor está abierto: no se llama al proveedor."""

    def __init__(self, segundos_restantes: float) -> None:
        super().__init__(f"proveedor en pausa {segundos_restantes:.0f} s")
        self.segundos_restantes = segundos_restantes


class Interruptor:
    def __init__(self, fallos: int, pausa_s: float,
                 reloj: Callable[[], float] = time.monotonic) -> None:
        if fallos < 1 or pausa_s <= 0:
            raise ValueError("fallos >= 1 y pausa > 0")
        self._umbral, self._pausa, self._reloj = fallos, pausa_s, reloj
        self._fallos = 0
        self._abierto_desde: float | None = None
        self._probando = False
        self._cerrojo = threading.Lock()

    @property
    def estado(self) -> EstadoInterruptor:
        with self._cerrojo:
            return self._estado()

    def _estado(self) -> EstadoInterruptor:
        if self._abierto_desde is None:
            return EstadoInterruptor.CERRADO
        if self._reloj() - self._abierto_desde < self._pausa:
            return EstadoInterruptor.ABIERTO
        return EstadoInterruptor.PRUEBA

    def antes(self) -> None:
        """Deja pasar la llamada o lanza EnPausa. En prueba solo pasa una a la vez."""
        with self._cerrojo:
            estado = self._estado()
            if estado is EstadoInterruptor.CERRADO:
                return
            if estado is EstadoInterruptor.PRUEBA and not self._probando:
                self._probando = True
                return
            restante = self._pausa - (self._reloj() - (self._abierto_desde or 0.0))
            raise EnPausa(max(restante, 0.0))

    def exito(self) -> None:
        with self._cerrojo:
            self._fallos, self._abierto_desde, self._probando = 0, None, False

    def fallo(self) -> bool:
        """Anota un fallo; devuelve True si con él se abre (para avisar una sola vez)."""
        with self._cerrojo:
            if self._probando:
                # La llamada de prueba falló: otra pausa entera.
                self._probando = False
                self._abierto_desde = self._reloj()
                return True
            self._fallos += 1
            if self._abierto_desde is None and self._fallos >= self._umbral:
                self._abierto_desde = self._reloj()
                return True
            return False


# Uno por proceso, compartido por el agente y el revisor: los dos usan el mismo proveedor.
deepseek = Interruptor(ajustes.interruptor_fallos, ajustes.interruptor_pausa_min * 60.0)
