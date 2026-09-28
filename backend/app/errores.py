"""Código corto de un error interno: lo ve la persona («código a1b2c3»), sale en el registro del
servidor junto al detalle técnico y viaja en su aviso, así el admin lo encuentra sin que se
enseñe nada interno."""

from __future__ import annotations

import secrets


def codigo_error() -> str:
    return secrets.token_hex(3)


def mensaje_interno(codigo: str) -> str:
    return f"Algo ha fallado. Puedes reintentarlo o avisarnos. (código {codigo})"
