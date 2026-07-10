"""Cliente de OpenRouter (compatible con la API de chat de OpenAI).

OpenRouter expone `/chat/completions` con el mismo formato que OpenAI, así que sirve para
DeepSeek y para cualquier otro modelo de su catálogo cambiando solo `llm_model`.
Pedimos `response_format=json_object` porque los agentes esperan JSON estructurado.
"""

from __future__ import annotations

import json

import httpx

# Precios OpenRouter en USD por 1M de tokens (input, output). El output de un modelo
# razonador INCLUYE los tokens de razonamiento ocultos → por eso un escaneo cuesta más
# de lo que "se ve". Solo se usan como respaldo: si la respuesta trae el coste real, mandan.
_PRICING: dict[str, tuple[float, float]] = {
    "deepseek/deepseek-v4-pro": (0.435, 0.87),
    "deepseek/deepseek-v4-flash": (0.09, 0.18),
    "deepseek/deepseek-v3.2": (0.2288, 0.3432),
    "deepseek/deepseek-r1": (0.70, 2.50),
}


class OpenRouterProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout: float = 60.0,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter usa estos para atribución (opcional pero recomendado).
            "HTTP-Referer": "https://github.com/agentic-trader",
            "X-Title": "Agentic Trader",
        }
        # Uso acumulado de ESTE proveedor (el escaneo suma el de Flash + el de V4-Pro).
        self._usage = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}

    @property
    def usage(self) -> dict:
        """Copia del acumulado: nº llamadas, tokens in/out y coste USD."""
        return dict(self._usage)

    def _account(self, usage: dict | None) -> None:
        """Suma el `usage` de una respuesta. Coste real de OpenRouter si viene; si no, estima."""
        if not usage:
            return
        pt = int(usage.get("prompt_tokens", 0) or 0)
        ct = int(usage.get("completion_tokens", 0) or 0)
        cost = usage.get("cost")  # coste real facturado (créditos = USD) si se pidió
        if cost is None:
            pin, pout = _PRICING.get(self._model, (0.0, 0.0))
            cost = (pt * pin + ct * pout) / 1_000_000
        self._usage["calls"] += 1
        self._usage["prompt_tokens"] += pt
        self._usage["completion_tokens"] += ct
        self._usage["cost_usd"] += float(cost)

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            # Pide a OpenRouter que incluya el coste REAL facturado en la respuesta.
            "usage": {"include": True},
        }
        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            # Forzamos UTF-8: httpx a veces autodetecta cp1252 y destroza los acentos
            # (el español salía "interÃ©s"). Decodificamos los bytes crudos como UTF-8.
            data = json.loads(resp.content.decode("utf-8"))
        self._account(data.get("usage"))
        return data["choices"][0]["message"]["content"]
