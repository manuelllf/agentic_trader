"""Capa 2 · proveedores de LLM.

Misma filosofía que `data/` y `brokers/`: una interfaz (`LLMProvider`) y factory que
devuelve la implementación configurada. Hoy OpenRouter/DeepSeek; mañana Ollama o Claude
sin tocar los agentes.
"""

from __future__ import annotations

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.openrouter import OpenRouterProvider


def get_llm(model: str | None = None) -> LLMProvider:
    """Proveedor LLM (V4-Pro por defecto). Lanza si falta la key."""
    if not settings.openrouter_api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY no configurada. Ponla en backend/.env para usar el LLM."
        )
    return OpenRouterProvider(
        api_key=settings.openrouter_api_key,
        model=model or settings.llm_model,
        base_url=settings.openrouter_base_url,
    )
