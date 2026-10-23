"""Novedades con RLS y datos aislados por rollback en la BD local de pruebas."""

from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

pytest.importorskip("psycopg")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.liga import db as liga_db
from app.liga.auth import Identidad
from app.liga.motor.calendario import DESDE, dias_de_bolsa
from app.liga.novedades import CambioOut, construir

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


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
        with fabrica() as db:
            ahora = db.execute(text("select now()")).scalar_one()
            creada = ahora - timedelta(days=10)
            uid = uuid.uuid4()
            ajeno = uuid.uuid4()
            for u in (uid, ajeno):
                db.execute(text("""
                    insert into auth.users (id, email, created_at, email_confirmed_at)
                    values (:u, :email, :c, :c)
                """), {"u": u, "email": f"{u.hex}@prueba.local", "c": creada})
            db.commit()
        yield fabrica, uid, ajeno, ahora
    finally:
        trans.rollback()
        conn.close()
        engine.dispose()


@contextmanager
def _como(uid):
    ident = Identidad(str(uid), "aal1", {"sub": str(uid), "role": "authenticated"})
    with liga_db.sesion_como(ident) as db:
        yield db


def _estrategia_con_receta(db, dueno, creada):
    eid = db.execute(text("""
        insert into liga.estrategias
            (dueno_id, nombre, forma, dibujo, color1, color2, creada)
        values (:u, 'Prueba novedades', 'escudo', 'liso', '#0B6E68', '#FFFFFF', :c)
        returning id
    """), {"u": dueno, "c": creada}).scalar_one()
    rid = db.execute(text("""
        insert into liga.recetas
            (estrategia_id, reglas, catalogo_version, pregunta,
             peso_negocio, peso_precio, peso_deuda, peso_pronto, peso_pregunta,
             n_empresas, reparto, max_por_sector)
        values (:e, '[]', 1, null, 30, 20, 20, 0, 0, 5, 'igual', 2)
        returning id
    """), {"e": eid}).scalar_one()
    db.execute(text("""
        update liga.estrategias set receta_id = :r, estado = 'apuntada' where id = :e
    """), {"r": rid, "e": eid})
    return eid, rid


def _semana(mundo, dueno=None):
    fabrica, uid, _, ahora = mundo
    dueno = dueno or uid
    ayer = ahora.astimezone(ZoneInfo("America/New_York")).date() - timedelta(days=1)
    sesiones = dias_de_bolsa(DESDE, ayer)
    fin = sesiones[-1]
    inicio = sesiones[-4]
    base = sesiones[-5]
    creada = ahora - timedelta(days=10)
    with fabrica() as db:
        db.execute(text("""
            insert into liga.visitas (usuario_id, session_id, inicio, ultima_actividad)
            values (:u, :s, :d, :d)
        """), {"u": uid, "s": uuid.uuid4(), "d": ahora - timedelta(days=2)})
        eid, rid = _estrategia_con_receta(db, dueno, creada)
        tid = db.execute(text("""
            insert into liga.temporadas (nombre, n_jornadas, cuenta, creado)
            values ('Prueba novedades', 2, true, :c) returning id
        """), {"c": creada}).scalar_one()
        parametros = {"t": tid, "base": base, "inicio": inicio,
                      "fin": fin, "c": creada}
        jid = db.execute(text("""
            insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                      cierre_inscripcion, estado, sp_rentabilidad, creado)
            values (:t, 1, :base, :inicio, :fin, :c, 'cerrada', 0.8, :c) returning id
        """), parametros).scalar_one()
        iid = db.execute(text("""
            insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado, creado)
            values (:j, :e, :r, 'cerrada', :c) returning id
        """), {"j": jid, "e": eid, "r": rid, "c": creada}).scalar_one()
        db.execute(text("insert into liga.resultados values (:i, 1.4, 3)"), {"i": iid})
        db.execute(text("insert into liga.posiciones values (:i, 'ZPA', 100)"), {"i": iid})
        for dia, precio in ((base, 100), (fin, 102)):
            db.execute(text("""
                insert into precio_cierre (ticker, dia, cierre, fuente, created_at)
                values ('ZPA', :d, :p, 'prueba', :c)
                on conflict (ticker, dia) do update set cierre = excluded.cierre
            """), {"d": dia, "p": precio, "c": creada})
        programada = db.execute(text("""
            insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin,
                                      cierre_inscripcion, creado)
            values (:t, 2, :base, :inicio, :inicio, :c, :c) returning id
        """), {"t": tid, "base": fin, "inicio": fin + timedelta(days=1), "c": creada}).scalar_one()
        db.commit()
    return eid, programada, fin + timedelta(days=1)


