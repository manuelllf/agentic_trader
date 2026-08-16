"""Cliente de la API oficial de DeepSeek (formato OpenAI, sin OpenRouter de por medio).

Mismo formato `/chat/completions` que OpenRouter, con tres diferencias reales confirmadas
contra api-docs.deepseek.com (no asumidas):
  1. `reasoning_effort` va en el NIVEL SUPERIOR del payload ("reasoning_effort": "high"), no
     anidado bajo "reasoning" como en OpenRouter.
  2. Sin concepto de `provider.ignore` — es un solo proveedor, no hay entre quién enrutar.
  3. El `usage` de la respuesta separa `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`
     (caché en disco automática, sin pedirla) en vez de un `cost` ya facturado — el coste se
     estima aquí con la tarifa oficial de cada tramo.
"""

from __future__ import annotations

import copy
import json
import logging

import httpx

logger = logging.getLogger(__name__)

# OpenRouterProvider envuelve la llamada en un ThreadPoolExecutor propio POR LLAMADA porque su
# timeout de httpx no siempre saltaba (goteo de keep-alive de alguno de los ~28 proveedores
# detrás del alias). AQUÍ NO se replica ese patrón — medido en vivo que es contraproducente:
# con alta concurrencia (500 hilos de prescore) cada llamada abría OTRO hilo para el wrapper,
# duplicando el pico real de hilos del proceso (hasta ~1.000, el tope del cgroup del contenedor)
# y provocando un 98% de fallos por agotamiento de hilos, no por la API. DeepSeek directo es UN
# proveedor, no 28 — se confía en el timeout normal de httpx, sin hilo extra.
_HARD_TIMEOUT = 180.0

# USD por 1M de tokens: (input cache-miss, input cache-hit, output). Confirmado en
# api-docs.deepseek.com/quick_start/pricing. La caché de prefijo es automática (sin pedirla) —
# el ahorro depende de que el prompt repita un prefijo idéntico entre llamadas (ver
# `scorer.prescore_one`/`mid_prescore`/`score`, que ponen el bloque macro constante delante del
# contenido variable del ticker).
_PRICING: dict[str, tuple[float, float, float]] = {
    "deepseek-v4-pro": (0.435, 0.003625, 0.87),
    "deepseek-v4-flash": (0.14, 0.0028, 0.28),
}


class DeepSeekProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.deepseek.com",
        reasoning_effort: str | None = None,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        # None = no se manda el campo → el proveedor usa su default documentado ("high").
        # Valores válidos: low/high/max (confirmado en api-docs.deepseek.com/guides/thinking_mode,
        # "none" también existe para desactivar el razonamiento del todo, sin uso hoy).
        self._reasoning_effort = reasoning_effort
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._usage = {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost_usd": 0.0,
            "by_model": {},
        }

    @property
    def usage(self) -> dict:
        return copy.deepcopy(self._usage)

    def _account(self, usage: dict | None) -> None:
        if not usage:
            return
        pt = int(usage.get("prompt_tokens", 0) or 0)
        ct = int(usage.get("completion_tokens", 0) or 0)
        hit = int(usage.get("prompt_cache_hit_tokens", 0) or 0)
        miss = int(usage.get("prompt_cache_miss_tokens", 0) or pt - hit)
        pin_miss, pin_hit, pout = _PRICING.get(self._model, (0.0, 0.0, 0.0))
        cost = (miss * pin_miss + hit * pin_hit + ct * pout) / 1_000_000
        self._usage["calls"] += 1
        self._usage["prompt_tokens"] += pt
        self._usage["completion_tokens"] += ct
        self._usage["cost_usd"] += cost
        by_model = self._usage["by_model"].setdefault(
            self._model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}
        )
        by_model["calls"] += 1
        by_model["prompt_tokens"] += pt
        by_model["completion_tokens"] += ct
        by_model["cost_usd"] += cost

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        if top_p is not None:
            payload["top_p"] = top_p
        if self._reasoning_effort:
            payload["reasoning_effort"] = self._reasoning_effort

        # `timeout` de httpx aplica al connect Y al read — un `_HARD_TIMEOUT` generoso (180s)
        # directamente en el cliente, sin hilo ni executor de por medio.
        with httpx.Client(timeout=_HARD_TIMEOUT) as client:
            resp = client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            crudo = resp.content
        data = json.loads(crudo.decode("utf-8"))
        self._account(data.get("usage"))
        return data["choices"][0]["message"]["content"] or ""


def account_balance_usd(api_key: str, base_url: str = "https://api.deepseek.com") -> float | None:
    """Saldo REAL de la cuenta (USD), consultado en vivo — no una estimación por tokens.

    `GET /user/balance`, endpoint aparte del de chat (confirmado en api-docs.deepseek.com): la
    respuesta de una llamada de chat solo trae tokens, nunca un coste ya facturado (a diferencia
    de OpenRouter con `usage.include`). Comparar el saldo antes/después de un escaneo da el coste
    real de esa tirada sin depender de `_PRICING` (que es solo un respaldo para `ScanRun.cost`
    mientras el escaneo corre). None si falla o no hay currency USD — best-effort, no debe
    romper el escaneo por un fallo de este endpoint aparte.
    """
    try:
        resp = httpx.get(
            f"{base_url.rstrip('/')}/user/balance",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        resp.raise_for_status()
        for info in resp.json().get("balance_infos", []):
            if info.get("currency") == "USD":
                return float(info["total_balance"])
    except Exception:
        logger.warning("No se pudo consultar el saldo real de DeepSeek.", exc_info=True)
    return None
