"""Moderación de alias, nombres de estrategia y de liga, y la pregunta propia: lista de bloqueo
al guardar, y lo demás lo revisa una persona desde los reportes."""

from __future__ import annotations

from fastapi import HTTPException

from app.liga.ia.bloqueo import tiene_bloqueada


def evaluar_lista(texto: str) -> None:
    """422 si el texto coincide con la lista de bloqueo. Va dentro de la petición, así que la
    transacción de la ruta se deshace entera."""
    if tiene_bloqueada(texto):
        raise HTTPException(422, "Ese nombre no está permitido.")