def test_sin_visita_anterior_no_hay_novedades(mundo):
    _, uid, _, ahora = mundo
    with _como(uid) as db:
        assert construir(db, ahora) is None


def test_semana_cerrada_con_movidas_y_puesto(mundo):
    _semana(mundo)
    with _como(mundo[1]) as db:
        salida = construir(db, mundo[3])
        assert salida is not None
        e = salida.estrategias[0]
        assert e.semana.puntos == 3
        assert e.semana.rentabilidad == Decimal("1.4")
        assert e.semana.sp500 == Decimal("0.8")
        assert e.semana.puesto == 1 and e.semana.de == 1
        assert 1 <= len(e.movidas) <= 5
        assert e.movidas[0].aportacion == Decimal(2)
        assert e.desde_lunes is None
        assert e.cambios == []


def test_marcar_vistas_y_luego_un_cambio(mundo):
    eid, jid, inicio = _semana(mundo)
    fabrica, uid, _, ahora = mundo
    with _como(uid) as db:
        assert construir(db, ahora) is not None
        db.execute(text("select liga.marcar_novedades_vistas()"))
        assert construir(db, ahora) is None
        vistas = db.execute(text("select liga.novedades_desde()")).scalar_one()
    creada = vistas + timedelta(seconds=1)
    with fabrica() as db:
        db.execute(text("""
            insert into liga.auditoria (accion, objeto, detalle, creada)
            values ('cambios.quitar', :objeto, cast(:detalle as jsonb), :c)
        """), {"objeto": f"estrategia:{eid}",
               "detalle": json.dumps({"ticker": "ZPA", "jornada_id": jid}),
               "c": creada})
        db.commit()
    with _como(uid) as db:
        salida = construir(db, ahora)
        assert salida is not None
        assert len(salida.estrategias) == 1
        e = salida.estrategias[0]
        assert e.estrategia_id == eid and e.semana is None
        assert e.cambios == [CambioOut(accion="quitar", ticker="ZPA",
                                      fecha=creada.astimezone(ZoneInfo("Europe/Madrid")).date(),
                                      cuenta_desde=inicio)]


def test_no_muestra_estrategias_ajenas(mundo):
    _semana(mundo, dueno=mundo[2])
    with _como(mundo[1]) as db:
        assert construir(db, mundo[3]) is None


