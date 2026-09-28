"""Tope de peticiones de IA a la vez: una por usuario y un máximo en todo el servidor."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.liga.acceso import LimiteSimultaneas


def test_un_usuario_no_puede_tener_dos_a_la_vez_y_al_salir_vuelve_a_poder() -> None:
    limite = LimiteSimultaneas(total=5)
    limite.entrar("ana")
    with pytest.raises(HTTPException) as e:
        limite.entrar("ana")
    assert e.value.status_code == 429
    limite.entrar("beto")          # otro usuario no se ve afectado
    limite.salir("ana")
    limite.entrar("ana")


def test_el_servidor_rechaza_con_503_al_llegar_al_tope() -> None:
    limite = LimiteSimultaneas(total=2)
    limite.entrar("a")
    limite.entrar("b")
    with pytest.raises(HTTPException) as e:
        limite.entrar("c")
    assert e.value.status_code == 503 and e.value.headers == {"Retry-After": "20"}
    limite.salir("a")
    limite.entrar("c")


def test_salir_dos_veces_o_sin_entrar_no_falla() -> None:
    limite = LimiteSimultaneas(total=1)
    limite.salir("nadie")
    limite.entrar("x")
    limite.salir("x")
    limite.salir("x")
