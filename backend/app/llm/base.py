"""Interfaz de proveedor LLM.

`Protocol`: cualquier objeto con un método `chat` compatible sirve. Esto permite pasar
un `FakeLLMProvider` determinista en los tests sin tocar red ni gastar tokens.
"""

from __future__ import annotations

from typing import Protocol


class LLMProvider(Protocol):
    def chat(self, system: str, user: str, *, temperature: float = 0.3,
             top_p: float | None = None) -> str:
        """Envía un turno system+user y devuelve el texto de la respuesta.

        `top_p` None = no se manda el campo (el proveedor usa su default, 1.0 en DeepSeek).
        Confirmado en api-docs.deepseek.com: en modo razonamiento (`reasoning_effort` distinto
        de "none") el proveedor IGNORA `temperature`/`top_p` — solo tienen efecto real en la
        etapa que corra sin razonamiento.
        """
        ...
