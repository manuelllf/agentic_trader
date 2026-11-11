from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.liga import comparativa as cp


def _periodo(retorno, base, fin, sp="1"):
    return {
        "dia_base": date.fromisoformat(base), "dia_fin": date.fromisoformat(fin),
        "rentabilidad": Decimal(str(retorno)), "sp500": Decimal(sp),
    }


class _Cierres:
    """Una consulta que solo devuelve la columna de cierres de las jornadas."""

    def __init__(self, valores):
        self.valores = valores

    def execute(self, *_, **__):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.valores))


def test_la_serie_empieza_en_cero_y_acaba_en_el_acumulado() -> None:
    periodos = [
        _periodo("2.0", "2026-09-01", "2026-09-07"),
        _periodo("3.0", "2026-09-07", "2026-09-14"),
        _periodo("-1.0", "2026-09-14", "2026-09-21"),
    ]
    serie = cp.serie_acumulada(periodos)

    assert serie == [Decimal(0), Decimal("2.0000"), Decimal("5.0600"), Decimal("4.0094")]
    assert serie[-1] == cp.acumular_periodos(periodos)["rentabilidad"]


def test_la_serie_solo_recorre_la_ventana_seguida() -> None:
    periodos = [
        _periodo("10.0", "2026-08-01", "2026-08-31"),
        _periodo("2.0", "2026-09-01", "2026-09-07"),
        _periodo("3.0", "2026-09-07", "2026-09-14"),
    ]

    assert cp.serie_acumulada(periodos) == [0, Decimal("2.0000"), Decimal("5.0600")]
    assert cp.acumular_periodos(periodos)["periodos"] == 2


def test_sin_serie_si_no_hay_periodos_o_un_retorno_es_imposible() -> None:
    assert cp.serie_acumulada([]) == []
    assert cp.serie_acumulada([_periodo("-101", "2026-09-01", "2026-09-07")]) == []


def test_el_sp_de_la_temporada_compone_cierres_y_la_jornada_en_juego() -> None:
    cierres = _Cierres([Decimal("1.00"), Decimal("2.00")])

    assert cp.rentabilidad_sp_temporada(cierres, 1, None) == Decimal("3.0200")
    assert cp.rentabilidad_sp_temporada(cierres, 1, Decimal("-1.00")) == Decimal("1.9898")
    assert cp.rentabilidad_sp_temporada(_Cierres([]), 1, None) is None
    assert cp.rentabilidad_sp_temporada(_Cierres([]), 1, Decimal("0.50")) == Decimal("0.5000")
