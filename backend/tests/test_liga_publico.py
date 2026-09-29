"""API pública de la liga contra el Postgres de pruebas (se salta sin `LIGA_TEST_DATABASE_URL`).
Los datos se crean como sistema y se leen como anon, igual que en producción; al final se borran
(con las guardas de «solo añadir» apagadas solo en esa limpieza)."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def liga(monkeypatch):  # noqa: ANN001, ANN201
    psycopg = pytest.importorskip("psycopg")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import db as liga_db
    from app.liga.rutas import router

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    # `exigir_visible` (plan §14) y otros servicios de sistema abren su sesión con
    # `app.db.SessionLocal` directamente (`fabrica_sistema`), no con la de `app.liga.db`.
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    app = FastAPI()
    app.include_router(router)
    cx = psycopg.connect(URL, autocommit=True)
    creado: dict[str, list] = {"usuarios": [], "temporadas": []}

    def usuario(alias: str, oculto: bool = False) -> uuid.UUID:
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email) values (%s, %s)",
                   (uid, f"{uid.hex[:12]}@prueba.local"))
        cx.execute("update liga.perfiles set alias = %s, oculto = %s where id = %s",
                   (alias, oculto, uid))
        creado["usuarios"].append(uid)
        return uid

    def estrategia(dueno: uuid.UUID, nombre: str, estado: str = "jugando",
                   oculta: bool = False) -> tuple[uuid.UUID, int]:
        eid = cx.execute(
            "insert into liga.estrategias (dueno_id, nombre, forma, dibujo, color1, color2, "
            "estado, oculta) values (%s, %s, 'escudo', 'liso', '#0B6E68', '#FFFFFF', %s, %s) "
            "returning id", (dueno, nombre, estado, oculta)).fetchone()[0]
        rid = cx.execute(
            "insert into liga.recetas (estrategia_id, catalogo_version, peso_negocio, "
            "peso_precio, peso_deuda, peso_pronto, peso_pregunta, n_empresas, reparto, "
            "max_por_sector) values (%s, 1, 25, 25, 25, 25, 0, 5, 'igual', 0) returning id",
            (eid,)).fetchone()[0]
        return eid, rid

    def temporada(cuenta: bool = True) -> int:
        tid = cx.execute(
            "insert into liga.temporadas (nombre, n_jornadas, cuenta, estado) "
            "values ('Temporada de prueba', 12, %s, 'en_juego') returning id",
            (cuenta,)).fetchone()[0]
        creado["temporadas"].append(tid)
        return tid

    def jornada(tid: int, numero: int, estado: str, sp: str | None, inicio: date) -> int:
        return cx.execute(
            "insert into liga.jornadas (temporada_id, numero, dia_base, dia_inicio, dia_fin, "
            "cierre_inscripcion, estado, sp_rentabilidad) values (%s, %s, %s, %s, %s, %s, %s, %s) "
            "returning id",
            (tid, numero, inicio - timedelta(days=1), inicio, inicio + timedelta(days=27),
             datetime.combine(inicio - timedelta(days=1), datetime.min.time(), UTC),
             estado, sp)).fetchone()[0]

    def juega(jid: int, eid: uuid.UUID, rid: int, rent: str | None, puntos: int | None) -> None:
        iid = cx.execute("insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, "
                         "estado) values (%s, %s, %s, 'cerrada') returning id",
                         (jid, eid, rid)).fetchone()[0]
        if rent is not None:
            cx.execute("insert into liga.resultados values (%s, %s, %s)", (iid, rent, puntos))

    try:
        yield TestClient(app), usuario, estrategia, temporada, jornada, juega
    finally:
        # Guardas de «solo añadir» apagadas solo para estos dos borrados: `replica` también
        # apaga las cascadas, así que lo demás se borra con ellas encendidas.
        cx.execute("set session_replication_role = replica")
        for tid in creado["temporadas"]:
            cx.execute("delete from liga.resultados where inscripcion_id in (select i.id from "
                       "liga.inscripciones i join liga.jornadas j on j.id = i.jornada_id "
                       "where j.temporada_id = %s)", (tid,))
        for uid in creado["usuarios"]:
            cx.execute("update liga.estrategias set receta_id = null where dueno_id = %s", (uid,))
            cx.execute("delete from liga.recetas where estrategia_id in "
                       "(select id from liga.estrategias where dueno_id = %s)", (uid,))
        cx.execute("set session_replication_role = origin")
        for tid in creado["temporadas"]:
            cx.execute("delete from liga.inscripciones where jornada_id in "
                       "(select id from liga.jornadas where temporada_id = %s)", (tid,))
            cx.execute("delete from liga.jornadas where temporada_id = %s", (tid,))
            cx.execute("delete from liga.temporadas where id = %s", (tid,))
        for uid in creado["usuarios"]:
            cx.execute("delete from liga.estrategias where dueno_id = %s", (uid,))
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


def test_clasificacion_y_jornada_como_las_ve_cualquiera(liga) -> None:  # noqa: ANN001
    cliente, usuario, estrategia, temporada, jornada, juega = liga
    sufijo = uuid.uuid4().hex[:6]
    marta, oculto = usuario(f"marta_{sufijo}"), usuario(f"oculto_{sufijo}", oculto=True)
    e1, r1 = estrategia(marta, "Foso ancho")
    e2, r2 = estrategia(oculto, "Sin autor visible")
    e3, r3 = estrategia(marta, "Escondida", oculta=True)
    tid = temporada()
    hoy = date.today()
    j1 = jornada(tid, 1, "cerrada", "1.0000", hoy - timedelta(days=60))
    j2 = jornada(tid, 2, "cerrada", "-2.0000", hoy - timedelta(days=30))
    juega(j1, e1, r1, "2.5000", 3)
    juega(j1, e2, r2, "1.2000", 1)
    juega(j1, e3, r3, "9.0000", 3)
    juega(j2, e1, r1, "-3.0000", 0)
    juega(j2, e2, r2, "-1.0000", 3)

    c = cliente.get(f"/liga/publico/clasificacion?temporada={tid}").json()
    assert c["total"] == 2   # la oculta no sale
    assert [(f["posicion"], f["equipo"]["nombre"], f["puntos"]) for f in c["filas"]] == \
        [(1, "Sin autor visible", 4), (2, "Foso ancho", 3)]
    assert c["filas"][0]["equipo"]["autor"] is None          # perfil oculto
    assert c["filas"][1]["equipo"]["autor"] == f"marta_{sufijo}"
    assert c["filas"][1]["ganadas"] == 1 and c["filas"][1]["perdidas"] == 1

    # Con página de una fila, las de un autor que quedan fuera vienen aparte y con su posición.
    pagina = cliente.get(f"/liga/publico/clasificacion?temporada={tid}&cuantos=1"
                         f"&alias=marta_{sufijo}").json()
    assert [f["equipo"]["nombre"] for f in pagina["filas"]] == ["Sin autor visible"]
    assert [(f["posicion"], f["equipo"]["nombre"]) for f in pagina["mias"]] == [(2, "Foso ancho")]
    # Si ya salen en la página, no se repiten; y sin alias no hay «mias».
    assert cliente.get(f"/liga/publico/clasificacion?temporada={tid}&alias=marta_{sufijo}"
                       ).json()["mias"] == []
    assert cliente.get(f"/liga/publico/clasificacion?temporada={tid}&cuantos=1"
                       ).json()["mias"] == []

    d = cliente.get(f"/liga/publico/jornada/{j2}").json()
    assert [(f["equipo"]["nombre"], f["puntos"], f["dif_sp"]) for f in d["filas"]] == \
        [("Sin autor visible", 3, "1.0000"), ("Foso ancho", 0, "-1.0000")]
    assert cliente.get("/liga/publico/jornada/999999999").status_code == 404

    p = cliente.get("/liga/publico/portada").json()
    assert p["ultima_cerrada"]["jornada"]["id"] == j2
    assert all("posiciones" not in f for f in d["filas"])
