"""Selección del día 1: qué empresas entran en la cartera de una estrategia, con qué peso y por qué.

Reproduce `pick()`, `reason()` y `explain()` de la maqueta B sobre datos reales (plan §8):

1. Fuera las que no cumplen alguna regla, las que el usuario quitó a mano y las que la IA no
   puntuó este mes (sin las 4 notas de Jev no hay nota).
2. Nota (de 0 a 10 por dentro, sobre 100 al enseñarla): media ponderada, con los pesos de la
   receta, de las 4 notas de Jev (su escala de 0 a 9 se pasa a 0-10) y de la respuesta a la
   pregunta propia, si pesa. Si pesa y una empresa no tiene respuesta (la pregunta solo se hace
   a `candidatas_pregunta`, tope D7), no pasa: entraría sin que se le preguntara, por delante de
   las que contestaron que no.
3. Orden por nota; a igual nota, la de más capitalización (y el ticker, para que sea determinista).
4. Entran las N primeras, respetando el máximo por sector.
5. Pesos a partes iguales (100/N) o proporcionales a la nota. Si solo pasan k < N, entre todas
   pesan k/N del total en los dos repartos, y el resto se queda en caja al 0 %.

La nota se calcula exacta (fracciones): dos notas iguales empatan de verdad y decide la
capitalización. Los pesos se guardan con 4 decimales, nunca suman más de 100 y ninguno es 0
(`liga.posiciones` exige peso > 0): una elegida que pesaría 0 no entra (`sin_peso`).
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal
from fractions import Fraction
from functools import cached_property
from typing import Any

from app.liga.motor.catalogo import (
    CATALOGO_VERSION,
    EmpresaFoto,
    RecetaNoValida,
    ReglaPreparada,
    preparar,
    primer_fallo,
    validar_reglas,
)
from app.liga.motor.formato import a_decimal, redondear
from app.liga.motor.mensajes import Cifra, Lista, Pct, Peso, Sector, Texto

PESOS = ("negocio", "precio", "deuda", "pronto", "pregunta")
ETIQUETAS_PESO = {
    "negocio": "Que el negocio vaya bien",
    "precio": "Que no esté cara",
    "deuda": "Que no dependa de pedir dinero",
    "pronto": "Que tenga algo a favor pronto",
    "pregunta": "Tu pregunta",
}
N_EMPRESAS = (3, 5, 7, 10)
REPARTOS = ("igual", "nota")
SEGURIDADES = ("alta", "media", "baja")
PESO_MAXIMO = 50
PASO_PESO = 5
MAX_POR_SECTOR = 10
MAX_EXCLUIDAS = 50
TOPE_PREGUNTA = 300
SIN_NOTAS = Texto("motor_sin_notas")
SIN_RESPUESTA = Texto("motor_sin_respuesta", tope=TOPE_PREGUNTA)

# Cada peso de la receta con su nota de Jev (`scan_audit.jev_*`).
_NOTA_DE_PESO = {
    "negocio": "fundamentals",
    "precio": "valuation",
    "deuda": "financing",
    "pronto": "catalyst",
}
_ESCALA_JEV = Fraction(10, 9)
_NOTA_RESPUESTA = {
    (True, "alta"): Decimal("9.2"),
    (True, "media"): Decimal("7.4"),
    (True, "baja"): Decimal("5.8"),
    (False, "alta"): Decimal("1.2"),
    (False, "media"): Decimal("2.8"),
    (False, "baja"): Decimal("4.2"),
}
_CIEN = Fraction(100)


@dataclass(frozen=True, kw_only=True)
class Receta:
    """Lo que la selección necesita de una versión de receta (`liga.recetas`).

    `reglas`: las del catálogo, en orden. `excluidas`: tickers que el usuario quitó a mano.
    `pesos`: las 5 claves de `PESOS`, de 0 a 50 de 5 en 5. `max_por_sector`: 0 es sin límite.
    `catalogo_version`: la del catálogo con que se escribieron las reglas."""

    reglas: list[dict[str, Any]]
    excluidas: tuple[str, ...] = ()
    pesos: dict[str, int]
    n_empresas: int
    reparto: str
    max_por_sector: int
    catalogo_version: int = CATALOGO_VERSION


@dataclass(frozen=True)
class NotasJev:
    """Las 4 notas de Jev de una empresa en el escaneo de la jornada, en su escala de 0 a 9."""

    fundamentals: Decimal
    valuation: Decimal
    financing: Decimal
    catalyst: Decimal

    def __post_init__(self) -> None:
        for campo in _NOTA_DE_PESO.values():
            valor = a_decimal(getattr(self, campo))
            if valor is None or not 0 <= valor <= 9:
                raise ValueError(f"nota de Jev fuera de 0-9: {campo}={getattr(self, campo)!r}")
            object.__setattr__(self, campo, valor)

    @classmethod
    def desde_bd(cls, fundamentals: int | None, valuation: int | None, financing: int | None,
                 catalyst: int | None) -> NotasJev | None:
        """Desde `scan_audit.jev_*` (nivel ×100). `None` si falta alguna: sin las 4 no hay nota."""
        if fundamentals is None or valuation is None or financing is None or catalyst is None:
            return None
        return cls(Decimal(fundamentals) / 100, Decimal(valuation) / 100,
                   Decimal(financing) / 100, Decimal(catalyst) / 100)


@dataclass(frozen=True)
class Respuesta:
    """Lo que contestó la IA a la pregunta propia sobre una empresa (`liga.respuestas_ia`)."""

    si: bool
    seguridad: str

    def __post_init__(self) -> None:
        if not isinstance(self.si, bool):
            raise TypeError("la respuesta es sí o no")
        if self.seguridad not in SEGURIDADES:
            raise ValueError(f"seguridad desconocida: {self.seguridad!r}")

    @property
    def nota(self) -> Decimal:
        """9,2 / 7,4 / 5,8 si es sí; 1,2 / 2,8 / 4,2 si es no (seguridad alta / media / baja)."""
        return _NOTA_RESPUESTA[(self.si, self.seguridad)]


@dataclass(frozen=True)
class FilaSeleccion:
    """Una empresa de la foto frente a la receta.

    `nota`: de 0 a 10 con 4 decimales; falta si no se puede calcular. `fallo`: la primera regla
    que no cumple o, si las cumple todas, `SIN_NOTAS` o `SIN_RESPUESTA`. `excluida`: la quitó
    el usuario. `mejor_nota`: la clave de peso que más aporta (`best` en la maqueta).
    `respuesta`: la que contó en la nota."""

    empresa: EmpresaFoto
    nota: Decimal | None
    fallo: str | None
    excluida: bool = False
    mejor_nota: str | None = None
    respuesta: Respuesta | None = None
    nota_exacta: Fraction | None = field(default=None, repr=False, compare=False)

    @property
    def ticker(self) -> str:
        return self.empresa.ticker

    @property
    def pasa(self) -> bool:
        return self.fallo is None and not self.excluida


@dataclass(frozen=True)
class Elegida:
    """Una empresa que entra: su peso en la cartera (%, 4 decimales) y el porqué para enseñarlo."""

    fila: FilaSeleccion
    peso: Decimal
    porque: str

    @property
    def ticker(self) -> str:
        return self.fila.ticker


@dataclass(frozen=True)
class Seleccion:
    """`filas`: todas, en el orden de la foto. `pasan`: las que pasan, por nota. `elegidas`: las
    que entran, en ese orden. `sin_peso`: las que entrarían pero su peso es 0 (nota 0 en un
    reparto por nota). `caja_pct`: 100 − Σ pesos, lo que se queda sin invertir."""

    filas: tuple[FilaSeleccion, ...]
    pasan: tuple[FilaSeleccion, ...]
    elegidas: tuple[Elegida, ...]
    saltadas_por_sector: tuple[FilaSeleccion, ...]
    sin_peso: tuple[FilaSeleccion, ...]
    caja_pct: Decimal

    @cached_property
    def _por_ticker(self) -> dict[str, FilaSeleccion]:
        return {f.ticker: f for f in self.filas}

    def fila(self, ticker: str) -> FilaSeleccion | None:
        return self._por_ticker.get(ticker)


# --- Validación ----------------------------------------------------------------------------------


def validar_receta(receta: Receta) -> list[Texto]:
    """Errores en castellano; vacía si la receta se puede aplicar."""
    if receta.catalogo_version != CATALOGO_VERSION:
        return [Texto("motor_val_version", version=receta.catalogo_version,
                      actual=CATALOGO_VERSION)]
    errores = validar_reglas(receta.reglas)
    errores += _validar_excluidas(receta.excluidas)
    errores += _validar_pesos(receta.pesos)
    n = receta.n_empresas
    if isinstance(n, bool) or n not in N_EMPRESAS:
        errores.append(Texto("motor_val_n_empresas"))
    if receta.reparto not in REPARTOS:
        errores.append(Texto("motor_val_reparto"))
    # Mismo rango que la BD: un tope mayor que N es como no ponerlo.
    m = receta.max_por_sector
    if isinstance(m, bool) or not isinstance(m, int) or not 0 <= m <= MAX_POR_SECTOR:
        errores.append(Texto("motor_val_max_sector", maximo=MAX_POR_SECTOR))
    return errores


def _validar_excluidas(excluidas: object) -> list[Texto]:
    if not isinstance(excluidas, tuple | list):
        return [Texto("motor_val_excluidas_lista")]
    if len(excluidas) > MAX_EXCLUIDAS:
        return [Texto("motor_val_excluidas_max", maximo=MAX_EXCLUIDAS)]
    errores = []
    if any(not isinstance(t, str) or not t.strip() for t in excluidas):
        errores.append(Texto("motor_val_excluida_vacia"))
    repetidas = sorted({t for t in excluidas if isinstance(t, str) and excluidas.count(t) > 1})
    if repetidas:
        errores.append(Texto("motor_val_excluidas_repetidas", lista=Lista(tuple(repetidas))))
    return errores


def _validar_pesos(pesos: object) -> list[Texto]:
    if not isinstance(pesos, Mapping) or set(pesos) != set(PESOS):
        return [Texto("motor_val_pesos_cinco")]
    errores = [Texto("motor_val_peso", peso=Peso(k), maximo=PESO_MAXIMO, paso=PASO_PESO)
               for k in PESOS if not _peso_valido(pesos[k])]
    if not errores and sum(pesos.values()) == 0:
        errores.append(Texto("motor_val_peso_cero"))
    return errores


def _peso_valido(w: object) -> bool:
    return (isinstance(w, int) and not isinstance(w, bool) and 0 <= w <= PESO_MAXIMO
            and w % PASO_PESO == 0)


# --- Selección -----------------------------------------------------------------------------------


def seleccionar(empresas: Sequence[EmpresaFoto], receta: Receta, notas: Mapping[str, NotasJev],
                respuestas: Mapping[str, Respuesta] | None = None) -> Seleccion:
    """La cartera del día 1 de una receta sobre la foto del mes (`pick()` de la maqueta).

    `notas`: las de Jev del escaneo de la jornada, por ticker. `respuestas`: las de la pregunta
    propia, por ticker. `RecetaNoValida` si la receta no se puede aplicar; `ValueError` si un
    ticker sale dos veces en la foto."""
    reglas = _preparar(receta)
    _sin_repetidas(empresas)
    respuestas = respuestas or {}
    excluidas = set(receta.excluidas)
    filas = tuple(_fila(e, reglas, receta.pesos, notas.get(e.ticker), respuestas.get(e.ticker),
                        e.ticker in excluidas) for e in empresas)
    pasan = sorted((f for f in filas if f.pasa), key=_orden)
    entran, saltadas = _entran(pasan, receta)
    pesos = redondear_pesos(_pesos_exactos(entran, receta))
    elegidas = tuple(Elegida(f, p, _porque(f))
                     for f, p in zip(entran, pesos, strict=True) if p > 0)
    sin_peso = tuple(f for f, p in zip(entran, pesos, strict=True) if p == 0)
    caja = Decimal(100) - sum((e.peso for e in elegidas), Decimal(0))
    return Seleccion(filas, tuple(pasan), elegidas, tuple(saltadas), sin_peso,
                     redondear(caja, 4))


def candidatas_pregunta(empresas: Sequence[EmpresaFoto], receta: Receta,
                        notas: Mapping[str, NotasJev], tope: int = TOPE_PREGUNTA) -> list[str]:
    """Los tickers a los que se hace la pregunta propia (D7): los que pasan reglas y exclusiones,
    las `tope` mejores por las 4 notas y, a igual nota, por capitalización.

    Las 4 notas pesan como en la receta; si ninguna pesa (solo cuenta la pregunta), igual."""
    reglas = _preparar(receta)
    _sin_repetidas(empresas)
    pesos = dict(receta.pesos)
    if not any(pesos[k] for k in _NOTA_DE_PESO):
        pesos.update(dict.fromkeys(_NOTA_DE_PESO, 1))
    pesos["pregunta"] = 0
    excluidas = set(receta.excluidas)
    filas = (_fila(e, reglas, pesos, notas.get(e.ticker), None, e.ticker in excluidas)
             for e in empresas)
    return [f.ticker for f in sorted((f for f in filas if f.pasa), key=_orden)[:tope]]


def sin_pregunta(receta: Receta) -> Receta:
    """La misma receta sin el peso de la pregunta propia, para formar cuando faltan respuestas.
    Si era lo único que pesaba, las 4 notas se reparten a partes iguales (el peso mínimo válido)."""
    if not receta.pesos["pregunta"]:
        return receta
    pesos = {**receta.pesos, "pregunta": 0}
    if not any(pesos[k] for k in _NOTA_DE_PESO):
        pesos.update(dict.fromkeys(_NOTA_DE_PESO, PASO_PESO))
    return replace(receta, pesos=pesos)


def seleccionar_o_sin_pregunta(
        empresas: Sequence[EmpresaFoto], receta: Receta, notas: Mapping[str, NotasJev],
        respuestas: Mapping[str, Respuesta] | None = None,
        motivo: str = "incompleta") -> tuple[Seleccion, str | None]:
    """Todo o nada con la pregunta propia: cuenta solo si todas las candidatas tienen respuesta.
    Si falta alguna, la estrategia se forma sin ella y se devuelve el `motivo`; así ninguna
    empresa se cae por una respuesta que no llegó ni se mezclan unas con respuesta y otras sin."""
    respuestas = respuestas or {}
    if receta.pesos["pregunta"]:
        candidatas = candidatas_pregunta(empresas, receta, notas)
        if any(t not in respuestas for t in candidatas):
            return seleccionar(empresas, sin_pregunta(receta), notas), motivo
    return seleccionar(empresas, receta, notas, respuestas), None


def _preparar(receta: Receta) -> tuple[ReglaPreparada, ...]:
    errores = validar_receta(receta)
    if errores:
        raise RecetaNoValida(errores)
    return preparar(receta.reglas)


def _sin_repetidas(empresas: Sequence[EmpresaFoto]) -> None:
    vistos: set[str] = set()
    for e in empresas:
        if e.ticker in vistos:
            raise ValueError(f"{e.ticker} está dos veces en la foto")
        vistos.add(e.ticker)


def _fila(empresa: EmpresaFoto, reglas: tuple[ReglaPreparada, ...], pesos: Mapping[str, int],
          notas: NotasJev | None, respuesta: Respuesta | None, excluida: bool) -> FilaSeleccion:
    motivo = primer_fallo(empresa, reglas)
    if notas is None:
        return FilaSeleccion(empresa, None, motivo or SIN_NOTAS, excluida)
    if pesos["pregunta"] > 0 and respuesta is None:
        return FilaSeleccion(empresa, None, motivo or SIN_RESPUESTA, excluida)
    suma, peso_total = Fraction(0), 0
    for clave, campo in _NOTA_DE_PESO.items():
        if pesos[clave] > 0:
            suma += pesos[clave] * Fraction(getattr(notas, campo)) * _ESCALA_JEV
            peso_total += pesos[clave]
    usada = respuesta if pesos["pregunta"] > 0 else None
    if usada is not None:
        suma += pesos["pregunta"] * Fraction(usada.nota)
        peso_total += pesos["pregunta"]
    exacta = suma / peso_total
    return FilaSeleccion(empresa, redondear(exacta, 4), motivo, excluida,
                         _mejor_nota(notas, pesos), usada, exacta)


def _mejor_nota(notas: NotasJev, pesos: Mapping[str, int]) -> str | None:
    """La nota que más aporta (peso × nota); a igualdad, la primera en el orden de `PESOS`."""
    mejor, aporte = None, None
    for clave, campo in _NOTA_DE_PESO.items():
        if pesos[clave] > 0:
            valor = pesos[clave] * getattr(notas, campo)
            if aporte is None or valor > aporte:
                mejor, aporte = clave, valor
    return mejor


def _orden(f: FilaSeleccion) -> tuple[Fraction, bool, Decimal, str]:
    cap = a_decimal(f.empresa.market_cap_usd)
    return (-(f.nota_exacta or Fraction(0)), cap is None, -(cap or Decimal(0)), f.ticker)


def _sector(empresa: EmpresaFoto) -> str | None:
    if not isinstance(empresa.sector, str):
        return None
    return empresa.sector.strip() or None


def _entran(pasan: list[FilaSeleccion],
            receta: Receta) -> tuple[list[FilaSeleccion], list[FilaSeleccion]]:
    """Las N primeras con el tope por sector, y las que se saltaron por él."""
    tope = receta.max_por_sector or None
    # Las que no tienen sector cuentan como uno solo: el tope es para repartir, y no sabemos más.
    por_sector: Counter[str | None] = Counter()
    entran: list[FilaSeleccion] = []
    saltadas: list[FilaSeleccion] = []
    for f in pasan:
        if len(entran) >= receta.n_empresas:
            break
        sector = _sector(f.empresa)
        if tope is not None and por_sector[sector] >= tope:
            saltadas.append(f)
            continue
        por_sector[sector] += 1
        entran.append(f)
    return entran, saltadas


def _pesos_exactos(entran: list[FilaSeleccion], receta: Receta) -> list[Fraction]:
    k, n = len(entran), receta.n_empresas
    if receta.reparto == "nota":
        notas = [f.nota_exacta or Fraction(0) for f in entran]
        total = sum(notas, Fraction(0))
        # Con todas las notas a 0 no hay proporción posible: a partes iguales.
        if total > 0:
            return [nota / total * _CIEN * k / n for nota in notas]
    return [_CIEN / n] * k


def redondear_pesos(exactos: Sequence[Fraction | Decimal | int]) -> list[Decimal]:
    """Pesos exactos (en %) a 4 decimales: todos hacia abajo y lo que falte, al mayor (el
    primero, si empatan).

    Así la suma es la real truncada a 4 decimales: nunca pasa de 100 y, con la cartera llena,
    es 100 justo (siete a partes iguales: la primera de 14,2858 y seis de 14,2857). Un peso
    exacto casi nulo puede quedar en 0; quien lo use decide qué hacer con él."""
    fracciones = [Fraction(x) for x in exactos]
    if not fracciones:
        return []
    if any(x < 0 for x in fracciones):
        raise ValueError("un peso no puede ser negativo")
    total = sum(fracciones, Fraction(0))
    if total > _CIEN:
        raise ValueError(f"los pesos suman más de 100: {float(total)}")
    pesos = [_truncar(x) for x in fracciones]
    mayor = max(range(len(fracciones)), key=fracciones.__getitem__)
    pesos[mayor] += _truncar(total) - sum(pesos, Decimal(0))
    return pesos


def _truncar(x: Fraction) -> Decimal:
    return Decimal(math.floor(x * 10_000)).scaleb(-4)


def _porque(f: FilaSeleccion) -> Texto:
    """El porqué de cada elegida, como `reason()` de la maqueta."""
    # La cuenta interna va de 0 a 10; al usuario se le enseña sobre 100, como el resto de la marca.
    nota = Texto("motor_porque_nota", nota=Cifra((f.nota_exacta or 0) * 10, 0))
    if f.respuesta is not None:
        return Texto("motor_porque_ia", si=Texto("motor_si" if f.respuesta.si else "motor_no"),
                     seguridad=Texto(f"motor_seguridad_{f.respuesta.seguridad}"), nota=nota)
    if f.mejor_nota is not None:
        return Texto("motor_porque_destaca", peso=Peso(f.mejor_nota, minusculas=True), nota=nota)
    return nota


def explicar(ticker: str, seleccion: Seleccion, receta: Receta) -> Texto:
    """«¿Por qué no sale X?»: los mensajes de `explain()` de la maqueta, con la misma receta que
    dio la selección."""
    fila = seleccion.fila(ticker)
    if fila is None:
        return Texto("motor_exp_foto", ticker=ticker)
    nombre = fila.empresa.nombre or fila.ticker
    if fila.excluida:
        return Texto("motor_exp_quitada", nombre=nombre)
    if fila.fallo is not None:
        return Texto("motor_exp_no_entra", nombre=nombre, motivo=fila.fallo)
    for i, elegida in enumerate(seleccion.elegidas, 1):
        if elegida.ticker == ticker:
            return Texto("motor_exp_entra", nombre=nombre, puesto=i, peso=Pct(elegida.peso, 0))
    if any(f.ticker == ticker for f in seleccion.saltadas_por_sector):
        sector = _sector(fila.empresa)
        de_quien = (Texto("motor_de_sector", sector=Sector(sector)) if sector
                    else Texto("motor_sin_sector"))
        return Texto("motor_exp_sector", nombre=nombre, maximo=receta.max_por_sector,
                     de_quien=de_quien)
    if any(f.ticker == ticker for f in seleccion.sin_peso):
        return Texto("motor_exp_sin_peso", nombre=nombre)
    puesto = next(i for i, f in enumerate(seleccion.pasan, 1) if f.ticker == ticker)
    return Texto("motor_exp_puesto", nombre=nombre, puesto=puesto,
                 nota=Cifra(fila.nota_exacta or 0, 1), n=receta.n_empresas)
