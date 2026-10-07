from decimal import Decimal
from types import SimpleNamespace

from app.liga.rutas_publicas import ordenar_por_rentabilidad


def test_ordena_por_rentabilidad_descendente() -> None:
    filas = [SimpleNamespace(eid=eid) for eid in ("a", "b", "c")]
    acumulados = {
        "a": {"rentabilidad": Decimal("1.5")},
        "b": {"rentabilidad": Decimal("9")},
        "c": {"rentabilidad": Decimal("-2")},
    }
    assert ordenar_por_rentabilidad(filas, acumulados) == [filas[1], filas[0], filas[2]]


def test_sin_acumulados_quedan_al_final_y_conservan_el_orden() -> None:
    filas = [SimpleNamespace(eid=eid) for eid in ("a", "b", "c", "d")]
    acumulados = {
        "b": {"rentabilidad": Decimal("-2")},
        "d": {"rentabilidad": Decimal("1.5")},
    }
    assert ordenar_por_rentabilidad(filas, acumulados) == [
        filas[3], filas[1], filas[0], filas[2]]


def test_un_empate_conserva_el_orden_de_entrada() -> None:
    filas = [SimpleNamespace(eid=eid) for eid in ("a", "b")]
    acumulados = {eid: {"rentabilidad": Decimal("9")} for eid in ("a", "b")}
    assert ordenar_por_rentabilidad(filas, acumulados) == filas


def test_ordena_las_rentabilidades_negativas() -> None:
    filas = [SimpleNamespace(eid=eid) for eid in ("a", "b")]
    acumulados = {
        "a": {"rentabilidad": Decimal("-3")},
        "b": {"rentabilidad": Decimal("-0.5")},
    }
    assert ordenar_por_rentabilidad(filas, acumulados) == [filas[1], filas[0]]
