"""Tests de `materialize_pems`: las claves IBKR llegan por env en base64 (nube) y se vuelcan
a ficheros al arrancar. Best-effort: sin vars es no-op y un base64 corrupto jamás revienta."""

from __future__ import annotations

import base64

from app.brokers import ibkr_web

_SIG = b"-----BEGIN PRIVATE KEY-----\nfirma-de-mentira\n-----END PRIVATE KEY-----\n"
_ENC = b"-----BEGIN PRIVATE KEY-----\ncifrado-de-mentira\n-----END PRIVATE KEY-----\n"


def test_materializes_pems_and_points_paths(tmp_path, monkeypatch) -> None:
    s = ibkr_web.settings
    monkeypatch.setattr(s, "ibkr_pem_signature_b64", base64.b64encode(_SIG).decode())
    monkeypatch.setattr(s, "ibkr_pem_encryption_b64", base64.b64encode(_ENC).decode())
    monkeypatch.setattr(s, "ibkr_oauth_signature_key_path", "")
    monkeypatch.setattr(s, "ibkr_oauth_encryption_key_path", "")

    assert ibkr_web.materialize_pems(dest_dir=str(tmp_path)) is True

    sig = tmp_path / "private_signature.pem"
    enc = tmp_path / "private_encryption.pem"
    assert sig.read_bytes() == _SIG                     # byte a byte, sin re-codificar
    assert enc.read_bytes() == _ENC
    assert s.ibkr_oauth_signature_key_path == str(sig)  # ibind leerá de aquí
    assert s.ibkr_oauth_encryption_key_path == str(enc)


def test_noop_without_b64_vars(tmp_path, monkeypatch) -> None:
    """Local: sin B64 no toca nada — se siguen usando las rutas del .env."""
    s = ibkr_web.settings
    monkeypatch.setattr(s, "ibkr_pem_signature_b64", "")
    monkeypatch.setattr(s, "ibkr_pem_encryption_b64", "")
    monkeypatch.setattr(s, "ibkr_oauth_signature_key_path", "ruta/local.pem")

    assert ibkr_web.materialize_pems(dest_dir=str(tmp_path)) is False
    assert s.ibkr_oauth_signature_key_path == "ruta/local.pem"
    assert list(tmp_path.iterdir()) == []               # no escribió nada


def test_corrupt_base64_never_raises(tmp_path, monkeypatch) -> None:
    s = ibkr_web.settings
    monkeypatch.setattr(s, "ibkr_pem_signature_b64", "esto-no-es-base64-!!!")
    monkeypatch.setattr(s, "ibkr_pem_encryption_b64", "")
    monkeypatch.setattr(s, "ibkr_oauth_signature_key_path", "")

    assert ibkr_web.materialize_pems(dest_dir=str(tmp_path)) is False
    assert s.ibkr_oauth_signature_key_path == ""        # sin ruta → cascada: DryRunBroker


def test_broker_verifica_tls_siempre(monkeypatch) -> None:
    """El cliente IBKR se construye con cacert=True (certificado verificado) SIEMPRE — sin
    variable de entorno que lo apague: este canal lee la cuenta y en live coloca órdenes."""
    import ibind

    for campo in ("ibkr_oauth_consumer_key", "ibkr_oauth_access_token",
                  "ibkr_oauth_access_token_secret", "ibkr_oauth_signature_key_path",
                  "ibkr_oauth_encryption_key_path", "ibkr_oauth_dh_prime"):
        monkeypatch.setattr(ibkr_web.settings, campo, "x")   # credenciales de mentira

    capturado: dict = {}

    class ClienteFalso:
        def __init__(self, **kwargs) -> None:
            capturado.update(kwargs)

    monkeypatch.setattr(ibind, "IbkrClient", ClienteFalso)
    ibkr_web.IbkrWebBroker()
    assert capturado["cacert"] is True
