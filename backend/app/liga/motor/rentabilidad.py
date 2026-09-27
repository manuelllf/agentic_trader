"""Rentabilidad de una cartera de la liga: compra y mantén con los pesos del día 1 (plan §8).

Cada posición rinde su rentabilidad total desde el cierre de `dia_base`, con los dividendos en
bruto y los splits (`app.precios.indice`), y la caja (100 − Σ pesos) rinde 0 %: R = Σ peso · r.
Un valor que deja de cotizar se queda con su último valor, como si fuera caja.

Las cifras salen en % con 4 decimales, como se guardan (`numeric(10,4)`): los puntos de la
jornada se calculan sobre lo guardado, y así el registro oficial se puede rehacer.
"""

from __future__ import annotations

from bisect import bisect_right
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from fractions import Fraction

from app.liga.motor.formato import a_decimal, redondear
from app.liga.motor.seleccion import redondear_pesos
from app.precios import REFERENCIA, Cierre, indice

Posicion = tuple[str, Decimal]
_CIEN = Decimal(100)


@dataclass(frozen=True)
class _Curva:
    """Nivel de rentabilidad total de un ticker en cada día con cierre (1 el día base)."""

    dias: tuple[date, ...]
    niveles: tuple[Decimal, ...]

    def en(self, dia: date) -> Decimal:
        # El último nivel a esa fecha, como `cierre_en`: cubre festivos, huecos y exclusiones.
        return self.niveles[bisect_right(self.dias, dia) - 1]


def rentabilidad_cartera(posiciones: Sequence[Posicion], cierres: Mapping[str, list[Cierre]],
                         dia_base: date, dia: date) -> Decimal:
    """Rentabilidad acumulada (%) desde el cierre de `dia_base` hasta el de `dia`.

    `posiciones`: (ticker, peso en %) fijadas el día base. `ValueError` si falta el cierre del
    día base de alguna: sin precio de compra no hay rentabilidad."""
    return serie_diaria(posiciones, cierres, dia_base, [dia])[0][1]


def serie_diaria(posiciones: Sequence[Posicion], cierres: Mapping[str, list[Cierre]],
                 dia_base: date, dias: Sequence[date]) -> list[tuple[date, Decimal]]:
    """La rentabilidad acumulada (%) de cada día de `dias`, con cada curva calculada una vez."""
    _validar(posiciones)
    curvas = _curvas(posiciones, cierres, dia_base)
    serie: list[tuple[date, Decimal]] = []
    for dia in dias:
        if dia < dia_base:
            raise ValueError(f"{dia} es anterior al día base ({dia_base})")
        r = sum((peso * (curvas[t].en(dia) - 1) for t, peso in posiciones), Decimal(0))
        serie.append((dia, redondear(r, 4)))
    return serie


def pesos_mantenidos(posiciones: Sequence[Posicion], cierres: Mapping[str, list[Cierre]],
                     dia_base: date, dia_fin: date) -> list[Posicion]:
    """Los pesos con los que una estrategia «Mantenerla» empieza la jornada siguiente.

    Cada posición crece con su rentabilidad total, la caja se queda igual y todo se vuelve a
    expresar sobre 100, caja incluida (la caja es lo que falta hasta 100). Lo que no tiene
    cierre el `dia_fin` (dejó de cotizar) pasa a caja: no tendría precio base al mes siguiente.
    Lo que se queda en 0 al redondear, también (`liga.posiciones` exige peso > 0)."""
    _validar(posiciones)
    if dia_fin < dia_base:
        raise ValueError(f"{dia_fin} es anterior al día base ({dia_base})")
    curvas = _curvas(posiciones, cierres, dia_base)
    valores = {t: Fraction(peso) * Fraction(curvas[t].en(dia_fin)) for t, peso in posiciones}
    caja = 100 - sum((Fraction(peso) for _, peso in posiciones), Fraction(0))
    total = sum(valores.values(), Fraction(0)) + caja
    if total <= 0:
        raise ValueError("la cartera no vale nada al final de la jornada")
    siguen = [t for t, _ in posiciones if dia_fin in curvas[t].dias]
    pesos = redondear_pesos([valores[t] / total * 100 for t in siguen])
    return [(t, p) for t, p in zip(siguen, pesos, strict=True) if p > 0]


def rentabilidad_sp(cierres_sp: list[Cierre], dia_base: date, dia: date) -> Decimal:
    """La del S&P (`REFERENCIA`, el SPY) con la misma cuenta: todo invertido, sin caja."""
    return rentabilidad_cartera([(REFERENCIA, _CIEN)], {REFERENCIA: cierres_sp}, dia_base, dia)


def _validar(posiciones: Sequence[Posicion]) -> None:
    vistos: set[str] = set()
    total = Decimal(0)
    for ticker, peso in posiciones:
        if isinstance(peso, bool) or not isinstance(peso, Decimal | int):
            raise TypeError(f"{ticker}: el peso va en Decimal, no en {type(peso).__name__}")
        if peso < 0:
            raise ValueError(f"{ticker}: peso negativo")
        if ticker in vistos:
            raise ValueError(f"{ticker} está dos veces en la cartera")
        vistos.add(ticker)
        total += peso
    if total > _CIEN:
        raise ValueError(f"los pesos suman {total} %, más de 100")


def _curvas(posiciones: Sequence[Posicion], cierres: Mapping[str, list[Cierre]],
            dia_base: date) -> dict[str, _Curva]:
    curvas: dict[str, _Curva] = {}
    for ticker, _ in posiciones:
        serie = sorted((c for c in cierres.get(ticker, ()) if c.dia >= dia_base),
                       key=lambda c: c.dia)
        if not serie or serie[0].dia != dia_base:
            raise ValueError(f"{ticker}: falta el cierre del día base ({dia_base}), su precio "
                             "de compra")
        dias = tuple(c.dia for c in serie)
        if len(set(dias)) != len(dias):
            raise ValueError(f"{ticker}: hay días con dos cierres")
        niveles = indice(serie, dividendos=1.0)
        curvas[ticker] = _Curva(dias, tuple(_nivel(ticker, niveles[d]) for d in dias))
    return curvas


def _nivel(ticker: str, nivel: float) -> Decimal:
    d = a_decimal(nivel)
    if d is None:
        raise ValueError(f"{ticker}: la rentabilidad no es un número ({nivel})")
    return d
