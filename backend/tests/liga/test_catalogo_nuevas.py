"""Reglas ofrecidas nuevas y compatibilidad de recetas guardadas."""

from decimal import Decimal
from string import Formatter

import pytest

from app.i18n import MESSAGES, present_catalog
from app.liga.estrategias import catalogo_payload
from app.liga.ia.conversor import _catalogo_para_prompt
from app.liga.motor.catalogo import CATALOGO, EmpresaFoto, fallo, regla_por_defecto, validar_reglas
from app.liga.motor.mensajes import presentar
from app.liga.motor.seleccion import NotasJev, Receta, seleccionar, validar_receta

CASOS = [
    ("pb", {"pb": 2}, {"pb": 3}, "3"),
    ("ev_ebitda", {"ev_ebitda": 10}, {"ev_ebitda": 12}, "12"),
    ("fcf", {"fcf_pct": 5}, {"fcf_pct": 4}, "4"),
    ("roa", {"roa": .07}, {"roa": .06}, "6"),
    ("margen_neto", {"margen_neto": .11}, {"margen_neto": .10}, "10"),
    ("deuda_pn", {"deuda_pn_pct": 90}, {"deuda_pn_pct": 100}, "100"),
    ("liquidez_corriente", {"liquidez_corriente": 2}, {"liquidez_corriente": 1.5}, "1,5"),
    ("payout", {"payout_pct": 60}, {"payout_pct": 70}, "70"),
    ("beta", {"beta": 1}, {"beta": 1.2}, "1,2"),
    ("castigadas_pct", {"precio": 70, "max_52s": 100},
     {"precio": 80, "max_52s": 100}, "20"),
    ("fuerza_sp", {"vs_sp_52s": 1}, {"vs_sp_52s": 0}, "0"),
    ("liquidez", {"volumen_usd_dia": 2}, {"volumen_usd_dia": 1}, "1"),
    ("directivos", {"directivos_pct": 6}, {"directivos_pct": 5}, "5"),
    ("cortos", {"cortos_pct": 9}, {"cortos_pct": 10}, "10"),
    ("tamano", {"market_cap_usd": 20_000_000}, {"market_cap_usd": 19_000_000}, "19"),
]


@pytest.mark.parametrize("clave,pasa,no_pasa,cifra", CASOS)
def test_regla_pasa_falla_con_cifra_y_rechaza_sin_dato(clave, pasa, no_pasa, cifra):
    regla = CATALOGO[clave]
    assert validar_reglas([regla_por_defecto(clave)]) == []
    assert regla.evaluar(EmpresaFoto("X", **pasa)) is None
    motivo = regla.evaluar(EmpresaFoto("X", **no_pasa))
    assert cifra in motivo and "pides" in motivo
    assert presentar(motivo, "en")
    sin_dato = regla.evaluar(EmpresaFoto("X"))
    assert sin_dato.startswith("no ") and sin_dato.sin_dato
    assert presentar(sin_dato, "en")
    assert regla.detalle() and presentar(regla.detalle(), "en")


@pytest.mark.parametrize("valor", [0, -1])
def test_ev_ebitda_no_positivo_no_pasa(valor):
    assert CATALOGO["ev_ebitda"].evaluar(EmpresaFoto("X", ev_ebitda=valor)) is not None


@pytest.mark.parametrize("valor", [0.2, True, "1", None, float("nan"), float("inf")])
def test_liquidez_rechaza_valores_fuera_de_lista(valor):
    assert validar_reglas([{"clave": "liquidez", "params": {"p": valor}}])


@pytest.mark.parametrize("valor", CATALOGO["liquidez"].parametros[0].valores)
def test_liquidez_acepta_lista(valor):
    assert validar_reglas([{"clave": "liquidez", "params": {"p": valor}}]) == []


@pytest.mark.parametrize("desde,hasta", [(100, 100), (300, 100)])
def test_tamano_orden(desde, hasta):
    errores = validar_reglas([{"clave": "tamano", "params": {"desde": desde, "hasta": hasta}}])
    assert [e.codigo for e in errores] == ["motor_val_tamano_orden"]


def test_tamano_limites_y_extremo_abierto():
    regla = CATALOGO["tamano"]
    params = {"desde": 20, "hasta": 100}
    assert regla.evaluar(EmpresaFoto("X", market_cap_usd=20_000_000), params) is None
    assert regla.evaluar(EmpresaFoto("X", market_cap_usd=99_000_000), params) is None
    assert "100" in regla.evaluar(EmpresaFoto("X", market_cap_usd=100_000_000), params)
    assert regla.evaluar(EmpresaFoto("X", market_cap_usd=9_000_000_000_000)) is None
    assert validar_reglas([{"clave": "tamano", "params": {"desde": 21, "hasta": 100}}])
    assert presentar(regla.detalle(params), "en")


def test_catalogo_ofrecido_con_grupos_y_listas_y_prompt():
    payload = catalogo_payload()
    claves = {r["clave"] for r in payload["reglas"]}
    assert claves == {k for k, r in CATALOGO.items() if r.ofrecida}
    assert not claves.intersection({"grandes", "medianas", "pequenas", "castigadas"})
    assert payload["version"] == 1
    for r in payload["reglas"]:
        assert r["grupo"] == CATALOGO[r["clave"]].grupo and r["grupo"]
        for p in r["parametros"]:
            if p["tipo"] == "lista":
                assert p["valores"] == list(CATALOGO[r["clave"]].parametros[
                    [x.nombre for x in CATALOGO[r["clave"]].parametros].index(p["nombre"])].valores)
    assert present_catalog(payload, "en")["reglas"]
    prompt = _catalogo_para_prompt()
    assert "- grandes:" not in prompt and "- castigadas:" not in prompt
    assert "- tamano:" in prompt and "one of" in prompt


def test_mensajes_nuevos_con_mismos_parametros_en_ambos_idiomas():
    for clave, *_ in CASOS:
        for codigo in (f"motor_det_{clave}", f"liga_catalogo_regla_{clave}"):
            campos = [{n for _, n, _, _ in Formatter().parse(
                MESSAGES[locale][codigo]) if n} for locale in ("es", "en")]
            assert campos[0] == campos[1]


def test_receta_antigua_valida_y_selecciona_con_limites_originales():
    reglas = [regla_por_defecto("grandes"), regla_por_defecto("castigadas")]
    receta = Receta(reglas=reglas, pesos={"negocio": 50, "precio": 0, "deuda": 0,
                                      "pronto": 0, "pregunta": 0},
                    n_empresas=3, reparto="igual", max_por_sector=0)
    assert validar_receta(receta) == []
    empresas = [EmpresaFoto(t, market_cap_usd=cap * 1_000_000, precio=precio, max_52s=100)
                for t, cap, precio in [("A", 10001, 70), ("B", 10000, 60),
                                       ("C", 20000, 71), ("D", 30000, 60)]]
    notas = {e.ticker: NotasJev(*(Decimal(9),) * 4) for e in empresas}
    seleccion = seleccionar(empresas, receta, notas)
    assert [e.ticker for e in seleccion.elegidas] == ["D", "A"]
    assert fallo(empresas[1], reglas).startswith("vale")
    assert "29" in fallo(empresas[2], reglas)
