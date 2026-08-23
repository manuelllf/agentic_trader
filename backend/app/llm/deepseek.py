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
import math
import time
from datetime import UTC, datetime

import httpx

from app.llm.trace import CallRecord, NotaLogprob, current_ticker

logger = logging.getLogger(__name__)

# OpenRouterProvider envuelve la llamada en un ThreadPoolExecutor propio POR LLAMADA porque su
# timeout de httpx no siempre saltaba (goteo de keep-alive de alguno de los ~28 proveedores
# detrás del alias). AQUÍ NO se replica ese patrón — medido en vivo que es contraproducente:
# con alta concurrencia (500 hilos de prescore) cada llamada abría OTRO hilo para el wrapper,
# duplicando el pico real de hilos del proceso (hasta ~1.000, el tope del cgroup del contenedor)
# y provocando un 98% de fallos por agotamiento de hilos, no por la API. DeepSeek directo es UN
# proveedor, no 28 — se confía en el timeout normal de httpx, sin hilo extra.
_HARD_TIMEOUT = 180.0

# Alternativas por token que se piden junto con `logprobs` (20 es el tope de la API). Confirmado
# en vivo que pedir logprobs no añade tokens facturables — solo engorda la respuesta. 20→5: el
# top-5 captura solo el 65% de la probabilidad, pero sesga E[score] en +0,14 puntos (medido,
# n=30). Sirve para el valor esperado; NO para medir la dispersión real, que quedaría truncada.
_TOP_LOGPROBS = 5

# Dónde se piden esas alternativas. Prescore y capa media emiten SOLO un número, así que ahí la
# distribución es literalmente la duda entre notas — la señal que buscamos. El profundo, el macro
# y el constructor escriben prosa: las 20 alternativas de cada palabra de un informe de 600
# palabras son ~1 MB por llamada de trivia del tokenizador, no observabilidad de la decisión.
# Ellos van con `logprobs` a secas (probabilidad del token elegido, todos los tokens). Añadir
# "deep" aquí es cambiar una línea si algún día compensa.
_ETAPAS_CON_ALTERNATIVAS = {"prescore", "mid"}

# USD por 1M de tokens: (input cache-miss, input cache-hit, output). Off-peak son la mitad del
# peak (api-docs.deepseek.com/quick_start/pricing) — peak es 01:00-04:00 y 06:00-10:00 UTC.
_PRICING_OFFPEAK: dict[str, tuple[float, float, float]] = {
    "deepseek-v4-pro": (0.66, 0.022, 1.98),
    "deepseek-v4-flash": (0.22, 0.007, 0.66),
}
_PRICING_PEAK: dict[str, tuple[float, float, float]] = {
    "deepseek-v4-pro": (1.32, 0.044, 3.96),
    "deepseek-v4-flash": (0.44, 0.014, 1.32),
}


def _es_peak() -> bool:
    h = datetime.now(UTC).hour
    return (1 <= h < 4) or (6 <= h < 10)


def _pricing_now() -> dict[str, tuple[float, float, float]]:
    return _PRICING_PEAK if _es_peak() else _PRICING_OFFPEAK


def _min_prob(data: dict) -> float | None:
    """Probabilidad del token MENOS seguro de la respuesta (None si no se pidieron logprobs)."""
    choice = (data.get("choices") or [{}])[0]
    tokens = (choice.get("logprobs") or {}).get("content") or []
    return math.exp(min(t["logprob"] for t in tokens)) if tokens else None


def _notas_logprob(data: dict) -> list[NotaLogprob]:
    """Filas RELACIONALES (no JSON) de las fichas numéricas de la nota — solo prescore/mid, cuya
    respuesta entera es `{"score": X.XX}`: cualquier ficha que sean puros dígitos (quitando el
    punto) es parte del número, en orden de aparición ("parte" 0, 1...). El resto de fichas
    (`{"`, `score`, `":`, `}`) son sintaxis fija sin duda que medir, se ignoran. El bloque crudo
    del proveedor se descarta en cuanto se extraen estas filas: nunca se guarda entero."""
    choice = (data.get("choices") or [{}])[0]
    tokens = (choice.get("logprobs") or {}).get("content") or []
    filas: list[NotaLogprob] = []
    parte = 0
    for t in tokens:
        limpio = t["token"].strip()
        if not limpio.replace(".", "").isdigit():
            continue
        filas.append(NotaLogprob(parte=parte, elegido=True, token=limpio,
                                 logprob=t["logprob"]))
        for alt in (t.get("top_logprobs") or []):
            alt_tok = alt["token"].strip()
            if alt_tok.replace(".", "").isdigit():
                filas.append(NotaLogprob(parte=parte, elegido=False, token=alt_tok,
                                         logprob=alt["logprob"]))
        parte += 1
    return filas


