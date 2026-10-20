"""Ciclo público, recuento del ROE y primeros pasos de Aprender."""

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_premio_edad import URL, api  # noqa: F401
from test_procesos_integracion import _estrategia, fabrica  # noqa: F401

from app.config import settings
from app.liga import gestion, rutas, rutas_aprender
from app.liga.db import db_anon
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.procesos import premio as premio_proceso
from app.liga.rutas_aprender import (
    MercadoAprenderOut,
    RoeOut,
    _jornada_de_calendario,
    horas_del_ciclo,
    recuento_roe,
)


def test_horas_del_ciclo_en_la_semana_del_cambio_de_hora(monkeypatch):
    monkeypatch.setattr(settings, "scan_cron_hour", 16)
    monkeypatch.setattr(settings, "scan_cron_minute", 45)
    monkeypatch.setattr(settings, "scan_timezone", "America/New_York")
    horas = horas_del_ciclo(date(2026, 10, 30), date(2026, 11, 2))
    assert horas == {
        "escaneo": datetime(2026, 10, 30, 20, 45, tzinfo=UTC),
        "cierre_jornada": datetime(2026, 10, 30, 21, 30, tzinfo=UTC),
        "corte": datetime(2026, 10, 30, 22, 0, tzinfo=UTC),
        "cierre_cambios": datetime(2026, 11, 2, 14, 0, tzinfo=UTC),
        "apertura": datetime(2026, 11, 2, 14, 30, tzinfo=UTC),
    }
    madrid = ZoneInfo("Europe/Madrid")
    assert horas["corte"].astimezone(madrid).strftime("%H:%M") == "23:00"
    assert horas["cierre_cambios"].astimezone(madrid).strftime("%H:%M") == "15:00"


def test_jornada_de_calendario_cambia_de_anio():
    jornada = _jornada_de_calendario(date(2026, 12, 15))
    assert jornada["dia_inicio"] == date(2027, 1, 4)
    assert jornada["dia_base"] == date(2026, 12, 31)
    assert jornada["numero"] is None


def test_recuento_roe_con_la_regla_del_motor():
    r = recuento_roe([
        EmpresaFoto("A", precio=10, roe=Decimal("0.10")),
        EmpresaFoto("B", precio=10, roe=Decimal("0.16")),
        EmpresaFoto("C", precio=10, roe=Decimal("0.30")),
        EmpresaFoto("D", precio=10, roe=None),
        EmpresaFoto("E", precio=None, roe=Decimal("0.50")),
    ])
    assert r.minimo == 0
    assert r.maximo == 100
    assert r.paso == 1
    assert r.defecto == 15
    assert len(r.pasan) == 101
    assert r.pasan[20] == 1
    assert r.pasan[50] == 0
    assert all(a >= b for a, b in zip(r.pasan, r.pasan[1:], strict=False))


def _sin_bd():
    yield None


@pytest.fixture
def cliente_aprender():
    app = FastAPI()
    app.include_router(rutas_aprender.router, prefix="/liga")
    app.dependency_overrides[db_anon] = _sin_bd
    with TestClient(app) as cliente:
        yield cliente


def test_ciclo_sin_base_ni_liga_publica(cliente_aprender, monkeypatch):
    monkeypatch.setattr(rutas_aprender, "_proxima_jornada", lambda db: {
        "numero": 2, "dia_base": date(2026, 10, 30), "dia_inicio": date(2026, 11, 2),
        "dia_fin": date(2026, 11, 30),
        "cierre_inscripcion": datetime(2026, 10, 30, 22, 0, tzinfo=UTC),
    })
    monkeypatch.setattr(premio_proceso, "estado_publico", lambda: {"visible": False})
    monkeypatch.setattr(gestion, "liga_visible", lambda: False)
    respuesta = cliente_aprender.get("/liga/aprender/ciclo")
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["jornada"]["numero"] == 2
    assert datos["corte"].startswith("2026-10-30T22:00")
    assert datos["puntos"] == {"banda": "0.2", "gana": 3, "empata": 1, "pierde": 0}
    assert datos["premio"]["visible"] is False
    assert "max-age=300" in respuesta.headers["Cache-Control"]


def test_mercado_sin_datos_da_503(cliente_aprender, monkeypatch):
    def sin_foto():
        raise RuntimeError("sin foto")

    monkeypatch.setattr(rutas_aprender, "_mercado", sin_foto)
    assert cliente_aprender.get("/liga/aprender/mercado").status_code == 503


def test_mercado_con_datos(cliente_aprender, monkeypatch):
    datos = MercadoAprenderOut(
        foto_id=7, total=3,
        roe=RoeOut(minimo=0, maximo=2, paso=1, defecto=1, pasan=[3, 2, 1]))
    monkeypatch.setattr(rutas_aprender, "_mercado", lambda: datos)
    respuesta = cliente_aprender.get("/liga/aprender/mercado")
    assert respuesta.status_code == 200
    assert respuesta.json() == {
        "foto_id": 7, "total": 3,
        "roe": {"minimo": 0, "maximo": 2, "paso": 1, "defecto": 1, "pasan": [3, 2, 1]},
    }
    assert "max-age=600" in respuesta.headers["Cache-Control"]


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_primeros_pasos_sin_sesion(request):
    cliente = request.getfixturevalue("api")[0]
    assert cliente.get("/liga/yo/primeros-pasos").status_code == 401


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_primeros_pasos(request):
    _, _, usuario, _, _ = request.getfixturevalue("api")
    uid = usuario()
    crear_fabrica = request.getfixturevalue("fabrica")
    with crear_fabrica() as db:

        def leer():
            # La ruta lee como la cuenta: misma sesión, con su identidad y el rol de usuario.
            db.execute(text("select set_config('request.jwt.claims', :c, true)"),
                       {"c": json.dumps({"sub": uid, "role": "authenticated"})})
            db.execute(text("set local role authenticated"))
            pasos = rutas.primeros_pasos(db)
            db.execute(text("reset role"))
            return (pasos.estrategia, pasos.apuntada, pasos.jornada_cerrada)

        assert leer() == (False, False, False)
        eid = _estrategia(db, uid, "Pasos")
        assert leer() == (True, False, False)
        temporada = db.execute(text("insert into liga.temporadas (nombre, n_jornadas, cuenta) "
                                    "values ('Primeros pasos', 1, false) returning id"
                                    )).scalar_one()
        jornada = db.execute(text("""
            insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                       cierre_inscripcion)
            values (:t, 1, '2030-01-01', '2030-01-02', '2030-01-31', '2030-01-01') returning id
        """), {"t": temporada}).scalar_one()
        receta = db.execute(text("select receta_id from liga.estrategias where id = :e"),
                            {"e": eid}).scalar_one()
        inscripcion = db.execute(text("""
            insert into liga.inscripciones (jornada_id, estrategia_id, receta_id)
            values (:j, :e, :r) returning id
        """), {"j": jornada, "e": eid, "r": receta}).scalar_one()
        assert leer() == (True, True, False)
        db.execute(text("update liga.inscripciones set estado = 'cerrada' where id = :i"),
                   {"i": inscripcion})
        assert leer() == (True, True, True)
