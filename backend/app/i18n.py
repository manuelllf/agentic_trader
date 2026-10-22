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


# El origen lo fija la base de datos o el código; el catálogo solo lo presenta.
ORIGEN_ERRORES: dict[str, str] = {
    "Solo puedes tener una estrategia en juego a la vez": "api_error_db_solo_una_en_juego",
    "Los pagos todavía no están activos.":
        "api_error_los_pagos_todavia_no_estan_activos",
    "No se pudo abrir el pago. Prueba en un momento.":
        "api_error_no_se_pudo_abrir_el_pago_prueba_en_un_momento",
    "Crear ligas privadas es de Pro":
        "api_error_db_crear_ligas_privadas_es_de_pro",
    "La pregunta propia es de Pro":
        "api_error_db_la_pregunta_propia_es_de_pro",
    "Las ligas privadas son de Pro":
        "api_error_db_las_ligas_privadas_son_de_pro",
    "Publicar es de Pro":
        "api_error_db_publicar_es_de_pro",
    "Crear ligas privadas es de Pro o de quien tiene un pase de liga":
        "api_error_db_crear_ligas_privadas_es_de_pro_o_pase",
    "Con Pro puedes tener hasta tres estrategias en juego a la vez":
        "api_error_db_con_pro_puedes_tener_hasta_tres_en_juego",
    "Con el plan gratuito solo puedes tener una estrategia en juego. Con Pro, hasta tres":
        "api_error_db_con_el_plan_gratuito_solo_una_en_juego",
    "Ya tienes todas tus ligas incluidas":
        "api_error_db_ya_tienes_todas_tus_ligas_incluidas",
    "No se pudo leer la suscripción. Prueba en un momento.":
        "api_error_no_se_pudo_leer_la_suscripcion",
}
ORIGEN_PLANTILLAS: tuple[tuple[str, str], ...] = (
    ("Tu plan permite {a} en juego a la vez", "dberr_tpl_plan_en_juego"),
)


ERROR_KEYS = {value: key for key, value in MESSAGES["es"].items() if key.startswith("api_error_")}
ERROR_KEYS.update(ORIGEN_ERRORES)
ERROR_KEYS.update({
    "Ya has enviado varias peticiones hoy. Vuelve mañana.": "api_error_intenciones_limite",
    "Escribe una frase de hasta 160 caracteres.": "api_error_intenciones_texto",
})


# Mensajes de la base de datos: con huecos (`{a}`, `{b}`) o escritos en inglés por el proveedor.
_PLANTILLAS_BD = tuple(
    (re.compile(re.escape(texto).replace(r"\{a\}", "(?P<a>.+?)").replace(r"\{b\}", "(?P<b>.+?)")),
     clave)
    for texto, clave in (*ORIGEN_PLANTILLAS, *((texto, clave)
                         for clave, texto in MESSAGES["es"].items()
                         if clave.startswith("dberr_tpl_"))))
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
