"""Huecos virtuales de Omega en la liga (backlog 23-sep, decisiones cerradas 28-sep): la cartera
de Omega en la liga son 4 huecos de 500 $ (2.000 $ en total) que se van llenando con las ALERTAS
de Omega según llegan durante el mes, en orden de llegada -- así juega aunque Manuel no ejecute
nada de verdad en la sala real. Ver docs/liguilla/omega-huecos.md para el diseño original (§1-2,
el "qué es una alerta" sigue vigente) -- este módulo ya no es el diseño de un solo hueco por mes:
Omega SÍ tiene reglas de salida (objetivo/90 días, `signals.resolver_salida`) y un hueco que sale
antes de fin de mes vuelve a caja y se llena con la siguiente alerta, con su capital compuesto
(un hueco que ganó un 10% reinvierte 550 $, no 500 $). Las posiciones abiertas a fin de mes pasan
a la jornada siguiente (los huecos son persistentes dentro de una temporada).

Puro, sin BD: recibe alertas y cierres ya cargados, como `motor.rentabilidad`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import Decimal

from app.liga.motor.formato import redondear
from app.momentum.signals import TOPE_DIAS, objetivo_por_arranque
from app.precios import Cierre, cierre_en, indice

N_HUECOS = 4
CAPITAL_HUECO_USD = Decimal(500)
CAPITAL_TOTAL_USD = CAPITAL_HUECO_USD * N_HUECOS


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
    """Desempate nunca al azar: antes la más temprana; luego la caída más fuerte; luego la mayor
    capitalización (sin dato, al final); luego el ticker."""
    cap = a.market_cap if a.market_cap is not None else Decimal("-Infinity")
    return (a.momento, -a.caida_pct, -cap, a.ticker)


def detectar_salida(cierres: Sequence[Cierre], entrada_dia: date, entrada_precio: float,
                    hasta: date) -> tuple[date, float, str] | None:
    """Mismas reglas de salida que la sala real (`signals.resolver_salida`, importadas, no
    reimplementadas: objetivo por arranque a 3 sesiones o tope de 90 días) pero la venta es
    SIEMPRE al cierre del día del disparo -- nunca a la apertura del día siguiente como hace la
    sala real: en la liga el precio siempre es un cierre (regla del proyecto). `None` = sigue
    abierta a `hasta` (o aún no hay 4 cierres para fijar el objetivo).

    El objetivo nace del retorno a 3 sesiones, así que solo se evalúa desde ese cuarto cierre: la
    sala real mira también las sesiones 1 y 2 con esa ventaja de saber el futuro; en la liga un
    cruce antes de conocer el objetivo ni vende ni puede tapar las salidas posteriores."""
    serie = sorted((c for c in cierres if entrada_dia <= c.dia <= hasta), key=lambda c: c.dia)
    if len(serie) < 4:
        return None
    ret_3_sesiones = (serie[3].cierre / entrada_precio - 1) * 100
    objetivo = objetivo_por_arranque(ret_3_sesiones)
    for c in serie[3:]:
        dias = (c.dia - entrada_dia).days
        if c.cierre / entrada_precio - 1 >= objetivo:
            return c.dia, c.cierre, "objetivo"
        if dias >= TOPE_DIAS:
            return c.dia, c.cierre, "tiempo"
    return None


def simular(carry_over: Sequence[Operacion], alertas: Sequence[Alerta],
           cierres: Mapping[str, Sequence[Cierre]], dia_inicio: date, hoy: date,
           n_huecos: int = N_HUECOS) -> list[Operacion]:
    """El día a día de `diario`: recorre cada día de bolsa entre `dia_inicio` y `hoy` cerrando lo
    que toque salir (mismo cierre del día) y llenando los huecos libres con la siguiente alerta
    pendiente en orden (`_orden`), sin repetir ticker en un hueco YA abierto ni en uno ya cerrado
    este período. `carry_over`: los huecos que seguían abiertos al cierre de la jornada anterior
    (persistentes dentro de la temporada); vacío en la primera jornada. Puro y determinista:
    mismos argumentos -> mismo resultado siempre, así que repetir `diario` el mismo día (o
    reconstruir desde cero) nunca duplica nada -- la persistencia solo hace `insert ... on
    conflict do nothing` con lo que este resultado tenga de nuevo."""
    cerradas = [op for op in carry_over if not op.abierta]
    abiertos: dict[int, Operacion] = {op.numero: op for op in carry_over if op.abierta}
    usados = {op.ticker for op in list(abiertos.values()) + cerradas}
    pendientes = sorted((a for a in alertas if dia_inicio <= a.momento.date() <= hoy), key=_orden)

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
        libres = [n for n in range(1, n_huecos + 1) if n not in abiertos]
        for numero in libres:
            elegida = next((a for a in pendientes
                            if a.momento.date() <= dia and a.ticker not in usados), None)
            if elegida is None:
                continue
            precio = cierre_en(list(cierres.get(elegida.ticker, ())), dia)
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
    """Factor acumulado del hueco `numero` en `dia` (1.0 = sus 500 $ iniciales, sin variar):
    compone TODAS sus operaciones hasta esa fecha -- un hueco que ganó un 10 % reinvierte con
    550 $, nunca vuelve a 500 $. En caja (factor constante) mientras no tiene ticker."""
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
        niveles = indice(serie, dividendos=1.0)
        nivel_fin = niveles[max(d for d in niveles if d <= fin)]
        factor *= Decimal(repr(nivel_fin))
    return factor


def rentabilidad_mes(operaciones: Sequence[Operacion], cierres: Mapping[str, Sequence[Cierre]],
                     dia_inicio: date, dia_fin: date, n_huecos: int = N_HUECOS) -> Decimal:
    """R = valor total de los `n_huecos` en `dia_fin` / valor en `dia_inicio` − 1, con dividendos
    (`precios.indice(..., dividendos=1.0)`, la regla del proyecto de rentabilidad siempre bruta
    con dividendos). Un hueco vacío todo el período no cambia de valor (factor 1 a 1): cuenta
    como caja al 0 %, sin desviar el total."""
    inicio = sum((valor_hueco(n, operaciones, cierres, dia_inicio) for n in range(1, n_huecos + 1)),
                Decimal(0))
    fin = sum((valor_hueco(n, operaciones, cierres, dia_fin) for n in range(1, n_huecos + 1)),
             Decimal(0))
    if inicio == 0:
        return Decimal("0.0000")
    return redondear((fin / inicio - 1) * 100, 4)
