"""Límite de frecuencia en memoria: cuenta por ventana y no acumula claves de gente que ya se fue."""

from __future__ import annotations

import pytest

from app.liga import acceso
from app.liga.acceso import LimiteFrecuencia


@pytest.fixture
def reloj(monkeypatch):  # noqa: ANN001, ANN201
    ahora = [1000.0]
    monkeypatch.setattr(acceso.time, "time", lambda: ahora[0])
    return ahora


def test_deja_pasar_hasta_el_tope_y_vuelve_al_salir_de_la_ventana(reloj) -> None:  # noqa: ANN001
    limite = LimiteFrecuencia(tope=2, ventana_s=60)
    assert limite.permitido("ana") and limite.permitido("ana")
    assert not limite.permitido("ana")
    assert limite.permitido("beto")
    reloj[0] += 61
    assert limite.permitido("ana")


def test_las_claves_caducadas_se_olvidan(reloj) -> None:  # noqa: ANN001
    # Claves como IP o uid: sin esto el dict crece con cada visitante que pasó una vez.
    limite = LimiteFrecuencia(tope=2, ventana_s=60)
    for i in range(3000):
        limite.permitido(f"ip-{i}")
    assert len(limite._golpes) == 3000
    reloj[0] += 61
    limite.permitido("recien-llegado")
    assert list(limite._golpes) == ["recien-llegado"]
