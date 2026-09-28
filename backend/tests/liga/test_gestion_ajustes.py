"""Catálogo de `liga.ajustes` (`app.liga.gestion`): validación por tipo y valor efectivo por
defecto. Sin BD -- pura, como `test_procesos_puros.py`."""

from __future__ import annotations

import pytest

from app.liga import gestion


def test_catalogo_cubre_las_mismas_claves_que_antes() -> None:
    assert gestion.AJUSTES_CONOCIDOS == frozenset({
        "creditos.pro_mensual",
        "ia.conversor.activo", "ia.pregunta.activo", "ia.lectura.activo", "ia.moderacion.activo",
        "ia.tope_mensual_usd", "ia.margen_objetivo",
        "liga.registro.abierto", "liga.visible",
        "procesos.foto.auto",
    })


def test_valor_efectivo_usa_el_defecto_solo_si_no_hay_valor() -> None:
    assert gestion.valor_efectivo("liga.registro.abierto", None) is True
    assert gestion.valor_efectivo("liga.registro.abierto", False) is False
    assert gestion.valor_efectivo("ia.conversor.activo", None) is False
    assert gestion.valor_efectivo("ia.tope_mensual_usd", None) is None
    assert gestion.valor_efectivo("ia.tope_mensual_usd", 5.0) == 5.0
    assert gestion.valor_efectivo("ia.margen_objetivo", None) == 3


@pytest.mark.parametrize("clave", ["liga.registro.abierto", "ia.conversor.activo"])
def test_interruptor_solo_acepta_booleano(clave: str) -> None:
    assert gestion.validar_ajuste(clave, True) is True
    assert gestion.validar_ajuste(clave, False) is False
    for malo in ("true", 1, None, 0):
        with pytest.raises(ValueError, match="interruptor"):
            gestion.validar_ajuste(clave, malo)


def test_dolares_normaliza_a_dos_decimales() -> None:
    assert gestion.validar_ajuste("ia.tope_mensual_usd", 5) == 5.0
    assert gestion.validar_ajuste("ia.tope_mensual_usd", "2.5") == 2.5
    assert gestion.validar_ajuste("ia.tope_mensual_usd", 2.567) == 2.57


def test_dolares_rechaza_negativo_y_no_numerico() -> None:
    with pytest.raises(ValueError, match="negativo"):
        gestion.validar_ajuste("ia.tope_mensual_usd", -0.01)
    with pytest.raises(ValueError, match="número"):
        gestion.validar_ajuste("ia.tope_mensual_usd", "no numero")
    with pytest.raises(ValueError, match="número"):
        gestion.validar_ajuste("ia.tope_mensual_usd", True)


def test_multiplicador_misma_regla_que_dolares() -> None:
    assert gestion.validar_ajuste("ia.margen_objetivo", 4) == 4.0
    with pytest.raises(ValueError, match="negativo"):
        gestion.validar_ajuste("ia.margen_objetivo", -1)


def test_clave_desconocida_no_esta_en_el_catalogo() -> None:
    assert "lo.que.sea" not in gestion.CATALOGO
