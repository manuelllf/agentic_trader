"""Idioma de presentación por petición, separado de datos y decisiones del motor."""

import json
from pathlib import Path

from contextvars import ContextVar
from copy import deepcopy
from typing import Literal

Locale = Literal["es", "en"]
current_locale: ContextVar[Locale] = ContextVar("presentation_locale", default="es")
MESSAGES = {locale: json.loads((Path(__file__).parent / "messages" / f"{locale}.json").read_text(encoding="utf-8"))
            for locale in ("es", "en")}


def resolve_locale(header: str | None) -> Locale:
    candidates = []
    for position, entry in enumerate((header or "").split(",")):
        language, *parameters = entry.strip().split(";")
        quality = next((p.strip()[2:] for p in parameters if p.strip().startswith("q=")), "1")
        try:
            weight = float(quality)
        except ValueError:
            continue
        normalized = language.lower().replace("_", "-").split("-")[0]
        if normalized in {"es", "en"} and 0 < weight <= 1:
            candidates.append((-weight, position, normalized))
    return min(candidates)[2] if candidates else "es"


def translate(key: str, locale: Locale | None = None, **values) -> str:
    return MESSAGES[locale or current_locale.get()][key].format(**values)


def present_catalog(payload: dict, locale: Locale) -> dict:
    result = deepcopy(payload)
    if locale == "es":
        return result
    result["sectores"] = {key: key for key in result["sectores"]}
    for rule in result["reglas"]:
        rule["titulo"] = translate(f"liga_catalogo_regla_{rule['clave']}", locale)
        for parameter in rule["parametros"]:
            parameter["etiqueta"] = translate(f"liga_catalogo_parametro_{parameter['nombre']}", locale)
    result["pesos"]["etiquetas"] = {key: translate(f"liga_catalogo_peso_{key}", locale) for key in result["pesos"]["etiquetas"]}
    return result


ERROR_KEYS = {value: key for key, value in MESSAGES["es"].items() if key.startswith("api_error_")}


def present_error_detail(detail: str, locale: Locale | None = None) -> str:
    key = ERROR_KEYS.get(detail)
    return translate(key, locale) if key else detail
