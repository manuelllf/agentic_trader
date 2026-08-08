"""Capa 2 · proveedores de LLM.

Misma filosofía que `data/` y `brokers/`: una interfaz (`LLMProvider`) y factory que
devuelve la implementación configurada. Hoy OpenRouter/DeepSeek; mañana Ollama o Claude
sin tocar los agentes.
"""

from __future__ import annotations

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.openrouter import _PROVEEDORES_EXCLUIDOS_0731, OpenRouterProvider


def get_llm(model: str | None = None) -> LLMProvider:
    """Proveedor LLM (V4-Pro por defecto). Lanza si falta la key."""
    if not settings.openrouter_api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY no configurada. Ponla en backend/.env para usar el LLM."
        )
    modelo = model or settings.llm_model
    # La exclusión de proveedores se midió sobre ESTE alias (ver openrouter.py); aplicarla a
    # v4-pro sería adivinar sin datos de su propio reparto de backends, así que se queda
    # acotada al modelo donde se comprobó.
    ignorar = _PROVEEDORES_EXCLUIDOS_0731 if "flash-0731" in modelo else None
    return OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=modelo,
        base_url=settings.openrouter_base_url,
        reasoning_effort=settings.reasoning_effort,
        provider_ignore=ignorar,
    )
