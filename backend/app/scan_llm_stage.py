"""Config efectiva de cada etapa del escaneo (override del modal, si no el default de
`settings`) y a qué proveedor la manda (DeepSeek salvo que pida Qwen explícitamente, o sea el
prescore con `prescore_provider=qwen` por defecto de producción)."""
from __future__ import annotations

from app.config import settings
from app.llm import get_llm

DEFAULT_TEMPERATURE = 0.3
DEFAULT_TOP_P = 0.95
# Se mandan en TODAS las etapas, tengan o no razonamiento activo — decisión explícita: aunque
# api-docs.deepseek.com/guides/thinking_mode diga que el modo razonamiento ignora
# `temperature`/`top_p`, no cuesta nada mandarlos igual (el campo se ignora, no rompe la
# llamada) y así el comportamiento no depende de qué reasoning tenga cada etapa hoy — si mañana
# alguna pasa a "none", ya lleva puestos los mismos valores que el resto sin tocar nada aquí.


def _stage_cfg(overrides: dict | None, stage: str, default_model: str,
              default_reasoning: str | None,
              default_temperature: float = DEFAULT_TEMPERATURE) -> dict:
    """Config efectiva de una etapa: lo que mande `overrides[stage]` gana, si no el default de
    `settings` (modelo/reasoning) o `DEFAULT_TEMPERATURE`/`DEFAULT_TOP_P` (muestreo)."""
    o = (overrides or {}).get(stage) or {}
    return {
        "model": o.get("model") or default_model,
        "reasoning_effort": o.get("reasoning_effort", default_reasoning),
        "temperature": o.get("temperature", default_temperature),
        "top_p": o.get("top_p", DEFAULT_TOP_P),
    }


def _quiere_reasoning_qwen(reasoning_effort: str | None) -> bool:
    """Qwen no tiene niveles (low/high/max) como DeepSeek, solo on/off — cualquier cosa que no
    sea "none"/None del modal (que solo ofrece dos opciones para Qwen, ver ScanConfigModal) se
    interpreta como razonamiento activo."""
    return reasoning_effort not in (None, "none")


def _llm_for(cfg: dict, stage: str = "", recorder=None):  # noqa: ANN001
    """`get_llm()` con el `model` de la config, PERO solo como argumento posicional cuando hay
    uno de verdad (override, o default de etapa como `prescore_model`/`mid_model`) — igual que
    las llamadas de antes de este refactor. Sin esto, macro/deep/constructor (que antes NO
    pasaban `model` en absoluto, cayendo al default interno de `get_llm()`) pasarían a llamarlo
    siempre con un positional (aunque fuera `None`), cambiando la ARIDAD de la llamada — de lo
    que dependen los fakes de test que distinguen la etapa mirando `*args` (ver
    `test_cadence.py::test_profundo_no_parseable_...`).

    Enruta a Qwen en CUALQUIER etapa cuando el modelo elegido es `settings.qwen_model` — antes
    pedir Qwen fuera del prescore mandaba su nombre a DeepSeek en vez de al proveedor correcto."""
    if cfg["model"] == settings.qwen_model and settings.dashscope_api_key:
        return get_llm(cfg["model"], reasoning_effort=cfg["reasoning_effort"], stage=stage,
                       recorder=recorder, provider="qwen",
                       enable_thinking=_quiere_reasoning_qwen(cfg["reasoning_effort"]))
    if cfg["model"]:
        return get_llm(cfg["model"], reasoning_effort=cfg["reasoning_effort"],
                       stage=stage, recorder=recorder)
    return get_llm(reasoning_effort=cfg["reasoning_effort"], stage=stage, recorder=recorder)


def _prescore_llm(cfg: dict, tiene_override: bool, recorder=None):  # noqa: ANN001
    """Como `_llm_for`, pero el prescore además tiene un default de PRODUCCIÓN a Qwen
    (`settings.prescore_provider`) cuando no hay override del modal — el resto de etapas no
    tienen ese concepto, van a DeepSeek salvo que el modal pida Qwen explícitamente."""
    if not tiene_override and settings.prescore_provider == "qwen" and settings.dashscope_api_key:
        return get_llm(settings.qwen_model, reasoning_effort=cfg["reasoning_effort"],
                       stage="prescore", recorder=recorder, provider="qwen",
                       enable_thinking=_quiere_reasoning_qwen(cfg["reasoning_effort"]))
    return _llm_for(cfg, "prescore", recorder)


def _sampling_kwargs(cfg: dict) -> dict:
    """`temperature`/`top_p` de la config efectiva (override o `DEFAULT_TEMPERATURE`/
    `DEFAULT_TOP_P`, ver `_stage_cfg`) — nunca None, así que siempre van al `llm.chat()` de la
    etapa, tenga o no razonamiento activo."""
    kw = {}
    if cfg.get("temperature") is not None:
        kw["temperature"] = cfg["temperature"]
    if cfg.get("top_p") is not None:
        kw["top_p"] = cfg["top_p"]
    return kw
