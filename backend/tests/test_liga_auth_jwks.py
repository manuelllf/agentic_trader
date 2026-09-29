"""Tokens con `kid` inventados no pueden hacer que el servidor vaya a Supabase en cada petición:
el cliente de claves recarga el JWKS como mucho una vez por ventana."""

from __future__ import annotations

import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app.liga import auth

EMISOR = "https://proyecto.supabase.co"
CLAVE = ec.generate_private_key(ec.SECP256R1())


def _jwks() -> dict:
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(CLAVE.public_key()))
    return {"keys": [{**jwk, "kid": "real", "alg": "ES256", "use": "sig"}]}


def test_kid_inventados_no_provocan_una_descarga_por_peticion(monkeypatch) -> None:  # noqa: ANN001
    descargas: list[str] = []

    def fetch_data(self):  # noqa: ANN001, ANN202
        descargas.append(self.uri)
        return _jwks()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_jwks", None)
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", fetch_data)

    ahora = int(time.time())
    for _ in range(50):
        falso = jwt.encode({"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": EMISOR,
                            "exp": ahora + 60}, CLAVE, algorithm="ES256",
                           headers={"kid": uuid.uuid4().hex})
        with pytest.raises(HTTPException) as e:
            auth.verificar(falso)
        assert e.value.status_code == 401

    assert len(descargas) <= 2   # la primera carga y, como mucho, un refresco
