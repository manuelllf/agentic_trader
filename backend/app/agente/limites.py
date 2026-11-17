"""Capa inmutable del agente: reglas que el modelo nunca cambia, comprobadas antes de cada paso.
Viven en código y no en el prompt porque pedirlas en el prompt no basta."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal
from enum import StrEnum

from app.commissions import commission
from app.ledger.money import D

ZERO = D("0")
UNO = D("1")
# Se compran fracciones de acción, como en IBKR: cuatro decimales.
PASO_ACCIONES = D("0.0001")


def acciones_por_importe(importe: Decimal, precio: Decimal) -> Decimal:
    """Las acciones que caben en un importe, redondeando hacia abajo a la fracción mínima."""
    if importe <= ZERO or precio <= ZERO:
        return ZERO
    return (importe / precio).quantize(PASO_ACCIONES, rounding=ROUND_DOWN)


@dataclass(frozen=True)
class Limites:
    max_posiciones: int = 5
    peso_max_compra: Decimal = D("0.30")           # peso máximo tras una compra
    peso_max_compra_defensivo: Decimal = D("0.15")  # en modo defensivo, compras más pequeñas
    peso_revision: Decimal = D("0.45")             # al llegar, revisión escrita, no venta
    caida_posicion_revision: Decimal = D("-0.30")  # posición frente a su coste medio
    caida_defensiva: Decimal = D("-0.30")          # cartera frente a su máximo histórico
    caida_pausa: Decimal = D("-0.50")
    presupuesto_ia_mes_usd: Decimal = D("10")
    apertura_max_sobre_cierre: Decimal = D("0.03")
    dias_sin_abrir_antes_de_evento: int = 7        # resultados o evento binario


LIMITES = Limites()


@dataclass(frozen=True)
class Posicion:
    ticker: str
    acciones: Decimal
    coste_medio: Decimal
    precio: Decimal

    @property
    def valor(self) -> Decimal:
        return self.acciones * self.precio

    @property
    def rentabilidad(self) -> Decimal:
        return self.precio / self.coste_medio - UNO


@dataclass(frozen=True)
class Cartera:
    caja: Decimal
    posiciones: tuple[Posicion, ...]
    valor_maximo: Decimal

    @property
    def valor_total(self) -> Decimal:
        return self.caja + sum((p.valor for p in self.posiciones), ZERO)

    def posicion(self, ticker: str) -> Posicion | None:
        for p in self.posiciones:
            if p.ticker == ticker:
                return p
        return None

    def peso(self, ticker: str) -> Decimal:
        total = self.valor_total
        p = self.posicion(ticker)
        if p is None or total == ZERO:
            return ZERO
        return p.valor / total

    @property
    def caida_desde_maximo(self) -> Decimal:
        if self.valor_maximo <= ZERO:
            return ZERO
        return self.valor_total / self.valor_maximo - UNO


@dataclass(frozen=True)
class PropuestaCompra:
    ticker: str
    importe: Decimal
    precio: Decimal
    salidas: str          # condiciones de salida escritas
    ruptura: str          # condición que rompe la tesis
    proximo_evento: date | None


@dataclass(frozen=True)
class PropuestaVenta:
    ticker: str
    acciones: Decimal


class Modo(StrEnum):
    NORMAL = "normal"
    DEFENSIVO = "defensivo"
    PAUSA = "pausa"
    PARADA = "parada"


@dataclass(frozen=True)
class Violacion:
    codigo: str
    detalle: str


@dataclass(frozen=True)
class Alerta:
    codigo: str
    ticker: str | None
    valor: Decimal


def modo(cartera: Cartera, parada: bool, limites: Limites = LIMITES) -> Modo:
    """La marca de parada solo la cambia el admin; el resto sale de la caída desde máximos."""
    if parada:
        return Modo.PARADA
    caida = cartera.caida_desde_maximo
    if caida <= limites.caida_pausa:
        return Modo.PAUSA
    if caida <= limites.caida_defensiva:
        return Modo.DEFENSIVO
    return Modo.NORMAL


def _modo_bloquea(m: Modo) -> list[Violacion]:
    if m is Modo.PARADA:
        return [Violacion("parada", "El agente está parado por el administrador.")]
    if m is Modo.PAUSA:
        return [Violacion("pausa", "Cartera en pausa por caída desde máximos; decide Manuel.")]
    return []


def comprobar_compra(p: PropuestaCompra, cartera: Cartera, hoy: date, parada: bool,
                     limites: Limites = LIMITES) -> list[Violacion]:
    """Acumula todas las violaciones; lista vacía significa compra permitida."""
    m = modo(cartera, parada, limites)
    v = _modo_bloquea(m)
    if p.importe <= ZERO:
        v.append(Violacion("importe_no_positivo", "El importe debe ser mayor que cero."))
    if p.precio <= ZERO:
        v.append(Violacion("precio_no_positivo", "El precio debe ser mayor que cero."))
    if not p.salidas.strip():
        v.append(Violacion("sin_salidas", "Falta escribir las condiciones de salida."))
    if not p.ruptura.strip():
        v.append(Violacion("sin_ruptura", "Falta la condición que rompe la tesis."))
    if p.proximo_evento is not None:
        limite = hoy + timedelta(days=limites.dias_sin_abrir_antes_de_evento)
        if hoy <= p.proximo_evento <= limite:
            v.append(Violacion(
                "evento_proximo",
                f"Evento el {p.proximo_evento.isoformat()}, dentro de "
                f"{limites.dias_sin_abrir_antes_de_evento} días: no se abre posición."))
    if cartera.posicion(p.ticker) is None and len(cartera.posiciones) >= limites.max_posiciones:
        v.append(Violacion(
            "max_posiciones",
            f"Ya hay {limites.max_posiciones} posiciones; hay que vender antes de abrir otra."))

    if p.importe > ZERO and p.precio > ZERO:
        acciones = acciones_por_importe(p.importe, p.precio)
        if acciones <= ZERO:
            v.append(Violacion("importe_demasiado_pequeno",
                               "El importe no alcanza para la fracción mínima de una acción."))
        else:
            coste = p.importe + commission(acciones, p.precio)
            if coste > cartera.caja:
                v.append(Violacion(
                    "caja_insuficiente",
                    f"Importe más comisión ({coste}) supera la caja ({cartera.caja})."))
            total = cartera.valor_total
            if total > ZERO:
                actual = cartera.posicion(p.ticker)
                valor_actual = actual.valor if actual is not None else ZERO
                peso = (valor_actual + acciones * p.precio) / total
                tope = (limites.peso_max_compra_defensivo if m is Modo.DEFENSIVO
                        else limites.peso_max_compra)
                if peso > tope:
                    v.append(Violacion(
                        "peso_maximo", f"Peso tras la compra {peso:.4f} supera el máximo {tope}."))
    return v


def comprobar_venta(p: PropuestaVenta, cartera: Cartera, parada: bool,
                    limites: Limites = LIMITES) -> list[Violacion]:
    """En modo defensivo vender está permitido; en pausa total no se mueve nada."""
    v = _modo_bloquea(modo(cartera, parada, limites))
    if p.acciones <= ZERO:
        v.append(Violacion("acciones_no_positivas", "Las acciones a vender deben ser positivas."))
    pos = cartera.posicion(p.ticker)
    if pos is None:
        v.append(Violacion("no_en_cartera", f"{p.ticker} no está en cartera."))
    elif p.acciones > pos.acciones:
        v.append(Violacion(
            "mas_acciones_que_las_que_hay",
            f"Se piden {p.acciones} acciones y solo hay {pos.acciones}."))
    return v


def apertura_permite_compra(cierre_previo: Decimal, apertura: Decimal,
                            limites: Limites = LIMITES) -> bool:
    """Un hueco al alza mayor del 3 % sobre el cierre anula la compra planeada."""
    if cierre_previo <= ZERO or apertura <= ZERO:
        return False
    return apertura <= cierre_previo * (UNO + limites.apertura_max_sobre_cierre)


def puede_gastar_ia(gastado_mes_usd: Decimal, coste_estimado_usd: Decimal,
                    limites: Limites = LIMITES) -> bool:
    return gastado_mes_usd + coste_estimado_usd <= limites.presupuesto_ia_mes_usd


def alertas_de_cartera(cartera: Cartera, limites: Limites = LIMITES) -> list[Alerta]:
    """Avisos para el vigía: revisiones escritas, no ventas automáticas."""
    out: list[Alerta] = []
    for pos in cartera.posiciones:
        if pos.coste_medio > ZERO and pos.rentabilidad <= limites.caida_posicion_revision:
            out.append(Alerta("revision_caida_posicion", pos.ticker, pos.rentabilidad))
        peso = cartera.peso(pos.ticker)
        if peso >= limites.peso_revision:
            out.append(Alerta("revision_peso", pos.ticker, peso))
    caida = cartera.caida_desde_maximo
    if caida <= limites.caida_pausa:
        out.append(Alerta("cartera_pausa", None, caida))
    elif caida <= limites.caida_defensiva:
        out.append(Alerta("cartera_defensiva", None, caida))
    return out
