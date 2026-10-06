"""La metodología de la casa: cada equipo tiene sus pasos en los dos idiomas, y sin Pro solo el
resumen."""

from __future__ import annotations

import pytest

from app.i18n import MESSAGES
from app.liga.casas_metodologia import PASOS, metodologia
from app.liga.procesos.casa import CASAS


def test_cada_equipo_de_la_casa_tiene_su_metodologia() -> None:
    assert set(PASOS) == set(CASAS)


@pytest.mark.parametrize("idioma", ["es", "en"])
@pytest.mark.parametrize("clave", sorted(PASOS))
def test_los_pasos_declarados_son_todos_los_que_hay(clave: str, idioma: str) -> None:
    textos = MESSAGES[idioma]
    existentes = {k for k in textos if k.startswith(f"liga_casa_{clave}_paso_")}
    declarados = {f"liga_casa_{clave}_paso_{n}_{parte}"
                  for n in range(1, PASOS[clave] + 1) for parte in ("titulo", "texto")}
    assert existentes == declarados
    assert f"liga_casa_{clave}_resumen" in textos


@pytest.mark.parametrize("clave", sorted(PASOS))
def test_sin_la_vista_completa_solo_va_el_resumen(clave: str) -> None:
    corta, completa = metodologia(clave, completa=False), metodologia(clave, completa=True)
    assert corta["resumen"] == completa["resumen"] and corta["resumen"]
    assert corta["pasos"] == []
    assert len(completa["pasos"]) == PASOS[clave]
    assert all(p["titulo"] and p["texto"] for p in completa["pasos"])
