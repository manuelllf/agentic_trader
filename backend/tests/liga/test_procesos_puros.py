"""Procesos de la liga sin BD: calendario de temporadas, pesos de la casa, clave de la caché de la
pregunta, candado en proceso y el job diario."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.liga.procesos import casa, comun, datos, diario, formar, temporadas
from app.liga.procesos.estado import _siguiente

# ---- temporadas ---------------------------------------------------------------------------------


def test_pretemporada_con_los_meses_que_aun_no_han_empezado() -> None:
    planes = temporadas.planificar(date(2026, 9, 27))
    pre, t1 = planes
    assert (pre.nombre, pre.cuenta) == (temporadas.PRETEMPORADA, False)
    assert [(j.anio, j.mes) for j in pre.jornadas] == [(2026, 10), (2026, 11), (2026, 12)]
    assert (t1.nombre, t1.cuenta, len(t1.jornadas)) == (temporadas.TEMPORADA_1, True, 12)
    enero = t1.jornadas[0].fechas
    assert (enero.dia_base, enero.dia_inicio, enero.dia_fin) == \
        (date(2026, 12, 31), date(2027, 1, 4), date(2027, 1, 29))


def test_sin_meses_libres_no_hay_pretemporada() -> None:
    assert [p.nombre for p in temporadas.planificar(date(2026, 12, 3))] == [temporadas.TEMPORADA_1]
    assert [p.nombre for p in temporadas.planificar(date(2026, 11, 30))] == \
        [temporadas.PRETEMPORADA, temporadas.TEMPORADA_1]


def test_jornadas_de_la_temporada_encadenadas() -> None:
    t1 = temporadas.planificar(date(2026, 12, 3))[0]
    for a, b in zip(t1.jornadas, t1.jornadas[1:], strict=False):
        assert b.fechas.dia_base == a.fechas.dia_fin   # el día base es el último del mes anterior


# ---- pesos de la casa ---------------------------------------------------------------------------


def test_porcentajes_de_las_salas_a_pesos_de_la_liga() -> None:
    assert casa.pesos_desde_porcentajes([("A", 20.0), ("B", 20.0), ("C", 20.0), ("D", 20.0),
                                         ("E", 20.0)]) == [(t, Decimal("20.0000")) for t in "ABCDE"]
    tres = casa.pesos_desde_porcentajes([("A", 33.33), ("B", 33.33), ("C", 33.33)])
    assert sum(p for _, p in tres) == Decimal("99.99")      # el resto, en caja, como se guardó


def test_porcentajes_que_se_pasan_de_100_se_escalan_y_los_ceros_fuera() -> None:
    pesos = casa.pesos_desde_porcentajes([("A", 50.01), ("B", 50.0), ("C", 0.0), ("A", 0.0)])
    assert [t for t, _ in pesos] == ["A", "B"]
    assert sum(p for _, p in pesos) == Decimal("100.0000")


def test_lambda_de_scan_audit_reparte_a_partes_iguales() -> None:
    tickers = ["AGI", "AU", "MU", "TER", "TSM"]
    pesos = casa.pesos_desde_porcentajes((t, Decimal(100) / 5) for t in tickers)
    assert pesos == [(t, Decimal("20.0000")) for t in tickers]


# ---- pregunta propia ----------------------------------------------------------------------------


def test_la_misma_pregunta_escrita_distinto_es_la_misma_clave() -> None:
    a = datos.hash_pregunta("¿Tiene  ventaja duradera?")
    assert a == datos.hash_pregunta("  ¿TIENE ventaja\nduradera? ")
    assert len(a) == 64 and a != datos.hash_pregunta("¿Tiene deuda?")


# ---- estado y motivos ---------------------------------------------------------------------------


@dataclass
class _J:
    estado: str = "programada"
    foto_id: int | None = None
    scan_run_id: int | None = None
    cierre_inscripcion: datetime = datetime(2026, 12, 31, 22, 59, tzinfo=UTC)


def test_formar_dice_por_que_no_esta_lista() -> None:
    antes = datetime(2026, 12, 31, 12, tzinfo=UTC)
    motivos = formar.motivos_no_lista(_J(), antes)
    assert len(motivos) == 2 and "foto" in motivos[0] and "corte" in motivos[1]
    lista = _J(foto_id=1, scan_run_id=2)
    assert formar.motivos_no_lista(lista, datetime(2027, 1, 1, tzinfo=UTC)) == []
    assert "formada" in formar.motivos_no_lista(_J("formada", 1, 2), None)[0]


def test_siguiente_paso_de_cada_jornada() -> None:
    assert _siguiente(_J()) == "foto"
    assert _siguiente(_J(foto_id=1, scan_run_id=2)) == "formar"
    assert _siguiente(_J("formada")) == "cerrar"
    assert _siguiente(_J("cerrada")) is None


# ---- candado y job ------------------------------------------------------------------------------


class _SesionFalsa:
    def get_bind(self):  # noqa: ANN202
        class _B:
            class dialect:  # noqa: N801
                name = "sqlite"
        return _B()

    def commit(self) -> None: ...
    def close(self) -> None: ...


def test_el_candado_no_deja_correr_dos_a_la_vez() -> None:
    dentro, salir = threading.Event(), threading.Event()

    def primero() -> None:
        with comun.candado("cerrar", _SesionFalsa):
            dentro.set()
            salir.wait(5)

    hilo = threading.Thread(target=primero)
    hilo.start()
    assert dentro.wait(5)
    with pytest.raises(comun.ProcesoOcupado), comun.candado("cerrar", _SesionFalsa):
        pass
    salir.set()
    hilo.join(5)
    with comun.candado("cerrar", _SesionFalsa):   # suelto, se puede volver a tomar
        pass


def test_el_job_diario_no_hace_nada_en_festivo_ni_en_fin_de_semana() -> None:
    def nunca():  # noqa: ANN202
        raise AssertionError("no debía abrir sesión")

    navidad = datetime(2026, 12, 25, 22, 15, tzinfo=UTC)
    domingo = datetime(2026, 9, 27, 21, 15, tzinfo=UTC)
    assert diario.job(nunca, navidad) is None
    assert diario.job(nunca, domingo) is None


def test_para_json_convierte_lo_que_no_es_json() -> None:
    assert comun.para_json({"a": Decimal("1.50"), "b": [date(2027, 1, 4)], 3: {"c"}}) == \
        {"a": "1.50", "b": ["2027-01-04"], "3": ["c"]}
