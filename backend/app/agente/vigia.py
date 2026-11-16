"""Vigía: alarmas en código que deciden si hay motivo para despertar al agente. Sin IA."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from app.agente.limites import LIMITES, Alerta, Cartera, alertas_de_cartera

ZERO = Decimal("0")
UNO = Decimal("1")
# Variación diaria en valor absoluto que obliga a mirar la posición.
UMBRAL_MOVIMIENTO = Decimal("0.08")


@dataclass(frozen=True)
class Nivel:
    ticker: str
    precio: Decimal
    direccion: Literal["arriba", "abajo"]
    motivo: str


@dataclass(frozen=True)
class Evento:
    ticker: str
    fecha: date
    tipo: Literal["resultados", "binario"]


def niveles_desde_json(ticker: str, datos: list[dict]) -> list[Nivel]:
    """Convierte `seguimiento.niveles`; lo mal formado se descarta sin lanzar."""
    if not isinstance(datos, list):
        return []
    out: list[Nivel] = []
    for item in datos:
        if not isinstance(item, dict):
            continue
        try:
            precio = Decimal(str(item.get("precio")))
        except (InvalidOperation, ValueError):
            continue
        # Se comprueba finitud antes de comparar: un NaN no admite comparaciones.
        if not precio.is_finite() or precio <= ZERO:
            continue
        sentido = item.get("direccion")
        if sentido == "arriba":
            direccion: Literal["arriba", "abajo"] = "arriba"
        elif sentido == "abajo":
            direccion = "abajo"
        else:
            continue
        out.append(Nivel(ticker, precio, direccion, str(item.get("motivo") or "")))
    return out


def _cruza(nivel: Nivel, previo: Decimal, hoy: Decimal) -> bool:
    if nivel.direccion == "arriba":
        return previo < nivel.precio <= hoy
    return previo > nivel.precio >= hoy


def _por_ticker(alertas: list[Alerta]) -> list[Alerta]:
    # Orden estable: el ticker decide el orden y las alertas sin ticker van al final.
    return sorted(alertas, key=lambda a: (a.ticker is None, a.ticker or ""))


def _sin_duplicados(alertas: list[Alerta]) -> list[Alerta]:
    # Un nivel distinto del mismo ticker es otra alerta; el resto se cuenta una vez.
    vistas: set[tuple[str, str | None, Decimal | None]] = set()
    out: list[Alerta] = []
    for a in alertas:
        clave = (a.codigo, a.ticker, a.valor if a.codigo == "nivel_cruzado" else None)
        if clave in vistas:
            continue
        vistas.add(clave)
        out.append(a)
    return out


def revisar(cartera: Cartera, cierres: dict[str, Decimal], cierres_previos: dict[str, Decimal],
            niveles: list[Nivel], eventos: list[Evento], hoy: date) -> list[Alerta]:
    """Reúne las alarmas del día: cartera, niveles cruzados, eventos próximos y movimientos."""
    en_cartera = {p.ticker for p in cartera.posiciones}
    vigilados = en_cartera | {n.ticker for n in niveles}

    cruzados: list[Alerta] = []
    for n in niveles:
        hoy_c = cierres.get(n.ticker)
        previo = cierres_previos.get(n.ticker)
        if hoy_c is None or previo is None:
            continue
        if _cruza(n, previo, hoy_c):
            cruzados.append(Alerta("nivel_cruzado", n.ticker, n.precio))

    proximos: list[Alerta] = []
    for e in eventos:
        if e.ticker not in vigilados:
            continue
        dias = (e.fecha - hoy).days
        if 0 <= dias <= LIMITES.dias_sin_abrir_antes_de_evento:
            proximos.append(Alerta("evento_proximo", e.ticker, Decimal(dias)))

    movidas: list[Alerta] = []
    for p in cartera.posiciones:
        hoy_c = cierres.get(p.ticker)
        previo = cierres_previos.get(p.ticker)
        if hoy_c is None or previo is None or previo <= ZERO:
            continue
        variacion = hoy_c / previo - UNO
        if abs(variacion) >= UMBRAL_MOVIMIENTO:
            movidas.append(Alerta("movimiento_fuerte", p.ticker, variacion))

    grupos = [_por_ticker(alertas_de_cartera(cartera)), _por_ticker(cruzados),
              _por_ticker(proximos), _por_ticker(movidas)]
    return _sin_duplicados([a for g in grupos for a in g])


def hay_que_despertar(alertas: list[Alerta]) -> bool:
    return len(alertas) > 0
