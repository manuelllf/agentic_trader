"""El proceso hijo: resultado, progreso, errores, cancelación y muerte sin aviso."""

from __future__ import annotations

import threading

import pytest

from app import proceso_hijo

_TAREAS = "tests.tareas_hijo_de_prueba"


def test_devuelve_el_resultado_y_el_progreso() -> None:
    estados: list[dict] = []
    valor = proceso_hijo.ejecutar(f"{_TAREAS}:suma", {"a": 2, "b": 3}, on_estado=estados.append)

    assert valor == {"suma": 5}
    # El último estado que llega es el final del hijo, con lo que su tarea fue contando.
    assert estados[-1]["stage"] == "prescore" and estados[-1]["done"] == 1


def test_lo_que_la_tarea_imprime_no_rompe_el_canal() -> None:
    # `suma` imprime en stdout: si fuera al canal, el padre recibiría una línea que no es JSON.
    assert proceso_hijo.ejecutar(f"{_TAREAS}:suma", {"a": 1, "b": 1}) == {"suma": 2}


def test_el_error_del_hijo_llega_con_su_tipo() -> None:
    with pytest.raises(proceso_hijo.ProcesoHijoError, match="no cuadra") as e:
        proceso_hijo.ejecutar(f"{_TAREAS}:falla")
    assert e.value.tipo == "ValueError"


def test_una_tarea_que_no_existe_es_un_error_y_no_un_cuelgue() -> None:
    with pytest.raises(proceso_hijo.ProcesoHijoError) as e:
        proceso_hijo.ejecutar(f"{_TAREAS}:no_existe")
    assert e.value.tipo == "AttributeError"


def test_cancelar_para_al_hijo() -> None:
    parar = threading.Event()
    threading.Timer(1.0, parar.set).start()

    with pytest.raises(proceso_hijo.Cancelado, match="paro pedido"):
        proceso_hijo.ejecutar(f"{_TAREAS}:hasta_que_cancelen", cancel_event=parar)


def test_un_hijo_que_muere_sin_avisar_no_deja_al_padre_esperando() -> None:
    with pytest.raises(proceso_hijo.ProcesoHijoError, match="código 3"):
        proceso_hijo.ejecutar(f"{_TAREAS}:muere_sin_avisar")


def test_scan_cancelado_es_una_cancelacion_del_hijo() -> None:
    # El hijo atrapa `Cancelado`: si `ScanCancelado` no colgara de él, "Detener" saldría como error.
    from app.scan_service import ScanCancelado

    assert issubclass(ScanCancelado, proceso_hijo.Cancelado)
