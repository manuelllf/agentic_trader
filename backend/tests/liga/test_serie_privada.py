"""Quién ve la serie diaria de una liga privada: quien lleva la estrategia, o cualquiera si está
publicada. Función pura, sin base de datos: la comprobación completa va en `test_rutas_ligas.py`."""

from __future__ import annotations

from types import SimpleNamespace

from app.liga.rutas_ligas import _ve_la_serie


def _miembro(usuario_id: str, visibilidad: str) -> SimpleNamespace:
    return SimpleNamespace(usuario_id=usuario_id, visibilidad=visibilidad)


def test_la_serie_la_ve_quien_lleva_la_estrategia_aunque_sea_privada() -> None:
    assert _ve_la_serie(_miembro("yo", "privada"), SimpleNamespace(uid="yo"))


def test_la_serie_de_otro_con_estrategia_privada_no_se_ve() -> None:
    assert not _ve_la_serie(_miembro("otro", "privada"), SimpleNamespace(uid="yo"))


def test_la_serie_de_otro_con_estrategia_publicada_si_se_ve() -> None:
    assert _ve_la_serie(_miembro("otro", "publicada"), SimpleNamespace(uid="yo"))
