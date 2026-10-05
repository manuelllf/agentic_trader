"""Idioma de presentación por petición, separado de datos y decisiones del motor."""

import json
import re
from contextvars import ContextVar
from copy import deepcopy
from pathlib import Path
from typing import Literal

Locale = Literal["es", "en"]
current_locale: ContextVar[Locale] = ContextVar("presentation_locale", default="es")
_CARPETA = Path(__file__).parent / "messages"
MESSAGES = {locale: json.loads((_CARPETA / f"{locale}.json").read_text(encoding="utf-8"))
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
            parameter["etiqueta"] = translate(
                f"liga_catalogo_parametro_{parameter['nombre']}", locale)
    result["pesos"]["etiquetas"] = {
        key: translate(f"liga_catalogo_peso_{key}", locale) for key in result["pesos"]["etiquetas"]}
    return result


ERROR_KEYS = {value: key for key, value in MESSAGES["es"].items() if key.startswith("api_error_")}


# Mensajes de la base de datos: con huecos (`{a}`, `{b}`) o escritos en inglés por el proveedor.
_PLANTILLAS_BD = tuple(
    (re.compile(re.escape(texto).replace(r"\{a\}", "(?P<a>.+?)").replace(r"\{b\}", "(?P<b>.+?)")),
     clave)
    for clave, texto in MESSAGES["es"].items() if clave.startswith("dberr_tpl_"))
_ORIGEN_INGLES = {"authenticated identity required": "dberr_login",
                  "authenticated session required": "dberr_login"}


def present_error_detail(detail: str, locale: Locale | None = None) -> str:
    key = ERROR_KEYS.get(detail) or _ORIGEN_INGLES.get(detail)
    if key:
        return translate(key, locale)
    for patron, clave in _PLANTILLAS_BD:
        encontrado = patron.fullmatch(detail)
        if encontrado:
            return translate(clave, locale, **encontrado.groupdict())
    return detail
