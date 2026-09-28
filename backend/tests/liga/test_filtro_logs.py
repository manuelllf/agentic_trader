"""Red de seguridad de logging (`app.liga.filtro_logs`, plan §14, F8.7): un JWT, una clave de
Supabase o un email no deben salir por el handler, aunque un `logger.*` se equivocara."""

from __future__ import annotations

import logging

from app.liga.filtro_logs import FiltroDatosPersonales, instalar


def _formatea(mensaje: str, *args: object) -> str:
    filtro = FiltroDatosPersonales()
    record = logging.LogRecord("prueba", logging.INFO, __file__, 1, mensaje, args, None)
    assert filtro.filter(record) is True
    return record.getMessage()


def test_redacta_un_jwt() -> None:
    jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnopqrstuvwxyz012345"
    salida = _formatea("token=%s", jwt)
    assert jwt not in salida
    assert "[jwt]" in salida


def test_redacta_claves_de_supabase() -> None:
    salida = _formatea("clave secreta: sb_secret_abcdefghij1234567890")
    assert "sb_secret_" not in salida
    assert "[clave]" in salida
    salida2 = _formatea("clave publicable: sb_publishable_abcdefghij1234567890")
    assert "sb_publishable_" not in salida2


def test_redacta_un_email() -> None:
    salida = _formatea("usuario=%s entrando", "persona@ejemplo.com")
    assert "persona@ejemplo.com" not in salida
    assert "[email]" in salida


def test_deja_pasar_un_uuid_normal() -> None:
    salida = _formatea("usuario=%s", "3f9a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b")
    assert "3f9a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b" in salida


def test_instalar_es_idempotente() -> None:
    logger_prueba = logging.getLogger("prueba.filtro_logs")
    handler = logging.StreamHandler()
    logger_prueba.handlers = [handler]
    instalar(logger_prueba)
    instalar(logger_prueba)
    assert sum(isinstance(f, FiltroDatosPersonales) for f in handler.filters) == 1
