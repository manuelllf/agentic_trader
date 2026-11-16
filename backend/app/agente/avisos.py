"""Avisos del agente a la campana del panel de Vennett, entregados al menos una vez.
El aviso se anota en `agente.eventos` en la misma transacción que lo causa; se envía después
de confirmarla, y lo que no llegue se reintenta al terminar la siguiente tarea."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente.config import ajustes
from app.agente.models import Evento

logger = logging.getLogger(__name__)

AVISO = "aviso"
CERRADO = "aviso_cerrado"
LOTE = 20
RUTA = "/liga/admin/avisos/agente"
# El mismo patrón que valida Vennett: un tipo mal escrito se detecta aquí, no en la red.
_TIPO = re.compile(r"^agente_[a-z0-9_]{1,57}$")

Enviar = Callable[[str, dict[str, Any]], None]


def avisar(s: Session, tipo: str, datos: dict[str, Any] | None = None,
           ejecucion_id: int | None = None) -> None:
    if not _TIPO.match(tipo):
        raise ValueError(f"tipo de aviso no válido: {tipo}")
    s.add(Evento(origen="sistema", tipo=AVISO, datos={"tipo": tipo, "datos": datos or {}},
                 ejecucion_id=ejecucion_id))
    s.flush()


def pendientes(s: Session, limite: int = LOTE) -> list[tuple[int, dict[str, Any]]]:
    """Avisos sin cierre, del más antiguo al más nuevo. Eventos es de solo añadir: el cierre
    es otro evento que apunta al aviso."""
    s.flush()
    filas = s.execute(text(
        "select a.id, a.datos from agente.eventos a "
        "where a.origen = 'sistema' and a.tipo = :aviso and not exists ("
        "  select 1 from agente.eventos c where c.origen = 'sistema' and c.tipo = :cerrado "
        "  and (c.datos->>'aviso_id')::bigint = a.id) "
        "order by a.id limit :n"), {"aviso": AVISO, "cerrado": CERRADO, "n": limite}).all()
    return [(f.id, f.datos) for f in filas]


def configurado() -> bool:
    return bool(ajustes.vennett_url and ajustes.vennett_clave_servicio)


def enviar_http(tipo: str, datos: dict[str, Any]) -> None:
    resp = httpx.post(ajustes.vennett_url.rstrip("/") + RUTA, json={"tipo": tipo, "datos": datos},
                      headers={"X-Clave-Servicio": ajustes.vennett_clave_servicio},
                      timeout=ajustes.timeout_vennett_s)
    resp.raise_for_status()


def _definitivo(exc: Exception) -> bool:
    """Un 4xx (salvo 408 y 429) no se arregla reintentando: el aviso se cierra como rechazado."""
    if not isinstance(exc, httpx.HTTPStatusError):
        return False
    codigo = exc.response.status_code
    return 400 <= codigo < 500 and codigo not in (408, 429)


def _cerrar(s: Session, aviso_id: int, resultado: str) -> None:
    s.add(Evento(origen="sistema", tipo=CERRADO,
                 datos={"aviso_id": aviso_id, "resultado": resultado}))
    s.flush()


def entregar_pendientes(s: Session, enviar: Enviar | None = None) -> int:
    """Envía en orden; al primer fallo pasajero para, porque Vennett estará caído para todos."""
    if enviar is None:
        if not configurado():
            return 0
        enviar = enviar_http
    entregados = 0
    for aviso_id, datos in pendientes(s):
        try:
            enviar(str(datos["tipo"]), dict(datos.get("datos") or {}))
        except Exception as exc:  # noqa: BLE001 - cualquier fallo de red deja el aviso pendiente
            if _definitivo(exc):
                logger.error("Vennett rechaza el aviso %s: %s", aviso_id, exc)
                _cerrar(s, aviso_id, f"rechazado_{exc.response.status_code}")  # type: ignore[attr-defined]
                continue
            logger.warning("Aviso %s sin entregar, se reintenta luego: %s", aviso_id, exc)
            break
        _cerrar(s, aviso_id, "entregado")
        entregados += 1
    return entregados
