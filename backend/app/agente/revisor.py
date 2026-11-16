"""Revisor independiente: juzga decisiones, lecciones y cambios de filosofía. Sin historial."""

from __future__ import annotations

import json
from typing import Any

from app.agente import prompts

_VEREDICTOS = {"approve": "aprobada", "reject": "rechazada", "revise": "corregir"}
_INVALIDO = ("rechazada", "respuesta del revisor no válida")


def _dump(x: Any) -> str:  # noqa: ANN401
    return json.dumps(x, ensure_ascii=False, default=str)


def juzgar(system: str, usuario: str, llm: Any,  # noqa: ANN401
           *, admite_corregir: bool = False) -> tuple[str, str]:
    """(veredicto, motivo); cualquier respuesta rara cuenta como rechazo. Donde no cabe una
    corrección (lecciones, propuestas), «revise» también es rechazo."""
    try:
        r = json.loads(llm.chat(system, usuario))
        veredicto = _VEREDICTOS[str(r["verdict"]).strip().lower()]
        motivo = str(r.get("reason", "")).strip()
    except (ValueError, KeyError, TypeError, AttributeError):
        return _INVALIDO
    if veredicto == "corregir" and not admite_corregir:
        return "rechazada", motivo
    return veredicto, motivo


def revisar(decision: dict, filosofia: str, datos: list[dict], llm: Any) -> tuple[str, str]:  # noqa: ANN401
    usuario = (f"## Written philosophy\n{filosofia}\n\n"
               f"## Decision to review\n{_dump(decision)}\n\n"
               f"## Data the manager looked at\n{_dump(datos)}\n")
    return juzgar(prompts.SYSTEM_REVISOR, usuario, llm, admite_corregir=True)
