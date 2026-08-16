"""Cliente de OpenRouter (compatible con la API de chat de OpenAI).

OpenRouter expone `/chat/completions` con el mismo formato que OpenAI, así que sirve para
DeepSeek y para cualquier otro modelo de su catálogo cambiando solo `llm_model`.
Pedimos `response_format=json_object` porque los agentes esperan JSON estructurado.
"""

from __future__ import annotations

import copy
import json
from concurrent.futures import ThreadPoolExecutor

import httpx

# Cinturón de seguridad AJENO a httpx, medido en vivo dos veces (una llamada individual y una
# de lote): el timeout de 60s de httpx (`self._timeout`, más abajo) NO SIEMPRE
# SALTA — una llamada se quedó conectada a OpenRouter sin devolver nada 7+ minutos. Probable
# goteo de keep-alive de alguno de los 24 proveedores detrás del alias, que resetea el reloj de
# lectura de httpx sin completar nunca la respuesta. Este segundo reloj, por fuera de httpx y de
# la librería, es el único que garantiza cortar la espera. 180s (no 60): un lote de 20 tickers
# tarda ~80-100s limpio y NO hay reintento por ticker dentro de un lote — cortarlo demasiado
# pronto tira 20 notas que iban a llegar bien. Si salta, cuenta como fallo de transporte normal
# (el caller ya sabe reintentar), no bloquea nada.
_HARD_TIMEOUT = 180.0

# `deepseek/deepseek-v4-flash-0731` no es UN backend: OpenRouter enruta la misma llamada entre
# 28 proveedores distintos detrás del alias hoy (consultado vía GET
# /api/v1/models/.../endpoints — eran 24 cuando se midió por primera vez, la lista de
# proveedores de OpenRouter no es estática tampoco). Medido originalmente: sobre 49 finalistas
# de un mismo escaneo, ~6 de cada 49 fallaban al primer intento — no solo `content` vacío,
# también JSON cortado a media frase o bucles de repetición degenerados ("...con una nota de
# 100.00, con una de las notas de 100.00..."). Los tres proveedores marcados `status != 0`
# (degradados) esa noche eran Together (cuantización desconocida), Parasail y Mancer 2 (los DOS
# en fp8, no precisión completa — causa técnica conocida de degeneración en generación
# autoregresiva, no solo mala suerte de uptime). Se excluyeron los tres.
#
# Re-medido tras el primer escaneo real en producción con el scraper propio (mismo patrón de
# JSON degenerado visto de nuevo pese a la exclusión ya puesta): re-consultado el endpoint en
# vivo. Parasail (94,4%) y Mancer (94,6%) siguen bajos frente a la media (97-99%+ el resto), se
# quedan excluidos. Together sigue en `status=-2` (degradado). Tres NUEVOS en `status=-2` que no
# estaban la primera vez: OpenInference (fp4, 93,4% de uptime en 24h — el peor de los 28),
# Ambient (fp4, 95,8%) y Morph (bf16, 96,1% — no es cuantización baja, así que el motivo aquí no
# es el mismo que en Parasail/Mancer, pero el status degradado de OpenRouter es señal suficiente
# por sí sola). Lista estática otra vez: sigue sin ser un arreglo permanente — revisar
# `GET /api/v1/models/{modelo}/endpoints` si vuelve a fallar mucho con esta lista puesta.
_PROVEEDORES_EXCLUIDOS_0731 = (
    "together", "parasail", "mancer", "open-inference", "ambient", "morph",
)

# Precios OpenRouter en USD por 1M de tokens (input, output). El output de un modelo
# razonador INCLUYE los tokens de razonamiento ocultos → por eso un escaneo cuesta más
# de lo que "se ve". Solo se usan como respaldo: si la respuesta trae el coste real, mandan.
_PRICING: dict[str, tuple[float, float]] = {
    "deepseek/deepseek-v4-pro": (0.435, 0.87),
    "deepseek/deepseek-v4-flash": (0.14, 0.28),
    "deepseek/deepseek-v4-flash-0731": (0.09, 0.18),
    "deepseek/deepseek-v3.2": (0.269, 0.40),
    "deepseek/deepseek-r1": (0.70, 2.50),
}


class OpenRouterProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout: float = 60.0,
        reasoning_effort: str | None = None,
        provider_ignore: tuple[str, ...] | None = None,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        # None = no se manda el campo (el proveedor decide su nivel por defecto).
        # Confirmado vía GET /api/v1/models que deepseek-v4-pro, -flash y
        # -flash-0731 declaran "reasoning" en supported_parameters, así que el campo no se
        # ignora en silencio. Los tokens de razonamiento YA se facturaban como completion_tokens
        # antes de esto (ver _PRICING más abajo); pedir más esfuerzo sube el coste real, no solo
        # el aparente. Valores válidos de OpenRouter: none/minimal/low/medium/high/xhigh/max.
        self._reasoning_effort = reasoning_effort
        # Ver `_PROVEEDORES_EXCLUIDOS_0731` arriba: slugs de proveedor a excluir del enrutado de
        # OpenRouter para ESTE alias de modelo (`provider.ignore` en el payload).
        self._provider_ignore = provider_ignore
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter usa estos para atribución (opcional pero recomendado).
            "HTTP-Referer": "https://github.com/agentic-trader",
            "X-Title": "Agentic Trader",
        }
        # Uso acumulado de ESTE proveedor (el escaneo suma el de Flash + el de V4-Pro).
        # "by_model" desglosa el mismo total por modelo: un escaneo mezcla un modelo barato
        # en miles de llamadas con uno caro en decenas; sin separar no se puede saber dónde
        # se va el dinero ni cuánto costaría ampliar el universo.
        self._usage = {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cost_usd": 0.0,
            "by_model": {},
        }

    @property
    def usage(self) -> dict:
        """Copia profunda del acumulado (mutar el resultado no toca el acumulador)."""
        return copy.deepcopy(self._usage)

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
        cost = float(cost)
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
            # Pide a OpenRouter que incluya el coste REAL facturado en la respuesta.
            "usage": {"include": True},
        }
        if top_p is not None:
            payload["top_p"] = top_p
        if self._reasoning_effort:
            payload["reasoning"] = {"effort": self._reasoning_effort}
        if self._provider_ignore:
            payload["provider"] = {"ignore": list(self._provider_ignore)}

        def _pedir() -> bytes:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(
                    f"{self._base_url}/chat/completions",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                return resp.content

        # Nada de `with ThreadPoolExecutor(...)`: su __exit__ hace shutdown(wait=True) y
        # esperaría igualmente al hilo colgado, anulando el cinturón de seguridad. Se crea
        # suelto; si `_HARD_TIMEOUT` salta, se abandona sin esperar a que termine.
        ex = ThreadPoolExecutor(max_workers=1)
        fut = ex.submit(_pedir)
        try:
            crudo = fut.result(timeout=_HARD_TIMEOUT)
        except TimeoutError as exc:
            ex.shutdown(wait=False)
            raise TimeoutError(
                f"Sin respuesta de OpenRouter en {_HARD_TIMEOUT:.0f}s (cinturón de seguridad, "
                f"modelo {self._model})"
            ) from exc
        except Exception:
            ex.shutdown(wait=False)
            raise
        ex.shutdown(wait=False)
        # Forzamos UTF-8: httpx a veces autodetecta cp1252 y destroza los acentos
        # (el español salía "interÃ©s"). Decodificamos los bytes crudos como UTF-8.
        data = json.loads(crudo.decode("utf-8"))
        self._account(data.get("usage"))
        # `content` puede venir a NULL en una respuesta por lo demás válida (visto con
        # v4-pro). Devolver None hacía que el `except` del scorer petara al recortar la respuesta
        # cruda, y como el scoring va en un ThreadPoolExecutor esa excepción tumbaba el escaneo
        # entero. Se normaliza a cadena vacía: el caller ya sabe tratar un JSON no parseable.
        return data["choices"][0]["message"]["content"] or ""
