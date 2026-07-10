"""Interfaz de proveedor LLM.

`Protocol`: cualquier objeto con un método `chat` compatible sirve. Esto permite pasar
un `FakeLLMProvider` determinista en los tests sin tocar red ni gastar tokens.
"""

from __future__ import annotations

from typing import Protocol


class LLMProvider(Protocol):
    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        """Envía un turno system+user y devuelve el texto de la respuesta."""
        ...
