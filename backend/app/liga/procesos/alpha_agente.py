"""Cartera de la casa Alpha: se lee de la base del agente con un rol de solo lectura.

La Liga la pide y el agente no sabe que existe ni para qué se usa. Solo dos funciones de esa base
están a la vista (`agente.foto_cartera` y `agente.dia_cerrado`, migración agente_008).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import cache

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings

logger = logging.getLogger(__name__)


class SinLecturaAgente(Exception):
    """No hay manera de leer la cartera del agente; el mensaje no lleva credenciales."""


@dataclass(frozen=True)
class FotoAgente:
    """Lo que tenía el agente al cierre de un día. `posiciones`: (empresa, peso de 0 a 1 sobre lo
    invertido, sin la caja). `cierre_guardado`: el agente dejó anotado el valor de ese día, lo que
    solo hace con el cierre ya cargado."""

    posiciones: tuple[tuple[str, Decimal], ...]
    cierre_guardado: bool


Lector = Callable[[date], FotoAgente]


@cache
def _motor(url: str) -> Engine:
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return create_engine(url, pool_size=1, max_overflow=0, pool_pre_ping=True, pool_recycle=300,
                         connect_args={"connect_timeout": 5})


def leer(fecha: date) -> FotoAgente:
    url = settings.agente_lectura_url
    if not url:
        raise SinLecturaAgente(
            "Falta AGENTE_LECTURA_URL: no hay conexión con la cartera del agente")
    try:
        with _motor(url).connect() as cx:
            cerrado = bool(cx.execute(text("select agente.dia_cerrado(:f)"),
                                      {"f": fecha}).scalar_one())
            filas = cx.execute(text("select ticker, peso from agente.foto_cartera(:f)"),
                               {"f": fecha}).all()
    except SQLAlchemyError as e:
        # Solo el tipo de error: el mensaje del driver puede llevar el servidor y el usuario.
        logger.error("No se pudo leer la cartera del agente: %s", type(e).__name__)
        raise SinLecturaAgente(
            f"No se pudo leer la base del agente ({type(e).__name__})") from e
    return FotoAgente(tuple((t, Decimal(p)) for t, p in filas if p is not None), cerrado)
