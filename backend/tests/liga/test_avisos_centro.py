"""Avisos guardados, lectura por cuenta, caducidad y zona horaria."""
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from test_premio_edad import URL, api  # noqa: F401
from test_procesos_integracion import _estrategia, fabrica  # noqa: F401

from app import push
from app.liga import avisos, resumenes
from app.liga.motor.calendario import HORA_CIERRE_JORNADA, TZ_NUEVA_YORK, jornada_del_mes


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_lista_y_marcar_leidos(request):
    cliente, cab, usuario, cx, _ = request.getfixturevalue("api")
    a, b = usuario(), usuario()
    cx.execute("""
        insert into liga.avisos (usuario_id, tipo, datos, caduca) values
        (%s, 'cartera_lista', '{"jornada_id": 1}', now() + interval '1 day'),
        (%s, 'empieza', '{}', now() - interval '1 hour'),
        (%s, 'cartera_lista', '{}', now() + interval '1 day')
    """, (a, a, b))
    respuesta = cliente.get("/liga/avisos/lista", headers=cab(a))
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["sin_leer"] == 1
    assert len(datos["avisos"]) == 1
    assert datos["avisos"][0]["tipo"] == "cartera_lista"
    assert datos["avisos"][0]["datos"] == {"jornada_id": 1}
    assert datos["avisos"][0]["leido"] is False
    respuesta = cliente.post("/liga/avisos/leidos", headers=cab(a))
    assert respuesta.status_code == 200
    assert respuesta.json()["sin_leer"] == 0
    assert respuesta.json()["avisos"][0]["leido"] is True
    respuesta = cliente.get("/liga/avisos/lista", headers=cab(b))
    assert respuesta.status_code == 200
    assert respuesta.json()["sin_leer"] == 1
    assert cliente.get("/liga/avisos/lista").status_code == 401
    assert cliente.post("/liga/avisos/leidos").status_code == 401


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_zona_horaria(request):
    cliente, cab, usuario, cx, _ = request.getfixturevalue("api")
    uid = usuario()
    respuesta = cliente.put("/liga/yo/zona-horaria", headers=cab(uid),
                            json={"zona": "America/Mexico_City"})
    assert respuesta.status_code == 200
    assert respuesta.json() == {"zona": "America/Mexico_City"}
    fila = cx.execute("select zona_horaria from liga.perfiles_privados where id = %s",
                      (uid,)).fetchone()
    assert fila[0] == "America/Mexico_City"
    respuesta = cliente.put("/liga/yo/zona-horaria", headers=cab(uid),
                            json={"zona": "Marte/Base"})
    assert respuesta.status_code == 422


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_el_resumen_se_guarda_una_vez_por_cuenta_y_semana(request, monkeypatch):
    _, _, usuario, _, _ = request.getfixturevalue("api")
    uid = usuario()
    crear_fabrica = request.getfixturevalue("fabrica")
    with crear_fabrica() as db:
        temporada = db.execute(text("insert into liga.temporadas (nombre, n_jornadas, cuenta) "
                                    "values ('Resumen', 12, false) returning id")).scalar_one()
        jornada = db.execute(text("""
            insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                       cierre_inscripcion)
            values (:t, 1, '2030-01-31', '2030-02-01', '2030-02-28', '2030-01-31')
            returning id
        """), {"t": temporada}).scalar_one()
        estrategia = _estrategia(db, uid, "Resumen")
        receta = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                            {"e": estrategia}).scalar_one()
        db.execute(text("""
            insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado)
            values (:j, :e, :r, 'formada')
        """), {"j": jornada, "e": estrategia, "r": receta})
        monkeypatch.setattr(resumenes, "contenido", lambda db, u, tipo, j: {
            "numero": 1, "estrategia": "Resumen", "rentabilidad": Decimal("1.5"),
            "sp": Decimal("0.9"), "puesto_general": 2, "provisional": True})
        assert resumenes.guardar_avisos(db, "semanal", jornada, "2030-02-04") == 1
        assert resumenes.guardar_avisos(db, "semanal", jornada, "2030-02-04") == 0
        filas = db.execute(text("""
            select tipo, datos->>'puesto_general' as puesto, datos->>'semana' as semana,
                   caduca from liga.avisos where usuario_id = cast(:u as uuid)
        """), {"u": uid}).all()
        assert len(filas) == 1
        fila = filas[0]
        assert fila.tipo == "resumen_semanal"
        assert fila.puesto == "2"
        assert fila.semana == "2030-02-04"
        assert fila.caduca == datetime(2030, 2, 28, 17, 30,
                                      tzinfo=ZoneInfo("America/New_York"))
        assert resumenes.guardar_avisos(db, "mensual", jornada) == 1
        filas = db.execute(text("""
            select caduca from liga.avisos
            where usuario_id = cast(:u as uuid) and tipo = 'resumen_cierre'
        """), {"u": uid}).all()
        assert len(filas) == 1
        assert filas[0].caduca == datetime.combine(
            jornada_del_mes(2030, 3).dia_fin, HORA_CIERRE_JORNADA, tzinfo=TZ_NUEVA_YORK)


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_avisar_guarda_aunque_el_push_falle(request, monkeypatch):
    _, _, usuario, _, _ = request.getfixturevalue("api")
    uid = usuario()
    crear_fabrica = request.getfixturevalue("fabrica")
    with crear_fabrica() as db:
        db.execute(text("""
            insert into liga.suscripciones_push (usuario_id, endpoint, p256dh, auth)
            values (cast(:u as uuid), 'https://fcm.googleapis.com/fcm/send/x', 'p', 'a')
        """), {"u": uid})
        monkeypatch.setattr(push, "enviar", lambda *a: "error")
        cierra = datetime(2030, 2, 1, 14, 0, tzinfo=UTC)
        avisos.avisar(db, uid, "cartera_lista", cierra=cierra, caduca=cierra,
                      datos={"jornada_id": 9})
        cantidad = db.execute(text("""
            select count(*) from liga.avisos
            where usuario_id = cast(:u as uuid) and tipo = 'cartera_lista'
        """), {"u": uid}).scalar_one()
        assert cantidad == 1
