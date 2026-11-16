"""Cuentas del agente hechas en código: el modelo se equivoca con la aritmética.
Así las cifras que recibe son exactas y reproducibles.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np


def _ok(*valores: float) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in valores)


def _serie_ok(precios: Sequence[float]) -> bool:
    return all(_ok(p) and p > 0 for p in precios)


def _fin(valor: float) -> float | None:
    return valor if math.isfinite(valor) else None


def _phi(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def _log_phi(z: float) -> float:
    # Para z muy negativo erfc subdesborda; se usa el desarrollo asintótico de la cola.
    if z > -30.0:
        return math.log(_phi(z))
    return -z * z / 2.0 - math.log(-z) - 0.5 * math.log(2.0 * math.pi)


def media_movil(precios: Sequence[float], n: int) -> float | None:
    """Media simple de los últimos n precios."""
    if n < 1 or len(precios) < n:
        return None
    ultimos = list(precios[-n:])
    if not _ok(*ultimos):
        return None
    return _fin(float(np.mean(ultimos)))


def rsi(precios: Sequence[float], n: int = 14) -> float | None:
    """RSI de Wilder: primera media simple de n cambios y luego (prev*(n-1)+actual)/n."""
    if n < 1 or len(precios) < n + 1 or not _ok(*precios):
        return None
    cambios = np.diff(np.asarray(precios, dtype=float))
    subidas = np.clip(cambios, 0.0, None)
    bajadas = np.clip(-cambios, 0.0, None)
    media_sube = float(np.mean(subidas[:n]))
    media_baja = float(np.mean(bajadas[:n]))
    for i in range(n, len(cambios)):
        media_sube = (media_sube * (n - 1) + float(subidas[i])) / n
        media_baja = (media_baja * (n - 1) + float(bajadas[i])) / n
    if media_baja == 0.0:
        return 50.0 if media_sube == 0.0 else 100.0
    return _fin(100.0 - 100.0 / (1.0 + media_sube / media_baja))


def volatilidad_anual(precios: Sequence[float], dias_por_anio: int = 252) -> float | None:
    """Desviación típica muestral de los rendimientos log diarios, anualizada."""
    if len(precios) < 3 or dias_por_anio < 1 or not _serie_ok(precios):
        return None
    rend = np.diff(np.log(np.asarray(precios, dtype=float)))
    return _fin(float(np.std(rend, ddof=1)) * math.sqrt(dias_por_anio))


def caida_desde_maximo(precios: Sequence[float]) -> float | None:
    """Último precio frente al máximo de la serie, menos 1 (<= 0)."""
    if len(precios) < 1 or not _serie_ok(precios):
        return None
    return _fin(float(precios[-1]) / max(precios) - 1.0)


def caida_maxima(precios: Sequence[float]) -> float | None:
    """Peor caída de pico a valle de la serie (<= 0)."""
    if len(precios) < 1 or not _serie_ok(precios):
        return None
    pico = float(precios[0])
    peor = 0.0
    for p in precios:
        pico = max(pico, float(p))
        peor = min(peor, float(p) / pico - 1.0)
    return _fin(peor)


def cagr(valor_inicial: float, valor_final: float, anios: float) -> float | None:
    """Tasa de crecimiento anual compuesta entre dos valores."""
    if not _ok(valor_inicial, valor_final, anios):
        return None
    if valor_inicial <= 0 or valor_final <= 0 or anios <= 0:
        return None
    try:
        return _fin((valor_final / valor_inicial) ** (1.0 / anios) - 1.0)
    except (OverflowError, ZeroDivisionError):
        return None


def valor_presente(valor_futuro: float, tasa_anual: float, anios: float) -> float | None:
    """Valor de hoy de un valor futuro, descontado con capitalización anual."""
    if not _ok(valor_futuro, tasa_anual, anios):
        return None
    if tasa_anual <= -1.0 or anios < 0:
        return None
    try:
        return _fin(valor_futuro / (1.0 + tasa_anual) ** anios)
    except (OverflowError, ZeroDivisionError):
        return None


def retorno_anual_esperado(
    precio_hoy: float, precio_objetivo: float, anios: float, dividendo_anual: float = 0.0
) -> float | None:
    """CAGR del precio más dividendo_anual/precio_hoy (suma simple, sin reinvertir)."""
    if not _ok(dividendo_anual) or dividendo_anual < 0:
        return None
    crecimiento = cagr(precio_hoy, precio_objetivo, anios)
    if crecimiento is None:
        return None
    return _fin(crecimiento + dividendo_anual / precio_hoy)


def margen_de_seguridad(precio: float, valor: float) -> float | None:
    """(valor - precio) / valor; negativo si el precio supera al valor."""
    if not _ok(precio, valor) or precio <= 0 or valor <= 0:
        return None
    return _fin((valor - precio) / valor)


def meses_de_caja(caja: float, quema_trimestral: float) -> float | None:
    """Meses que dura la caja al ritmo de quema; None si la empresa no quema caja."""
    if not _ok(caja, quema_trimestral) or caja < 0 or quema_trimestral <= 0:
        return None
    return _fin(caja / (quema_trimestral / 3.0))


def dilucion(acciones_antes: float, acciones_despues: float) -> float | None:
    """Variación relativa del número de acciones."""
    if not _ok(acciones_antes, acciones_despues):
        return None
    if acciones_antes <= 0 or acciones_despues <= 0:
        return None
    return _fin(acciones_despues / acciones_antes - 1.0)


def prob_tocar_nivel(
    precio: float,
    nivel: float,
    sigma_anual: float,
    dias: float,
    mu_anual: float = 0.0,
    dias_por_anio: int = 252,
) -> float | None:
    """Probabilidad de tocar el nivel antes de `dias` con movimiento browniano geométrico.

    Principio de reflexión con deriva; mu_anual=0 es la versión sin deriva.
    """
    if not _ok(precio, nivel, sigma_anual, dias, mu_anual):
        return None
    if precio <= 0 or nivel <= 0 or sigma_anual <= 0 or dias <= 0 or dias_por_anio < 1:
        return None
    if nivel == precio:
        return 1.0
    x = math.log(nivel / precio)
    tiempo = dias / dias_por_anio
    nu = mu_anual - sigma_anual**2 / 2.0
    denom = sigma_anual * math.sqrt(tiempo)
    exponente = 2.0 * nu * x / sigma_anual**2
    if x > 0:
        z1 = (-x + nu * tiempo) / denom
        z2 = (-x - nu * tiempo) / denom
    else:
        z1 = (x - nu * tiempo) / denom
        z2 = (x + nu * tiempo) / denom
    # El segundo término se calcula en logaritmos para que exp no desborde.
    termino2 = math.exp(min(exponente + _log_phi(z2), 0.0))
    return _fin(min(max(_phi(z1) + termino2, 0.0), 1.0))
