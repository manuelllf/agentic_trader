"""Proveedor del LLM del gate de momentum, PERSISTIDO -- selector manual entre DeepSeek y Qwen
(14-sep-2026, día del apagón de DeepSeek que dejó el gate colgado horas: sin esto, la única
salida era esperar a que el proveedor volviera).

Genérico y sin failover automático a propósito, igual que el resto del LLM del proyecto (ver
`app/llm/__init__.py::get_llm`, que ya soporta este mismo `provider=` para Alpha): un fallo real
puede ser puntual o de horas, y decidir cuándo saltar al otro proveedor es juicio de Manuel, no
un reintento ciego que dobla el gasto si los dos están mal a la vez.

Mismo patrón que `scan_config.py` (`Meta` clave->valor): clave ausente = DeepSeek (el default de
`settings.llm_provider`), guardado = se queda así hasta que Manuel lo cambie, sin caducar solo."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Meta

_META_KEY = "momentum_gate_llm_provider"
PROVEEDORES = ("deepseek", "qwen")


def get_gate_provider(db: Session) -> str:
    """`"deepseek"` si no hay nada guardado (o el valor guardado no es válido)."""
    row = db.get(Meta, _META_KEY)
    if row and row.value in PROVEEDORES:
        return row.value
    return "deepseek"


def set_gate_provider(db: Session, provider: str) -> str:
    if provider not in PROVEEDORES:
        raise ValueError(f"Proveedor desconocido: {provider!r} (válidos: {PROVEEDORES}).")
    row = db.get(Meta, _META_KEY)
    if row:
        row.value = provider
    else:
        db.add(Meta(key=_META_KEY, value=provider))
    db.commit()
    return provider
