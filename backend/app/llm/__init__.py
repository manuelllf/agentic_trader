"""Capa 2 · proveedores de LLM.

Misma filosofía que `data/` y `brokers/`: una interfaz (`LLMProvider`) y factory que
devuelve la implementación configurada. `settings.llm_provider` decide cuál: "deepseek"
(API oficial, producción) por defecto, "openrouter" solo para pruebas puntuales locales.
"""

from __future__ import annotations

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.deepseek import DeepSeekProvider
from app.llm.openrouter import _PROVEEDORES_EXCLUIDOS_0731, OpenRouterProvider


def get_llm(model: str | None = None, reasoning_effort: str | None = None) -> LLMProvider:
    """Proveedor LLM. Lanza si falta la key del proveedor configurado.

    `reasoning_effort` por defecto es `None` (el proveedor decide, "high" documentado en
    DeepSeek) — el caller del constructor lo sobreescribe explícitamente con
    `settings.reasoning_effort` ("max"), el único sitio que lo necesita hoy.
    """
    if settings.llm_provider == "openrouter":
        if not settings.openrouter_api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY no configurada. Ponla en backend/.env para usar el LLM."
            )
        modelo = model or settings.llm_model
        # La exclusión de proveedores se midió sobre este alias de OpenRouter; no aplica al
        # circuito oficial de DeepSeek, que no tiene sub-proveedores que excluir.
        ignorar = _PROVEEDORES_EXCLUIDOS_0731 if "flash-0731" in modelo else None
        return OpenRouterProvider(
            api_key=settings.openrouter_api_key,
            model=modelo,
            base_url=settings.openrouter_base_url,
            reasoning_effort=reasoning_effort,
            provider_ignore=ignorar,
        )

    if not settings.deepseek_api_key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY no configurada. Ponla en backend/.env (o en Railway) para usar "
            "el LLM."
        )
    return DeepSeekProvider(
        api_key=settings.deepseek_api_key,
        model=model or settings.llm_model,
        base_url=settings.deepseek_base_url,
        reasoning_effort=reasoning_effort,
    )
