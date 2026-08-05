"""Tests de contabilidad de coste del proveedor OpenRouter. Sin red: se llama a `_account()`
a mano con diccionarios de usage simulados, igual que si vinieran de dos modelos distintos
dentro del mismo escaneo (Flash barato en miles de llamadas, V4-Pro caro en decenas).
"""

from __future__ import annotations

from app.llm.openrouter import OpenRouterProvider


def test_account_totales_y_by_model_separan_dos_modelos() -> None:
    provider = OpenRouterProvider(api_key="fake", model="deepseek/deepseek-v4-flash-0731")

    # Llamada con coste REAL facturado por OpenRouter (modelo barato).
    provider._account({"prompt_tokens": 1000, "completion_tokens": 200, "cost": 0.001})

    # Cambiamos de modelo (como haría el escaneo al pasar del pre-score al profundo).
    provider._model = "deepseek/deepseek-v4-pro"
    provider._account({"prompt_tokens": 500, "completion_tokens": 300, "cost": 0.01})

    usage = provider.usage
    assert usage["calls"] == 2
    assert usage["prompt_tokens"] == 1500
    assert usage["completion_tokens"] == 500
    assert usage["cost_usd"] == 0.011

    assert set(usage["by_model"].keys()) == {
        "deepseek/deepseek-v4-flash-0731",
        "deepseek/deepseek-v4-pro",
    }
    flash = usage["by_model"]["deepseek/deepseek-v4-flash-0731"]
    assert flash == {
        "calls": 1,
        "prompt_tokens": 1000,
        "completion_tokens": 200,
        "cost_usd": 0.001,
    }
    pro = usage["by_model"]["deepseek/deepseek-v4-pro"]
    assert pro == {
        "calls": 1,
        "prompt_tokens": 500,
        "completion_tokens": 300,
        "cost_usd": 0.01,
    }


def test_usage_devuelve_copia_profunda() -> None:
    provider = OpenRouterProvider(api_key="fake", model="deepseek/deepseek-v4-pro")
    provider._account({"prompt_tokens": 100, "completion_tokens": 50, "cost": 0.001})

    usage = provider.usage
    usage["calls"] = 999
    usage["by_model"]["deepseek/deepseek-v4-pro"]["calls"] = 999

    assert provider.usage["calls"] == 1
    assert provider.usage["by_model"]["deepseek/deepseek-v4-pro"]["calls"] == 1


def test_fallback_de_precios_cuando_no_hay_coste_real() -> None:
    provider = OpenRouterProvider(api_key="fake", model="deepseek/deepseek-v4-flash-0731")

    # Sin "cost": debe estimar con la tabla _PRICING (0.09, 0.18 USD por 1M tokens).
    provider._account({"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000})

    usage = provider.usage
    assert usage["cost_usd"] == 0.09 + 0.18
    assert usage["by_model"]["deepseek/deepseek-v4-flash-0731"]["cost_usd"] == 0.09 + 0.18
