"""Huecos virtuales de Omega en la liga (backlog 23-sep): hoy la cartera de Omega en la liga son
sus posiciones reales abiertas en el corte (`procesos.casa.omega_abiertas`) -- si Manuel no abre
nada ese mes, Omega no juega. Este motor sustituye eso por 4 huecos de 500 $ (2.000 $ en total)
que se van llenando con las ALERTAS de Omega según llegan durante el mes, en orden de llegada:
así juega aunque no se ejecute nada de verdad. Ver docs/liguilla/omega-huecos.md para el diseño
completo, el cambio de esquema propuesto y cómo encajaría en `formar`/`diario`/`cerrar`.

Puro, sin BD: recibe alertas y cierres ya cargados, como `motor.rentabilidad`. Un hueco, una vez
lleno, se queda con esa alerta hasta el cierre del mes (no se libera si Omega la resuelve antes:
ver el porqué en el doc); un hueco que nunca se llena rinde 0 % todo el mes, como la caja.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from app.liga.motor.formato import redondear
from app.precios import Cierre, indice

N_HUECOS = 4
CAPITAL_HUECO_USD = Decimal(500)
CAPITAL_TOTAL_USD = CAPITAL_HUECO_USD * N_HUECOS
PESO_HUECO = Decimal(100) / N_HUECOS  # 25 %, la misma cuenta que `motor.rentabilidad` (peso · r)


@dataclass(frozen=True)
class Alerta:
    """Una alerta de Omega tal como llega: una fila nueva de `momentum_senales` (ver el doc,
    §"qué es una alerta"). `caida_pct`: positivo, como lo guarda la sala (más alto = caída más
    fuerte). `market_cap`: en USD si se conoce; solo desempata un empate exacto de instante."""

    ticker: str
    momento: datetime
    caida_pct: Decimal
    market_cap: Decimal | None = None


@dataclass(frozen=True)
class Hueco:
    """Un hueco del mes. `ticker` y `entrada` son `None` si nunca se llenó (caja todo el mes)."""

    numero: int
    ticker: str | None
    entrada: datetime | None


def _orden(a: Alerta) -> tuple:
    """Desempate nunca al azar: antes la más temprana; luego la caída más fuerte; luego la mayor
    capitalización (sin dato, al final); luego el ticker."""
    # Sin capitalización, pierde cualquier empate frente a una que sí la tenga (nunca al azar).
    cap = a.market_cap if a.market_cap is not None else Decimal("-Infinity")
    return (a.momento, -a.caida_pct, -cap, a.ticker)


def asignar_huecos(alertas: Sequence[Alerta], n_huecos: int = N_HUECOS) -> list[Hueco]:
    """Llena los huecos en orden de llegada (con el desempate de `_orden`). Un ticker no ocupa
    dos huecos el mismo mes: una alerta repetida de uno ya asignado se ignora para este cómputo."""
    ordenadas = sorted(alertas, key=_orden)
    huecos: list[Hueco] = []
    ocupados: set[str] = set()
    for a in ordenadas:
        if len(huecos) >= n_huecos:
            break
        if a.ticker in ocupados:
            continue
        huecos.append(Hueco(len(huecos) + 1, a.ticker, a.momento))
        ocupados.add(a.ticker)
    huecos += [Hueco(i, None, None) for i in range(len(huecos) + 1, n_huecos + 1)]
    return huecos


def _fraccion(hueco: Hueco, cierres: Sequence[Cierre], dia_fin: date) -> Decimal:
    """(nivel − 1) del hueco a `dia_fin`, total con dividendos -- misma cuenta que
    `precios.indice` / `motor.rentabilidad`. Su día base es el de su propia entrada, no el día 1
    de la jornada: por eso no se puede reusar `rentabilidad_cartera` tal cual."""
    dia_entrada = hueco.entrada.date()  # type: ignore[union-attr]
    if dia_entrada > dia_fin:
        raise ValueError(f"{hueco.ticker}: entró el {dia_entrada}, después del {dia_fin}")
    serie = sorted((c for c in cierres if c.dia >= dia_entrada), key=lambda c: c.dia)
    if not serie or serie[0].dia != dia_entrada:
        raise ValueError(f"{hueco.ticker}: falta el cierre de su entrada ({dia_entrada})")
    dias = tuple(c.dia for c in serie)
    if len(set(dias)) != len(dias):
        raise ValueError(f"{hueco.ticker}: hay días con dos cierres")
    if dias[-1] < dia_fin:
        raise ValueError(f"{hueco.ticker}: falta el cierre del mes ({dia_fin})")
    niveles = indice(serie, dividendos=1.0)
    en_fin = niveles[max(d for d in dias if d <= dia_fin)]
    return Decimal(repr(en_fin)) - 1


def rentabilidad_hueco(hueco: Hueco, cierres: Sequence[Cierre], dia_fin: date) -> Decimal:
    """Rentabilidad total (%) del hueco desde su entrada hasta `dia_fin`; 0 si nunca se llenó."""
    if hueco.ticker is None:
        return Decimal("0.0000")
    return redondear(_fraccion(hueco, cierres, dia_fin) * 100, 4)


def rentabilidad_mes(huecos: Sequence[Hueco], cierres: Mapping[str, Sequence[Cierre]],
                     dia_fin: date) -> Decimal:
    """R = Σ 25 % · r_hueco, caja (hueco vacío) a 0 % -- la misma cuenta `peso · r` que el resto
    de la liga (`motor.rentabilidad.rentabilidad_cartera`), sobre los 2.000 $ de los 4 huecos."""
    total = Decimal(0)
    for h in huecos:
        if h.ticker is None:
            continue
        total += PESO_HUECO * _fraccion(h, cierres.get(h.ticker, ()), dia_fin)
    return redondear(total, 4)
