"""Tope al tamaño del cuerpo de una petición.

Sin él, cualquiera puede mandar un JSON de cientos de MB: el servidor lo lee entero y lo parsea
antes de que ninguna validación de campos lo vea. Se corta aquí, por la cabecera si la trae y
contando los bytes si llega troceado."""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

MENSAJE = "La petición es demasiado grande."


class _Excedido(Exception):
    pass


class CuerpoAcotado:
    def __init__(self, app: ASGIApp, maximo: int, prefijo: str = "/") -> None:
        self.app, self.maximo, self.prefijo = app, maximo, prefijo

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.prefijo):
            await self.app(scope, receive, send)
            return
        declarado = dict(scope["headers"]).get(b"content-length")
        if declarado is not None and declarado.isdigit() and int(declarado) > self.maximo:
            await self._rechazar(send)
            return

        leidos = 0
        empezo = False

        async def contando() -> Message:
            nonlocal leidos
            mensaje = await receive()
            if mensaje["type"] == "http.request":
                leidos += len(mensaje.get("body", b""))
                if leidos > self.maximo:
                    raise _Excedido
            return mensaje

        async def vigilando(mensaje: Message) -> None:
            nonlocal empezo
            empezo = True
            await send(mensaje)

        try:
            await self.app(scope, contando, vigilando)
        except _Excedido:
            if empezo:
                raise
            await self._rechazar(send)

    async def _rechazar(self, send: Send) -> None:
        cuerpo = json.dumps({"detail": MENSAJE}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(cuerpo)).encode())]})
        await send({"type": "http.response.body", "body": cuerpo})
