"""Textos del motor: llevan su código y sus cifras para redactarse en español o en inglés.

`Texto` es un `str` ya redactado en español, así que se compara y se concatena como siempre;
`presentar` lo vuelve a redactar en otro idioma sin recalcular nada. Las cifras y los nombres
llegan como valores (`Cifra`, `Pct`, `Usd`...) que se escriben según el idioma.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.i18n import MESSAGES
from app.liga.motor import formato


@dataclass(frozen=True)
class Cifra:
    valor: Any
    decimales: int = 1
    frente_a: tuple = ()

    def redactar(self, locale: str) -> str:
        return formato.cifra(self.valor, self.decimales, self.frente_a, locale)


@dataclass(frozen=True)
class Pct:
    valor: Any
    decimales: int = 1
    frente_a: tuple = ()

    def redactar(self, locale: str) -> str:
        return formato.porcentaje(self.valor, self.decimales, self.frente_a, locale)


@dataclass(frozen=True)
class Usd:
    millones: Any
    frente_a: tuple = ()

    def redactar(self, locale: str) -> str:
        return formato.millones_usd(self.millones, self.frente_a, locale)


@dataclass(frozen=True)
class UsdAbierto:
    """Cota que en castellano va sin unidad si le sigue otra («entre 300 y 2.000 M$»)."""

    millones: Any

    def redactar(self, locale: str) -> str:
        if locale == "en":
            return formato.millones_usd(self.millones, (), locale)
        return formato.cifra(self.millones, 0, (), locale)


@dataclass(frozen=True)
class Veces:
    valor: Any
    frente_a: tuple = ()

    def redactar(self, locale: str) -> str:
        t = formato.cifra(self.valor, 1, self.frente_a, locale)
        if locale == "en":
            return f"{t}x"
        return f"{t} {'vez' if t == '1' else 'veces'}"


@dataclass(frozen=True)
class Regla:
    """Título de una regla del catálogo."""

    clave: str

    def redactar(self, locale: str) -> str:
        return MESSAGES[locale][f"liga_catalogo_regla_{self.clave}"]


@dataclass(frozen=True)
class Ajuste:
    """Etiqueta de un ajuste de regla."""

    nombre: str

    def redactar(self, locale: str) -> str:
        return MESSAGES[locale][f"liga_catalogo_parametro_{self.nombre}"]


@dataclass(frozen=True)
class Peso:
    """Etiqueta de uno de los cinco pesos, en minúsculas o tal cual."""

    clave: str
    minusculas: bool = False

    def redactar(self, locale: str) -> str:
        texto = MESSAGES[locale][f"liga_catalogo_peso_{self.clave}"]
        return texto.lower() if self.minusculas else texto


@dataclass(frozen=True)
class Sector:
    """Nombre de un sector de Yahoo en minúsculas; en inglés es el propio nombre de Yahoo."""

    nombre: str

    def redactar(self, locale: str) -> str:
        if locale == "en":
            return self.nombre.lower()
        from app.liga.motor.catalogo import sector_es

        return sector_es(self.nombre).lower()


@dataclass(frozen=True)
class ListaSectores:
    sectores: tuple

    def redactar(self, locale: str) -> str:
        from app.liga.motor.catalogo import SECTORES_ES

        nombres = [Sector(s).redactar(locale) for s in SECTORES_ES if s in self.sectores]
        if len(nombres) == 1:
            return nombres[0]
        if locale == "en":
            return (f"{nombres[0]} and {nombres[1]}" if len(nombres) == 2
                    else f"{', '.join(nombres[:-1])}, and {nombres[-1]}")
        # «tecnología e industria»: la «y» pasa a «e» ante el sonido «i».
        y = "e" if nombres[-1].startswith("i") else "y"
        return f"{', '.join(nombres[:-1])} {y} {nombres[-1]}"


@dataclass(frozen=True)
class Lista:
    """Elementos sueltos separados por comas (tickers, campos)."""

    elementos: tuple

    def redactar(self, locale: str) -> str:
        return ", ".join(str(e) for e in self.elementos)


def _valor(v: Any, locale: str) -> Any:
    if isinstance(v, Texto):
        return v.en(locale)
    if hasattr(v, "redactar"):
        return v.redactar(locale)
    return v


def _redactar(codigo: str, params: Mapping[str, Any], locale: str) -> str:
    return MESSAGES[locale][codigo].format(**{k: _valor(v, locale) for k, v in params.items()})


class Texto(str):
    """Texto en español con su código y sus parámetros para redactarlo en otro idioma."""

    codigo: str
    params: Mapping[str, Any]

    def __new__(cls, codigo: str, **params: Any) -> Texto:
        obj = super().__new__(cls, _redactar(codigo, params, "es"))
        obj.codigo = codigo
        obj.params = params
        return obj

    def en(self, locale: str) -> str:
        return _redactar(self.codigo, self.params, locale)

    def __reduce__(self) -> tuple:
        return (_reconstruir, (self.codigo, dict(self.params)))

    @property
    def sin_dato(self) -> bool:
        """Que no se pueda saber si la cumple porque falta un dato, no porque no la cumpla."""
        return self.codigo.startswith("motor_sin_dato")


def _reconstruir(codigo: str, params: dict) -> Texto:
    return Texto(codigo, **params)


def presentar(valor: Any, locale: str) -> Any:
    """El texto en el idioma pedido; lo que no es un `Texto` pasa tal cual."""
    return valor.en(locale) if isinstance(valor, Texto) else valor


def presentar_lista(valores: Iterable[Any], locale: str) -> str:
    return " ".join(str(presentar(v, locale)) for v in valores)
