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
from app.llm.qwen import QwenProvider


def get_llm(model: str | None = None, reasoning_effort: str | None = "none",
            stage: str = "", recorder=None, provider: str | None = None) -> LLMProvider:  # noqa: ANN001
    """Proveedor LLM. Lanza si falta la key del proveedor configurado.

    `reasoning_effort` por defecto es `"none"` — sin mandarlo, el proveedor cae a su default
    ("high") y dispara el coste en las etapas de volumen.

    `provider`: override puntual SOLO para que `scan_service._prescore_llm` pida Qwen sin tocar
    el resto del circuito. `model` se ignora en la rama "qwen" (un único modelo configurado)."""
    if (provider or settings.llm_provider) == "qwen":
        if not settings.dashscope_api_key:
            raise RuntimeError(
                "DASHSCOPE_API_KEY no configurada. Ponla en backend/.env (o en Railway) para "
                "usar Qwen."
            )
        return QwenProvider(
            api_key=settings.dashscope_api_key,
            model=settings.qwen_model,
            stage=stage,
            recorder=recorder,
        )

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
        stage=stage,
        recorder=recorder,
    )
