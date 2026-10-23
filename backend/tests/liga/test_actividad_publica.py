"""Actividad pública con datos explícitos y una transacción que se deshace."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

pytest.importorskip("psycopg")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.liga import db as liga_db
from app.liga.actividad import actividad
from app.liga.rutas_publicas import exigir_visible, router

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
CREADA = datetime(2026, 1, 1, 12, tzinfo=UTC)


@pytest.fixture
def mundo(monkeypatch):
    engine = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    conn = engine.connect()
    trans = conn.begin()

    def fabrica():
        conn.execute(text("set local role none"))
        return Session(bind=conn, join_transaction_mode="create_savepoint", autoflush=False,
                       expire_on_commit=False)

    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    try:
        yield fabrica
    finally:
        trans.rollback()
        conn.close()
        engine.dispose()


def _preparar(fabrica, *, visibilidad="publicada", oculta=False, casa=False, cortes=2):
    with fabrica() as db:
        uid = uuid.uuid4()
        alias = "a" + uid.hex[:12]
        db.execute(text("""
            insert into auth.users (id, email, created_at, email_confirmed_at)
            values (:u, :email, :c, :c)
        """), {"u": uid, "email": f"{uid.hex}@prueba.local", "c": CREADA})
        db.execute(text("update liga.perfiles set alias = :a where id = :u"),
                   {"a": alias, "u": uid})
        if casa:
            eid = db.execute(text("""
                select id from liga.estrategias where tipo = 'casa' order by nombre limit 1
            """)).scalar_one_or_none()
            if eid is None:
                eid = db.execute(text("""
                    insert into liga.estrategias
                        (tipo, casa_clave, nombre, forma, dibujo, color1, color2, estado, creada)
                    values ('casa', 'alpha', 'Alpha', 'escudo', 'liso', '#0B6E68', '#FFFFFF',
                            'jugando', :c) returning id
                """), {"c": CREADA}).scalar_one()
        else:
            eid = db.execute(text("""
                insert into liga.estrategias
                    (dueno_id, nombre, forma, dibujo, color1, color2, estado,
                     visibilidad, declara_posiciones, oculta, creada)
                values (:u, 'Equipo público', 'escudo', 'liso', '#0B6E68', '#FFFFFF',
                        'jugando', :v, 'si', :o, :c) returning id
            """), {"u": uid, "v": visibilidad, "o": oculta, "c": CREADA}).scalar_one()
        nombre = db.execute(text("select nombre from liga.estrategias where id = :e"),
                            {"e": eid}).scalar_one()
        rid = db.execute(text("""
            insert into liga.recetas
                (estrategia_id, reglas, catalogo_version, peso_negocio, peso_precio,
                 peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, max_por_sector)
            values (:e, '[]', 1, 30, 20, 20, 0, 0, 5, 'igual', 2) returning id
        """), {"e": eid}).scalar_one()
        tid = db.execute(text("""
            insert into liga.temporadas (nombre, n_jornadas, cuenta, creado)
            values ('Actividad de prueba', :n, false, :c) returning id
        """), {"n": cortes, "c": CREADA}).scalar_one()
        fechas = []
        for numero in range(1, cortes + 1):
            inicio = date(2026, 2, 2) + timedelta(days=7 * (numero - 1))
            fin = inicio + timedelta(days=4)
            fechas.append(fin)
            jid = db.execute(text("""
                insert into liga.jornadas
                    (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                     cierre_inscripcion, estado, sp_rentabilidad, creado)
                values (:t, :n, :b, :i, :f, :c, 'cerrada', 0, :c) returning id
            """), {"t": tid, "n": numero, "b": inicio - timedelta(days=1),
                   "i": inicio, "f": fin, "c": CREADA}).scalar_one()
            iid = db.execute(text("""
                insert into liga.inscripciones
                    (jornada_id, estrategia_id, receta_id, estado, creado)
                values (:j, :e, :r, 'cerrada', :c) returning id
            """), {"j": jid, "e": eid, "r": rid, "c": CREADA}).scalar_one()
            db.execute(text("insert into liga.resultados values (:i, 1, 3)"), {"i": iid})
            db.execute(text("insert into liga.posiciones values (:i, :t, 100)"),
                       {"i": iid, "t": f"ZPA{numero}"})
        db.commit()
    return tid, eid, nombre, alias, fechas


def test_cambio_de_cartera_publicado_aparece(mundo):
    tid, _, nombre, alias, fechas = _preparar(mundo)
    with liga_db.sesion_como(None) as db:
        salida = actividad(db, tid, 10)
    assert salida.temporada_id == tid
    assert len(salida.items) == 1
    item = salida.items[0]
    assert item.tipo == "cambio" and item.dia == fechas[-1]
    assert item.equipo == nombre and item.autor == alias
    assert item.entradas == ["ZPA2"] and item.salidas == ["ZPA1"]


@pytest.mark.parametrize("visibilidad,oculta", [("privada", False), ("publicada", True)])
def test_estrategia_privada_no_aparece(mundo, visibilidad, oculta):
    tid, _, _, _, _ = _preparar(mundo, visibilidad=visibilidad, oculta=oculta)
    with liga_db.sesion_como(None) as db:
        assert actividad(db, tid, 10).items == []
        assert db.execute(text("select current_user")).scalar_one() == "anon"
        assert db.execute(text("select * from liga.actividad_publica(:t, 50)"),
                          {"t": tid}).all() == []


def test_la_casa_no_publica_cartera(mundo):
    tid, _, _, _, _ = _preparar(mundo, casa=True)
    with liga_db.sesion_como(None) as db:
        salida = actividad(db, tid, 10)
        assert all(item.tipo != "cambio" for item in salida.items)
        assert db.execute(text("select * from liga.actividad_publica(:t, 50)"),
                          {"t": tid}).all() == []


def test_limite_se_respeta(mundo):
    tid, _, _, _, fechas = _preparar(mundo, cortes=4)
    with liga_db.sesion_como(None) as db:
        salida = actividad(db, tid, 2)
    assert len(salida.items) == 2
    assert [item.dia for item in salida.items] == list(reversed(fechas[-2:]))
    assert [item.entradas for item in salida.items] == [["ZPA4"], ["ZPA3"]]


def test_anonimo_puede_leer_la_actividad(mundo):
    tid, _, nombre, alias, _ = _preparar(mundo)
    app = FastAPI()
    app.include_router(router, prefix="/liga")
    app.dependency_overrides[exigir_visible] = lambda: None
    with TestClient(app) as cliente:
        respuesta = cliente.get("/liga/publico/actividad", params={"temporada": tid})
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["temporada_id"] == tid
    assert datos["items"][0]["equipo"] == nombre
    assert datos["items"][0]["autor"] == alias


def test_sin_temporada_no_hay_actividad(mundo):
    with liga_db.sesion_como(None) as db:
        salida = actividad(db, None, 10)
    assert salida.temporada_id is None and salida.items == []


def test_saltos_del_ultimo_corte_incluyen_la_casa(mundo):
    tid, _, nombre, alias, fechas = _preparar(mundo)
    _, casa, nombre_casa, _, _ = _preparar(mundo, casa=True)
    with mundo() as db:
        jornadas = db.execute(text("""
            select id from liga.jornadas where temporada_id = :t order by numero
        """), {"t": tid}).scalars().all()
        for jid, retorno in zip(jornadas, (0, 100), strict=True):
            iid = db.execute(text("""
                insert into liga.inscripciones (jornada_id, estrategia_id, estado, creado)
                values (:j, :e, 'cerrada', :c) returning id
            """), {"j": jid, "e": casa, "c": CREADA}).scalar_one()
            db.execute(text("insert into liga.resultados values (:i, :r, 3)"),
                       {"i": iid, "r": retorno})
        db.commit()
    with liga_db.sesion_como(None) as db:
        salida = actividad(db, tid, 10)
    puestos = {item.equipo: item for item in salida.items if item.tipo == "puesto"}
    assert puestos[nombre].saltos == -1 and puestos[nombre].autor == alias
    assert puestos[nombre_casa].saltos == 1 and puestos[nombre_casa].autor is None
    assert all(item.dia == fechas[-1] for item in puestos.values())
    assert all(item.entradas == [] and item.salidas == [] for item in puestos.values())
    assert [(item.dia, item.equipo) for item in salida.items] == sorted(
        [(item.dia, item.equipo) for item in salida.items],
        key=lambda item: (-item[0].toordinal(), item[1]))
