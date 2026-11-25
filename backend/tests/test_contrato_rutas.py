"""La lista de direcciones que sirve el backend, contra la que el frontend comprueba sus llamadas.

Tras añadir, quitar o renombrar una ruta se regenera con `ACTUALIZAR_CONTRATO=1`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI

from app.agente.servicio import app as agente
from app.main import app as vennett

_CONTRATO = Path(__file__).resolve().parents[2] / "frontend/src/lib/contrato/rutas.json"
_METODOS = {"get", "post", "put", "patch", "delete"}


def _rutas(app: FastAPI) -> list[str]:
    return sorted(f"{metodo.upper()} {ruta}" for ruta, operaciones in app.openapi()["paths"].items()
                  for metodo in operaciones if metodo in _METODOS)


def test_el_contrato_de_rutas_esta_al_dia() -> None:
    actual = {"agente": _rutas(agente), "vennett": _rutas(vennett)}
    if os.environ.get("ACTUALIZAR_CONTRATO"):
        _CONTRATO.parent.mkdir(parents=True, exist_ok=True)
        _CONTRATO.write_text(json.dumps(actual, indent=1) + "\n", encoding="utf-8", newline="\n")
    guardado = json.loads(_CONTRATO.read_text(encoding="utf-8"))
    for servicio, rutas in actual.items():
        nuevas = sorted(set(rutas) - set(guardado[servicio]))
        sobran = sorted(set(guardado[servicio]) - set(rutas))
        assert not nuevas and not sobran, (
            f"{servicio}: faltan en el contrato {nuevas} y sobran {sobran}. "
            "Regenéralo con ACTUALIZAR_CONTRATO=1.")
