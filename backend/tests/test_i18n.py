"""Presentación localizada sin cambiar filtros, valores ni identidades."""

from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context

import pytest

from app.i18n import (
    ERROR_KEYS,
    MESSAGES,
    current_locale,
    present_catalog,
    present_error_detail,
    resolve_locale,
)
from app.liga.estrategias import catalogo_payload


def test_locale_priority_and_validation():
    assert resolve_locale("en-US;q=0.4,es;q=0.9") == "es"
    assert resolve_locale("es;q=0,en-GB") == "en"
    assert resolve_locale("en;q=nan,fr") == "es"
    assert resolve_locale("../en") == "es"


def test_catalog_preserves_all_contract_data_and_original():
    original = catalogo_payload()
    translated = present_catalog(original, "en")
    assert translated["version"] == original["version"]
    assert translated["sectores"].keys() == original["sectores"].keys()
    assert translated["pesos"]["claves"] == original["pesos"]["claves"]
    for before, after in zip(original["reglas"], translated["reglas"], strict=True):
        assert before["clave"] == after["clave"]
        assert before["titulo"] != after["titulo"]
        for old, new in zip(before["parametros"], after["parametros"], strict=True):
            assert {k: v for k, v in old.items() if k != "etiqueta"} == {
                k: v for k, v in new.items() if k != "etiqueta"}
    assert original == catalogo_payload()
    assert present_catalog(original, "es") == original


def test_locale_context_does_not_leak_between_requests():
    token = current_locale.set("en")
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(current_locale.get).result() == "es"
            assert pool.submit(copy_context().run, current_locale.get).result() == "en"
    finally:
        current_locale.reset(token)
    assert current_locale.get() == "es"


def test_error_catalog_preserves_unknown_original_content():
    assert MESSAGES["es"].keys() == MESSAGES["en"].keys()
    for original, key in ERROR_KEYS.items():
        assert present_error_detail(original, "es") == MESSAGES["es"][key]
        assert present_error_detail(original, "en") == MESSAGES["en"][key]
    assert present_error_detail("Original user report", "en") == "Original user report"


@pytest.mark.parametrize("locale", ["es", "en"])
def test_error_origin_uses_presentation_catalog(locale):
    assert present_error_detail("Publicar es de Pro", locale) == (
        MESSAGES[locale]["api_error_db_publicar_es_de_pro"])
    assert present_error_detail("Tu plan permite 3 en juego a la vez", locale) == (
        MESSAGES[locale]["dberr_tpl_plan_en_juego"].format(a=3))
    assert present_error_detail("Error desconocido", locale) == "Error desconocido"
    assert present_error_detail(
        "Con Pro puedes tener hasta tres estrategias en juego a la vez", locale) == (
        MESSAGES[locale]["api_error_db_con_pro_puedes_tener_hasta_tres_en_juego"])
    assert MESSAGES[locale]["api_error_db_con_pro_puedes_tener_hasta_tres_en_juego"] != (
        MESSAGES[locale]["api_error_db_con_el_plan_gratuito_solo_una_en_juego"])