class DeepSeekProvider:
    _CAMPOS_USO = ("calls", "prompt_tokens", "completion_tokens", "cache_hit_tokens",
                   "cache_miss_tokens", "peak_calls", "cost_usd")

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.deepseek.com",
        reasoning_effort: str | None = None,
        stage: str = "",
        recorder=None,  # noqa: ANN001  (app.llm.trace.LLMTrace; None = no se traza)
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        # La etapa la fija quien crea el proveedor: el escaneo ya monta una instancia por etapa
        # (macro/prescore/mid/deep/constructor), así que no hace falta pasarla en cada llamada.
        self._stage = stage
        self._recorder = recorder
        # Se piden SIEMPRE y se apagan solos si el modelo los rechaza (ver `_request`): no está
        # confirmado que DeepSeek los acepte con el razonamiento activo, y no se va a dejar la
        # traza a medias en las etapas donde sí funcionen por no haberlo probado.
        self._logprobs_soportado = True
        # None = no se manda el campo → el proveedor usa su default documentado ("high").
        # Valores válidos: low/high/max (confirmado en api-docs.deepseek.com/guides/thinking_mode,
        # "none" también existe para desactivar el razonamiento del todo, sin uso hoy).
        self._reasoning_effort = reasoning_effort
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        # cache_hit/miss_tokens y peak_calls no son adorno: el tramo cache-miss cuesta 30x el de
        # hit, y peak el doble que off-peak — sin ese desglose, un escaneo caro no se puede
        # atribuir a mal cache, a la hora, o a otra cosa.
        self._usage = {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cache_hit_tokens": 0,
            "cache_miss_tokens": 0,
            "peak_calls": 0,
            "cost_usd": 0.0,
            "by_model": {},
        }

    @property
    def usage(self) -> dict:
        return copy.deepcopy(self._usage)

    def _account(self, usage: dict | None) -> tuple[int, int, int, float]:
        """Suma el uso de una respuesta. Devuelve (hit, miss, completion, coste) de ESA llamada
        para que la traza no tenga que recalcular la tarifa."""
        if not usage:
            return 0, 0, 0, 0.0
        pt = int(usage.get("prompt_tokens", 0) or 0)
        ct = int(usage.get("completion_tokens", 0) or 0)
        hit = int(usage.get("prompt_cache_hit_tokens", 0) or 0)
        miss = int(usage.get("prompt_cache_miss_tokens", 0) or pt - hit)
        pin_miss, pin_hit, pout = _pricing_now().get(self._model, (0.0, 0.0, 0.0))
        cost = (miss * pin_miss + hit * pin_hit + ct * pout) / 1_000_000
        delta = {"calls": 1, "prompt_tokens": pt, "completion_tokens": ct,
                 "cache_hit_tokens": hit, "cache_miss_tokens": miss,
                 "peak_calls": 1 if _es_peak() else 0, "cost_usd": cost}
        by_model = self._usage["by_model"].setdefault(
            self._model, dict.fromkeys(self._CAMPOS_USO, 0)
        )
        for k in self._CAMPOS_USO:
            self._usage[k] += delta[k]
            by_model[k] += delta[k]
        return hit, miss, ct, cost

    def _payload(self, system: str, user: str, temperature: float,
                 top_p: float | None) -> dict:
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
        if self._logprobs_soportado:
            payload["logprobs"] = True
            if self._stage in _ETAPAS_CON_ALTERNATIVAS:
                payload["top_logprobs"] = _TOP_LOGPROBS
        return payload

    def _request(self, system: str, user: str, *, temperature: float,
                top_p: float | None) -> dict:
        for intento in (1, 2):
            payload = self._payload(system, user, temperature, top_p)
            t0 = time.monotonic()
            try:
                # `timeout` de httpx aplica al connect Y al read — un `_HARD_TIMEOUT` generoso
                # (180s) directamente en el cliente, sin hilo ni executor de por medio.
                with httpx.Client(timeout=_HARD_TIMEOUT) as client:
                    resp = client.post(
                        f"{self._base_url}/chat/completions",
                        headers=self._headers,
                        json=payload,
                    )
                    resp.raise_for_status()
                    crudo = resp.content
                data = json.loads(crudo.decode("utf-8"))
            except httpx.HTTPStatusError as exc:
                # Un 400 con `logprobs` puesto suele significar que ESE modelo no los admite en
                # modo razonamiento. Se apagan para esta instancia (una etapa entera) y se
                # reintenta sin ellos: la telemetría no puede tumbar una llamada de producción.
                if (intento == 1 and payload.get("logprobs")
                        and exc.response.status_code == 400):
                    self._logprobs_soportado = False
                    logger.warning("DeepSeek rechaza logprobs en %s (reasoning=%s); se desactivan "
                                   "para la etapa '%s'.", self._model, self._reasoning_effort,
                                   self._stage or "n/d")
                    continue
                self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
                raise
            except Exception as exc:
                # La llamada fallida también se traza: el coste en tiempo existió y el motivo
                # (429, timeout, corte) es justo lo que no se puede reconstruir desde los logs.
                self._trazar(t0, None, error=f"{type(exc).__name__}: {exc}")
                raise
            hit, miss, ct, cost = self._account(data.get("usage"))
            self._trazar(t0, data, uso=(hit, miss, ct, cost))
            return data
        raise AssertionError("inalcanzable")   # el bucle sale por return o por raise

    def _trazar(self, t0: float, data: dict | None, *, uso=(0, 0, 0, 0.0),  # noqa: ANN001
                error: str | None = None) -> None:
        if self._recorder is None:
            return
        choice = ((data or {}).get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        hit, miss, ct, cost = uso
        self._recorder.record(CallRecord(
            at=datetime.now(UTC), stage=self._stage, ticker=current_ticker(),
            model=self._model, reasoning_effort=self._reasoning_effort,
            content=msg.get("content"),
            # Con `reasoning_effort="none"` DeepSeek no genera razonamiento: aquí NULL no es
            # pérdida, es que no existe.
            reasoning=msg.get("reasoning_content"),
            confidence=_min_prob(data) if data else None,
            prompt_cache_hit_tokens=hit, prompt_cache_miss_tokens=miss, completion_tokens=ct,
            cost_usd=cost, latency_ms=int((time.monotonic() - t0) * 1000),
            ok=error is None, error=error,
            notas=_notas_logprob(data) if data and self._stage in _ETAPAS_CON_ALTERNATIVAS
            else [],
        ))

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        data = self._request(system, user, temperature=temperature, top_p=top_p)
        return data["choices"][0]["message"]["content"] or ""

    def chat_logprobs(self, system: str, user: str, *, temperature: float = 0.3,
                      top_p: float | None = None) -> tuple[str, float | None]:
        """Como `chat()`, pero además devuelve la probabilidad del token MENOS seguro de la
        respuesta. Se usa el mínimo, no la media: la media la diluyen los tokens triviales del
        esqueleto JSON (llaves, comillas, ticker copiado del input), casi siempre con
        probabilidad ~1 — el mínimo es donde vive la incertidumbre real del modelo (normalmente,
        el dígito de una nota). Las fichas de la nota (elegida + alternativas) quedan aparte,
        relacionales, en `llm_call_logprob` (ver `_notas_logprob`); este número es el atajo que
        consume el escaneo, no todo lo que se traza."""
        data = self._request(system, user, temperature=temperature, top_p=top_p)
        return data["choices"][0]["message"]["content"] or "", _min_prob(data)


def account_balance_usd(api_key: str, base_url: str = "https://api.deepseek.com") -> float | None:
    """Saldo REAL de la cuenta (USD), consultado en vivo — no una estimación por tokens.

    `GET /user/balance`, endpoint aparte del de chat (confirmado en api-docs.deepseek.com): la
    respuesta de una llamada de chat solo trae tokens, nunca un coste ya facturado (a diferencia
    de OpenRouter con `usage.include`). Comparar el saldo antes/después de un escaneo da el coste
    real de esa tirada sin depender de la tabla de precios (solo un respaldo para `ScanRun.cost`
    mientras el escaneo corre). None si falla o no hay currency USD.
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