def test_cierres_de_mis_posiciones_no_devuelve_precios_ajenos(mundo):
    eid, _, _ = _semana(mundo)
    fabrica, uid, ajeno, ahora = mundo
    with fabrica() as db:
        otro, receta = _estrategia_con_receta(db, ajeno, ahora - timedelta(days=10))
        jornada = db.execute(text("""
            select jornada_id from liga.inscripciones where estrategia_id = :e
        """), {"e": eid}).scalar_one()
        inscripcion = db.execute(text("""
            insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado, creado)
            values (:j, :e, :r, 'cerrada', :c) returning id
        """), {"j": jornada, "e": otro, "r": receta, "c": ahora}).scalar_one()
        db.execute(text("insert into liga.posiciones values (:i, 'AJENA', 100)"),
                   {"i": inscripcion})
        for ticker in ("ZPA", "AJENA", "SPY"):
            for dia in ("2026-06-01", "2026-06-05"):
                db.execute(text("""
                    insert into public.precio_cierre (ticker, dia, cierre, fuente, created_at)
                    values (:t, cast(:d as date), 100, 'prueba', :c)
                    on conflict (ticker, dia) do update set cierre = excluded.cierre
                """), {"t": ticker, "d": dia, "c": ahora})
        db.commit()
    with _como(uid) as db:
        filas = db.execute(text("""
            select ticker, dia, cierre, dividendo, split
            from liga.cierres_de_mis_posiciones(date '2026-06-01', date '2026-06-05')
        """)).all()
        tickers = {f.ticker for f in filas}
        assert "AJENA" not in tickers
        assert {"ZPA", "SPY"} <= tickers



def _quitar_con_carteras(mundo, estado, tickers):
    eid, jid, _ = _semana(mundo)
    fabrica, _, _, ahora = mundo
    with fabrica() as db:
        anterior = db.execute(text("""
            select id, jornada_id, receta_id from liga.inscripciones
            where estrategia_id = :e
        """), {"e": eid}).one()
        db.execute(text("""
            update liga.jornadas
            set dia_base = date '2026-06-05', dia_inicio = date '2026-06-08',
                dia_fin = date '2026-06-12'
            where id = :j
        """), {"j": anterior.jornada_id})
        db.execute(text("delete from liga.posiciones where inscripcion_id = :i"),
                   {"i": anterior.id})
        for ticker in ("A", "B", "C"):
            db.execute(text("insert into liga.posiciones values (:i, :t, 30)"),
                       {"i": anterior.id, "t": ticker})
        db.execute(text("""
            update liga.jornadas
            set estado = :estado, dia_base = date '2026-06-12',
                dia_inicio = date '2026-06-15', dia_fin = date '2026-06-19'
            where id = :j
        """), {"j": jid, "estado": estado})
        inscripcion = db.execute(text("""
            insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado, creado)
            values (:j, :e, :r, :estado, :c) returning id
        """), {"j": jid, "e": eid, "r": anterior.receta_id,
               "estado": "inscrita" if estado == "programada" else estado,
               "c": ahora - timedelta(days=10)}).scalar_one()
        for ticker in tickers:
            db.execute(text("insert into liga.posiciones values (:i, :t, 30)"),
                       {"i": inscripcion, "t": ticker})
        db.execute(text("""
            insert into liga.auditoria (accion, objeto, detalle, creada)
            values ('cambios.quitar', :objeto, cast(:detalle as jsonb), :c)
        """), {"objeto": f"estrategia:{eid}",
               "detalle": json.dumps({"ticker": "C", "jornada_id": jid}),
               "c": ahora - timedelta(days=1)})
        db.commit()


def test_quitar_con_corte_formado_muestra_la_que_entra(mundo):
    _quitar_con_carteras(mundo, "formada", ("A", "B", "D"))
    with _como(mundo[1]) as db:
        salida = construir(db, mundo[3])
        assert salida is not None
        cambio, = salida.estrategias[0].cambios
        assert cambio.ticker == "C"
        assert cambio.entra == "D"


def test_quitar_con_corte_pendiente_no_empareja(mundo):
    _quitar_con_carteras(mundo, "programada", ("A", "B", "D"))
    with _como(mundo[1]) as db:
        salida = construir(db, mundo[3])
        assert salida is not None
        cambio, = salida.estrategias[0].cambios
        assert cambio.entra is None


def test_varias_entradas_no_empareja(mundo):
    _quitar_con_carteras(mundo, "formada", ("A", "D", "E"))
    with _como(mundo[1]) as db:
        salida = construir(db, mundo[3])
        assert salida is not None
        cambio, = salida.estrategias[0].cambios
        assert cambio.entra is None
