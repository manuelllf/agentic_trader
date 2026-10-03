"""Contiguous official-period return summaries never bridge missing windows."""

from datetime import date, timedelta
from decimal import Decimal

from app.liga.comparativa import _factor_clasificacion, acumular_periodos


def _periodo(base: date, rentabilidad: str, sp500: str) -> dict:
    return {"dia_base": base, "dia_fin": base + timedelta(days=30),
            "rentabilidad": Decimal(rentabilidad), "sp500": Decimal(sp500)}


def test_compounds_strategy_and_benchmark_over_identical_closed_periods() -> None:
    base = date(2026, 1, 30)
    result = acumular_periodos([
        _periodo(base, "10", "5"),
        _periodo(base + timedelta(days=30), "-2", "1"),
    ])

    assert result == {
        "rentabilidad": Decimal("7.8000"),
        "sp500": Decimal("6.0500"),
        "diferencia_pp": Decimal("1.7500"),
        "desde": base,
        "hasta": base + timedelta(days=60),
        "periodos": 2,
        "incompleta": False,
    }


def test_a_gap_restarts_the_comparable_window_and_marks_it_incomplete() -> None:
    base = date(2026, 1, 30)
    result = acumular_periodos([
        _periodo(base, "10", "5"),
        _periodo(base + timedelta(days=45), "-2", "1"),
        _periodo(base + timedelta(days=75), "3", "2"),
    ])

    assert result == {
        "rentabilidad": Decimal("0.9400"),
        "sp500": Decimal("3.0200"),
        "diferencia_pp": Decimal("-2.0800"),
        "desde": base + timedelta(days=45),
        "hasta": base + timedelta(days=105),
        "periodos": 2,
        "incompleta": True,
    }


def test_impossible_return_is_not_fabricated_but_rank_factor_matches_view_floor() -> None:
    base = date(2026, 1, 30)
    assert acumular_periodos([_periodo(base, "-100.0001", "0")]) is None
    assert _factor_clasificacion(Decimal("-100.0001")) == Decimal("0.000000001")
    assert _factor_clasificacion(Decimal("-100")) == Decimal("0.000000001")


def test_nonfinite_return_does_not_produce_financial_summary() -> None:
    base = date(2026, 1, 30)
    assert acumular_periodos([_periodo(base, "NaN", "0")]) is None
