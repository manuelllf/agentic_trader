"""Lista de bloqueo: bloquea insultos aunque vayan disfrazados y deja pasar nombres normales que
solo contienen esas letras dentro de otra palabra."""

from __future__ import annotations

import pytest

from app.liga.ia.bloqueo import tiene_bloqueada


@pytest.mark.parametrize("texto", [
    "Puto mercado", "puta", "PUTA123", "pu7a", "asshole_99", "xXfuckXx", "Hijo de puta",
    "Gilipollas Fund", "sh1t", "eres una MIERDA", "cabrón", "Retard", "cunt-value",
])
def test_bloquea_insultos_aunque_vayan_disfrazados(texto: str) -> None:
    assert tiene_bloqueada(texto), texto


@pytest.mark.parametrize("texto", [
    "Reputation Fund", "Cash It All", "Scunthorpe Value", "Top Utah Stocks", "Computacion",
    "Fire Retardant", "Disputa de valor", "Diputado Capital", "Compute Growth", "Ken Shiitake",
    "Value Investing", "Dividendos Seguros", "Tecnologia y Salud", "Class Action Picks",
])
def test_deja_pasar_nombres_normales(texto: str) -> None:
    assert not tiene_bloqueada(texto), texto
