"""Valoración por escenarios: el agente pone los supuestos, el código hace las cuentas.
Precio final = beneficio por acción del último año × PER, descontado a hoy y frente al precio."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.agente import calculos

MAX_ESCENARIOS = 6
ANIOS = (1, 10)
TASA = (0.03, 0.30)
TOLERANCIA_PROBABILIDAD = 0.01


@dataclass(frozen=True)
class Escenario:
    nombre: str
    bpa: float
    per: float
    probabilidad: float


def numero(v: Any, campo: str) -> float:  # noqa: ANN401
    if isinstance(v, bool):
        raise ValueError(f"{campo} must be a number")
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{campo} must be a number") from None
    if n != n or n in (float("inf"), float("-inf")):
        raise ValueError(f"{campo} must be a finite number")
    return n


def _en_rango(n: float, rango: tuple[float, float], campo: str) -> float:
    if not rango[0] <= n <= rango[1]:
        raise ValueError(f"{campo} must be between {rango[0]} and {rango[1]}")
    return n


def leer_escenarios(crudos: Any) -> list[Escenario]:  # noqa: ANN401
    """Valida la lista del agente. Probabilidades en todos o en ninguno (entonces pesos iguales)."""
    if not isinstance(crudos, list) or not 1 <= len(crudos) <= MAX_ESCENARIOS:
        raise ValueError(f"scenarios must be a list of 1 to {MAX_ESCENARIOS} objects")
    if not all(isinstance(c, dict) for c in crudos):
        raise ValueError("each scenario must be an object")
    con_prob = [c.get("probability") is not None for c in crudos]
    if any(con_prob) and not all(con_prob):
        raise ValueError("give probability in every scenario or in none")
    out = []
    for i, c in enumerate(crudos, 1):
        per = numero(c.get("pe"), f"scenario {i} pe")
        if per <= 0:
            raise ValueError(f"scenario {i} pe must be positive")
        prob = (_en_rango(numero(c["probability"], f"scenario {i} probability"), (0.0, 1.0),
                          f"scenario {i} probability") if all(con_prob) else 1.0 / len(crudos))
        out.append(Escenario(str(c.get("name") or f"scenario {i}")[:40],
                             numero(c.get("eps"), f"scenario {i} eps"), per, prob))
    if abs(sum(e.probabilidad for e in out) - 1.0) > TOLERANCIA_PROBABILIDAD:
        raise ValueError("probabilities must add up to 1")
    return out


def _valor_dividendos(dividendo: float, tasa: float, anios: int) -> float:
    """Valor de hoy de un dividendo anual fijo durante los años del horizonte."""
    return sum(dividendo / (1.0 + tasa) ** k for k in range(1, anios + 1))


def _r(x: float | None, n: int = 4) -> float | None:
    return None if x is None else round(x, n)


def valorar(precio: float, escenarios: list[Escenario], anios: int, tasa: float,
            dividendo: float = 0.0, margen_objetivo: float | None = None) -> dict:
    if precio <= 0:
        raise ValueError("current price must be positive")
    anios = int(_en_rango(float(anios), ANIOS, "years"))
    tasa = _en_rango(tasa, TASA, "discount_rate")
    if dividendo < 0:
        raise ValueError("dividend_per_share must not be negative")
    if margen_objetivo is not None:
        margen_objetivo = _en_rango(margen_objetivo, (0.0, 0.9), "target_margin")
    pv_div = _valor_dividendos(dividendo, tasa, anios)

    filas, valor_esperado, final_esperado = [], 0.0, 0.0
    for e in escenarios:
        # Un beneficio negativo no da un precio negativo: el suelo es cero.
        final = max(e.bpa * e.per, 0.0)
        hoy = (calculos.valor_presente(final, tasa, anios) or 0.0) + pv_div
        valor_esperado += e.probabilidad * hoy
        final_esperado += e.probabilidad * final
        filas.append({
            "name": e.nombre, "probability": _r(e.probabilidad), "eps": e.bpa, "pe": e.per,
            "price_final": _r(final, 2), "value_today": _r(hoy, 2),
            "return_total": _r(final / precio - 1.0),
            "return_annual": _r(calculos.retorno_anual_esperado(precio, final, anios, dividendo))
            if final > 0 else -1.0,
        })
    peor = min(filas, key=lambda f: f["value_today"] or 0.0)
    return {
        "price": round(precio, 2), "years": anios, "discount_rate": tasa,
        "dividend_per_share": dividendo, "scenarios": filas,
        "expected_value_today": _r(valor_esperado, 2),
        "expected_price_final": _r(final_esperado, 2),
        "margin_of_safety": _r(calculos.margen_de_seguridad(precio, valor_esperado))
        if valor_esperado > 0 else None,
        "expected_return_annual": _r(calculos.retorno_anual_esperado(
            precio, final_esperado, anios, dividendo)) if final_esperado > 0 else -1.0,
        "worst_scenario": peor["name"], "worst_value_today": peor["value_today"],
        "price_for_target_margin": _r(valor_esperado * (1.0 - margen_objetivo), 2)
        if margen_objetivo is not None else None,
        "note": "Computed by code from your assumptions; the assumptions are yours.",
    }
