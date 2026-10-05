"""Los textos del motor se redactan en inglés sin cambiar la selección ni el español."""

import copy
import pickle
import re
from decimal import Decimal
from pathlib import Path

from app.i18n import MESSAGES
from app.liga.motor import catalogo, mensajes
from app.liga.motor.catalogo import CATALOGO, EmpresaFoto
from app.liga.motor.mensajes import Texto, presentar, presentar_lista
from app.liga.motor.seleccion import (
    ETIQUETAS_PESO,
    NotasJev,
    Receta,
    explicar,
    seleccionar,
)

M = 1_000_000


def _empresa(**kw) -> EmpresaFoto:
    base = {"nombre": "Acme Inc", "sector": "Technology", "market_cap_usd": 1_900 * M}
    return EmpresaFoto("ACME", **{**base, **kw})


def test_el_motivo_se_redacta_en_los_dos_idiomas_con_las_mismas_cifras() -> None:
    motivo = CATALOGO["grandes"].evaluar(_empresa())
    assert motivo == "vale 1.900 M$ y pides más de 10.000 M$"
    assert presentar(motivo, "es") == motivo
    assert presentar(motivo, "en") == "it is worth $1,900M and you ask for more than $10,000M"


def test_billon_espanol_es_trillion_en_ingles() -> None:
    motivo = CATALOGO["grandes"].evaluar(_empresa(market_cap_usd=3_400_000 * M))
    assert motivo is None
    alto = Texto("motor_cap_mayor", cap=mensajes.Usd(3_400_000), umbral=mensajes.Usd(10_000))
    assert "3,4 billones de $" in alto
    assert "$3.4 trillion" in presentar(alto, "en")


def test_las_reglas_describen_su_condicion_en_inglés() -> None:
    assert presentar(CATALOGO["deuda"].detalle({"anios": 2}), "en") == "net debt below 2x EBITDA"
    assert presentar(CATALOGO["pequenas"].detalle(), "en") == (
        "market cap between $300M and $2,000M")
    assert presentar(CATALOGO["pequenas"].detalle(), "es") == (
        "capitalización entre 300 y 2.000 M$")
    lista = CATALOGO["solo_sectores"].detalle({"sectores": ["Technology", "Industrials"]})
    assert presentar(lista, "es") == "industria y tecnología"
    assert presentar(lista, "en") == "industrials and technology"


def test_la_ausencia_de_dato_se_distingue_por_codigo_no_por_el_texto() -> None:
    sin_dato = CATALOGO["barata"].evaluar(_empresa(per=None))
    assert sin_dato.sin_dato
    assert not CATALOGO["barata"].evaluar(_empresa(per=-3)).sin_dato
    assert CATALOGO["dividendo"].evaluar(_empresa(dividend_yield_pct=None)).sin_dato


def test_los_errores_de_validacion_se_redactan_en_ingles() -> None:
    errores = catalogo.validar_reglas([{"clave": "deuda", "params": {"anios": 99}},
                                       {"clave": "inventada"}])
    assert presentar_lista(errores, "en") == (
        "In \"Low debt\", the maximum net debt/EBITDA ratio (times) ranges from 0.5 to 5. "
        "The rule \"inventada\" is not in the catalog.")
    assert presentar_lista(errores, "es") == " ".join(errores)


def test_la_seleccion_es_la_misma_y_el_porque_cambia_de_idioma() -> None:
    empresas = [_empresa(), EmpresaFoto("BETA", nombre="Beta SA", sector="Energy",
                                        market_cap_usd=50_000 * M)]
    notas = {e.ticker: NotasJev(*[Decimal(7)] * 4) for e in empresas}
    receta = Receta(reglas=[], pesos={"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0,
                                      "pregunta": 0},
                    n_empresas=3, reparto="igual", max_por_sector=0)
    resultado = seleccionar(empresas, receta, notas, {})
    assert [e.ticker for e in resultado.elegidas] == ["BETA", "ACME"]
    primera = resultado.elegidas[0]
    assert presentar(primera.porque, "es").startswith("Destaca en «que el negocio vaya bien».")
    assert presentar(primera.porque, "en") == "Stands out in \"fundamentals\". Score 78."
    assert presentar(explicar("ACME", resultado, receta), "en") == (
        "Acme Inc makes it: it ranks #2, with a 33% weight.")


def test_un_texto_se_copia_y_se_serializa_sin_perder_su_redaccion() -> None:
    texto = CATALOGO["grandes"].evaluar(_empresa())
    for copia in (copy.copy(texto), copy.deepcopy(texto), pickle.loads(pickle.dumps(texto))):
        assert copia == texto
        assert presentar(copia, "en") == presentar(texto, "en")


def test_cada_codigo_del_motor_existe_en_los_dos_idiomas_con_los_mismos_huecos() -> None:
    raiz = Path(__file__).resolve().parents[2] / "app" / "liga" / "motor"
    usados = set()
    for fichero in raiz.glob("*.py"):
        usados |= set(re.findall(r'Texto\(\s*"(motor_\w+)"', fichero.read_text(encoding="utf-8")))
    usados |= {f"motor_seguridad_{s}" for s in ("alta", "media", "baja")}
    usados |= {"motor_porque_nota", "motor_si", "motor_no", "motor_cap_mayor"}
    assert usados, "no se encontró ningún código del motor"
    for codigo in sorted(usados):
        assert codigo in MESSAGES["es"], codigo
        assert codigo in MESSAGES["en"], codigo


def test_los_nombres_de_reglas_y_pesos_coinciden_con_el_catalogo_en_castellano() -> None:
    for clave, regla in CATALOGO.items():
        assert mensajes.Regla(clave).redactar("es") == regla.titulo
    for clave, etiqueta in ETIQUETAS_PESO.items():
        assert mensajes.Peso(clave).redactar("es") == etiqueta
