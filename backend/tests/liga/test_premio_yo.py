"""El premio propio respeta la edad, los resultados y la identidad de la cuenta."""
import json

import pytest
from sqlalchemy import text
from test_premio_edad import URL, api  # noqa: F401
from test_procesos_integracion import _estrategia, fabrica  # noqa: F401

from app.liga.procesos import premio

pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def escenario(request):
    _, _, usuario, _, _ = request.getfixturevalue("api")
    uid = usuario()
    otro = usuario()
    crear_fabrica = request.getfixturevalue("fabrica")
    with crear_fabrica() as db:
        db.execute(text("update liga.temporadas set cuenta = false where cuenta"))
        temporada = db.execute(text("insert into liga.temporadas (nombre, n_jornadas, cuenta) "
                                    "values ('Premio propio', 12, true) returning id")).scalar_one()
        jornadas = []
        for numero in range(1, 13):
            jornadas.append(db.execute(text("""
                insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                           cierre_inscripcion)
                values (:t, :n, '2030-01-01', '2030-01-02', '2030-01-31', '2030-01-01')
                returning id
            """), {"t": temporada, "n": numero}).scalar_one())

        def preparar(cuenta, edad, designada, jugadas):
            if edad is not None:
                db.execute(text("update liga.perfiles_privados set edad = :e where id = :u"),
                           {"e": edad, "u": cuenta})
            eid = _estrategia(db, cuenta, "Mi estrategia")
            db.execute(text("update liga.estrategias set opta_premio = :o where id = :e"),
                       {"o": designada, "e": eid})
            receta = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                                {"e": eid}).scalar_one()
            for jornada in jornadas[:jugadas]:
                inscripcion = db.execute(text("""
                    insert into liga.inscripciones (jornada_id, estrategia_id, receta_id,
                                                     optaba_premio)
                    values (:j, :e, :r, true) returning id
                """), {"j": jornada, "e": eid, "r": receta}).scalar_one()
                db.execute(text("insert into liga.resultados "
                                "(inscripcion_id, rentabilidad, puntos) "
                                "values (:i, 1, 3)"), {"i": inscripcion})
            return str(eid)

        def leer():
            db.execute(text("select set_config('request.jwt.claims', :c, true)"),
                       {"c": json.dumps({"sub": uid, "role": "authenticated"})})
            db.execute(text("set local role authenticated"))
            return premio.estado_yo(db)

        yield uid, otro, preparar, leer


@pytest.mark.parametrize(("edad", "designada", "jugadas", "estado", "optas"), [
    (None, False, 0, "sin_declarar", False),
    (16, True, 10, "menor", False),
    (18, True, 9, "mayor", False),
    (18, True, 10, "mayor", True),
    (18, False, 10, "mayor", False),
])
def test_requisitos_del_premio_propio(escenario, edad, designada, jugadas, estado, optas):
    uid, _, preparar, leer = escenario
    eid = preparar(uid, edad, designada, jugadas)
    resultado = leer()
    assert resultado["edad"] == estado
    assert resultado["jornadas_jugadas"] == jugadas
    assert resultado["minimo_jornadas"] == 10
    assert resultado["optas"] is optas
    assert resultado["estrategia"] == (
        {"id": eid, "nombre": "Mi estrategia"} if designada else None)


def test_las_jornadas_de_otra_cuenta_no_suman(escenario):
    uid, otro, preparar, leer = escenario
    preparar(uid, 18, True, 0)
    preparar(otro, 18, True, 12)
    assert leer()["jornadas_jugadas"] == 0
