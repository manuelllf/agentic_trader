"""Cinco huecos independientes, sin capital.
Cada hueco se mantiene hasta su salida y su valor es el producto de sus retornos.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import Decimal

import pandas as pd

from app.liga.motor.formato import redondear
from app.momentum.signals import resolver_salida
from app.precios import Cierre, indice

N_HUECOS = 5
ALERTA_MAX_DIAS = 5


@dataclass(frozen=True)
class Alerta:
    """Una alerta de Omega tal como llega: una fila nueva de `momentum_senales` (ver el doc,
    §"qué es una alerta"). `caida_pct`: positivo, como lo guarda la sala (más alto = caída más
    fuerte). `market_cap`: en USD si se conoce; solo desempata un empate exacto de instante."""

    ticker: str
    momento: datetime
    caida_pct: Decimal
    market_cap: Decimal | None = None
    senal_id: int | None = None


@dataclass(frozen=True)
class Operacion:
    """Una compra-venta de un hueco (puede haber varias por hueco en una misma jornada, o a lo
    largo de varias: el hueco sigue abierto si `salida_dia` es `None`). `motivo`: "objetivo" o
    "tiempo" (las dos únicas salidas de `signals.resolver_salida`); `None` mientras sigue abierta.
    """

    numero: int
    ticker: str
    entrada_dia: date
    entrada_precio: float
    salida_dia: date | None = None
    salida_precio: float | None = None
    motivo: str | None = None
    senal_id: int | None = None

    @property
    def abierta(self) -> bool:
        return self.salida_dia is None


def _orden(a: Alerta) -> tuple:
    """Más reciente primero; a igual instante, mayor capitalización y luego ticker."""
    cap = a.market_cap if a.market_cap is not None else Decimal("-Infinity")
    return (-a.momento.timestamp(), -cap, a.ticker)


def detectar_salida(cierres: Sequence[Cierre], entrada_dia: date, entrada_precio: float,
                    hasta: date) -> tuple[date, float, str] | None:
    """Reglas de salida de la sala, con venta al cierre del día del disparo."""
    serie = sorted((c for c in cierres if entrada_dia <= c.dia <= hasta), key=lambda c: c.dia)
    if len(serie) < 4:
        return None
    # El objetivo no existe antes de la cuarta sesión.
    valores = [c.cierre if i == 0 or i >= 3 else entrada_precio
               for i, c in enumerate(serie)]
    fechas = [pd.Timestamp(c.dia) for c in serie]
    # Apertura virtual: el cierre del disparo.
    fechas.append(fechas[-1] + pd.Timedelta(days=1))
    valores.append(valores[-1])
    niveles = pd.Series(valores, index=fechas)
    aperturas = pd.Series([valores[0], *valores[:-1]], index=fechas)
    salida = resolver_salida(niveles, aperturas, pd.Timestamp(entrada_dia), entrada_precio)
    if not salida["resuelta"]:
        return None
    posicion = fechas.index(salida["exit_date"]) - 1
    cierre = serie[posicion]
    return cierre.dia, cierre.cierre, salida["motivo"]


def simular(carry_over: Sequence[Operacion], alertas: Sequence[Alerta],
           cierres: Mapping[str, Sequence[Cierre]], dia_inicio: date, hoy: date,
           n_huecos: int = N_HUECOS) -> list[Operacion]:
    """Mantiene los huecos abiertos y los rellena sin repetir valores ni usar alertas viejas."""
    cerradas = [op for op in carry_over if not op.abierta]
    abiertos: dict[int, Operacion] = {op.numero: op for op in carry_over if op.abierta}
    usados = {op.ticker for op in list(abiertos.values()) + cerradas}
    minimo = dia_inicio - timedelta(days=ALERTA_MAX_DIAS)
    pendientes = sorted((a for a in alertas if minimo <= a.momento.date() <= hoy),
                        key=_orden)

    dias = sorted({c.dia for serie in cierres.values() for c in serie
                  if dia_inicio <= c.dia <= hoy})
    resultado: list[Operacion] = list(cerradas)
    for dia in dias:
        for numero, op in list(abiertos.items()):
            salida = detectar_salida(cierres.get(op.ticker, ()), op.entrada_dia,
                                     op.entrada_precio, dia)
            if salida is not None:
                dia_s, precio_s, motivo = salida
                resultado.append(replace(op, salida_dia=dia_s, salida_precio=precio_s,
                                         motivo=motivo))
                del abiertos[numero]
        reservados = {op.numero for op in cerradas if op.salida_dia > dia}
        libres = [n for n in range(1, n_huecos + 1)
                  if n not in abiertos and n not in reservados]
        for numero in libres:
            elegida = next((a for a in pendientes
                            if dia - timedelta(days=ALERTA_MAX_DIAS) <= a.momento.date() <= dia
                            and a.ticker not in usados
                            and any(c.dia == dia and c.cierre > 0
                                    for c in cierres.get(a.ticker, ()))), None)
            if elegida is None:
                continue
            # El cierre de ESE día, no el último anterior: una entrada sin cierre propio dejaría
            # una operación que `valor_hueco` no sabe valorar.
            precio = next((c.cierre for c in cierres.get(elegida.ticker, ()) if c.dia == dia),
                          None)
            if precio is None or precio <= 0:
                continue  # sin cierre ese día -- se reintenta el día siguiente con la misma alerta
            abiertos[numero] = Operacion(numero, elegida.ticker, dia, precio,
                                         senal_id=elegida.senal_id)
            usados.add(elegida.ticker)
            pendientes.remove(elegida)
    resultado += list(abiertos.values())
    return sorted(resultado, key=lambda o: (o.numero, o.entrada_dia))


def valor_hueco(numero: int, operaciones: Sequence[Operacion],
               cierres: Mapping[str, Sequence[Cierre]], dia: date) -> Decimal:
    """Producto de los retornos del hueco; un hueco en caja vale 1."""
    ordenadas = sorted((o for o in operaciones if o.numero == numero), key=lambda o: o.entrada_dia)
    for anterior, siguiente in zip(ordenadas, ordenadas[1:], strict=False):
        if anterior.salida_dia is None or anterior.salida_dia > siguiente.entrada_dia:
            raise ValueError(f"Operaciones solapadas en el hueco {numero}")
    factor = Decimal(1)
    for op in sorted((o for o in operaciones if o.numero == numero), key=lambda o: o.entrada_dia):
        if op.entrada_dia > dia:
            break
        fin = op.salida_dia if (op.salida_dia is not None and op.salida_dia <= dia) else dia
        serie = sorted((c for c in cierres.get(op.ticker, ()) if op.entrada_dia <= c.dia <= fin),
                       key=lambda c: c.dia)
        if not serie or serie[0].dia != op.entrada_dia:
            raise ValueError(f"hueco {numero} ({op.ticker}): falta el cierre de su entrada "
                             f"({op.entrada_dia})")
        # Sin el cierre de `fin` se usa el último conocido, igual que en las demás carteras; el
        # llamador lo avisa en `sin_cierre` y `cerrar` no cierra hasta que se acepte.
        serie[0] = replace(serie[0], cierre=op.entrada_precio)
        if op.salida_dia is not None and op.salida_dia <= dia and op.salida_precio is not None:
            serie = [c for c in serie if c.dia != op.salida_dia]
            serie.append(replace(next((c for c in cierres.get(op.ticker, ())
                                       if c.dia == op.salida_dia),
                                      Cierre(op.salida_dia, op.salida_precio)),
                                 cierre=op.salida_precio))
        niveles = indice(serie, dividendos=1.0)
        nivel_fin = niveles[max(d for d in niveles if d <= fin)]
        factor *= Decimal(repr(nivel_fin))
    return factor


def rentabilidad_mes(operaciones: Sequence[Operacion], cierres: Mapping[str, Sequence[Cierre]],
                     dia_inicio: date, dia_fin: date, n_huecos: int = N_HUECOS) -> Decimal:
    """Media de los cinco huecos en dia_fin, menos uno."""
    fin = sum((valor_hueco(n, operaciones, cierres, dia_fin) for n in range(1, n_huecos + 1)),
              Decimal(0))
    return redondear((fin / n_huecos - 1) * 100, 4)
