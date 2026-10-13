import pytest

from app.liga.estrategias import catalogo_payload
from app.liga.motor.estilos import ESTILOS, PRESETS
from app.liga.motor.seleccion import validar_receta


@pytest.mark.parametrize("clave", ESTILOS)
def test_recetas_validan(clave):
    receta = ESTILOS[clave].receta()
    assert validar_receta(receta) == []
    assert receta.catalogo_version == 1
    assert receta.n_empresas == 5 and receta.reparto == "igual"
    assert receta.max_por_sector == 0 and receta.pesos["pregunta"] == 0


def test_catalogo_ofrece_los_siete_estilos_con_su_receta():
    estilos = catalogo_payload()["estilos"]
    assert [e["clave"] for e in estilos] == list(ESTILOS)
    assert estilos[0]["reglas"] == ESTILOS["calidad"].receta().reglas
    assert estilos[0]["pesos"] == ESTILOS["calidad"].receta().pesos
    assert catalogo_payload()["presets"] == PRESETS


def test_presets_y_recetas_independientes():
    assert len(ESTILOS) == 7
    assert all(sum(p.values()) == 100 for p in PRESETS.values())
    receta = ESTILOS["calidad"].receta()
    receta.reglas[0]["params"]["roe_pct"] = 99
    receta.pesos["negocio"] = 0
    assert ESTILOS["calidad"].receta().reglas[0]["params"] == {"roe_pct": 15}
    assert ESTILOS["calidad"].receta().pesos["negocio"] == 40
