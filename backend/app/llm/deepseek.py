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
from concurrent.futures import ThreadPoolExecutor

import httpx

# Mismo cinturón de seguridad que OpenRouterProvider (ver su comentario): el timeout de httpx
# no siempre salta si el proveedor mantiene la conexión abierta sin devolver nada. Reutilizamos
# el mismo umbral porque mide el mismo síntoma (goteo de keep-alive), no algo específico de
# OpenRouter.
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
        timeout: float = 60.0,
        reasoning_effort: str | None = None,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
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

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        if self._reasoning_effort:
            payload["reasoning_effort"] = self._reasoning_effort

        def _pedir() -> bytes:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(
                    f"{self._base_url}/chat/completions",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                return resp.content

        # Ver OpenRouterProvider.chat: nada de `with ThreadPoolExecutor(...)`, su __exit__
        # esperaría igual al hilo colgado y anularía el cinturón de seguridad.
        ex = ThreadPoolExecutor(max_workers=1)
        fut = ex.submit(_pedir)
        try:
            crudo = fut.result(timeout=_HARD_TIMEOUT)
        except TimeoutError as exc:
            ex.shutdown(wait=False)
            raise TimeoutError(
                f"Sin respuesta de DeepSeek en {_HARD_TIMEOUT:.0f}s (cinturón de seguridad, "
                f"modelo {self._model})"
            ) from exc
        except Exception:
            ex.shutdown(wait=False)
            raise
        ex.shutdown(wait=False)
        data = json.loads(crudo.decode("utf-8"))
        self._account(data.get("usage"))
        return data["choices"][0]["message"]["content"] or ""
