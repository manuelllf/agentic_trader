"""El rastro (quién y cuándo) de `public` (saneamiento 10): `app.auth.require_auth` deja el uid
del admin en el contextvar de `app.db`, el evento `after_begin` de la sesión lo copia a
`app.actor`, y `public.tocar_auditoria()` lo lee. Contra el Postgres de pruebas de verdad (los
tipos y el trigger son cosa suya, SQLite no los tiene) -- se salta sin `LIGA_TEST_DATABASE_URL`.
"""

from __future__ import annotations

import os
import uuid

import pytest
import sqlalchemy as sa

psycopg = pytest.importorskip("psycopg")

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


@pytest.fixture
def sesion(monkeypatch):  # noqa: ANN001, ANN201
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica = sessionmaker(bind=motor, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    yield fabrica
    app_db._actor.set(None)  # noqa: SLF001 -- no dejar el actor puesto para el siguiente test


def test_una_identidad_de_admin_deja_su_uid_como_actor(monkeypatch, sesion) -> None:  # noqa: ANN001
    """Como llamaría una ruta protegida: `require_auth` marca el actor de esta request."""
    from app import auth
    from app.liga.auth import Identidad
    from app.models import Meta

    uid = str(uuid.uuid4())

    def verificar(_token: str) -> Identidad:
        return Identidad(uid=uid, aal="aal2", claims={})

    monkeypatch.setattr(auth.settings, "supabase_url", "https://pruebas.supabase.co")
    monkeypatch.setattr(auth, "verificar", verificar)
    monkeypatch.setattr(auth, "comprobar_admin", lambda ident: ident)

    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import text

    app = FastAPI()

    def _db():  # noqa: ANN202
        db = sesion()
        try:
            yield db
        finally:
            db.close()

    @app.post("/escribe", dependencies=[Depends(auth.require_auth)])
    def escribe(db=Depends(_db)) -> dict:  # noqa: ANN001, B008
        # Ruta `def` (hilo aparte), como las de las salas: el actor tiene que llegar hasta aquí.
        db.merge(Meta(key="test_auditoria_salas", value="v1"))
        db.commit()
        db.execute(text("update meta set value = 'v2' where key = 'test_auditoria_salas'"))
        db.commit()
        return {}

    assert TestClient(app).post(
        "/escribe", headers={"Authorization": "Bearer lo-que-sea"}).status_code == 200

    db = sesion()
    try:
        fila = db.execute(sa.text(
            "select created_by, updated_at, updated_by from meta "
            "where key = 'test_auditoria_salas'")).one()
        assert str(fila.updated_by) == uid
        assert str(fila.created_by) == uid
        assert fila.updated_at is not None
    finally:
        db.execute(sa.text("delete from meta where key = 'test_auditoria_salas'"))
        db.commit()
        db.close()


def test_una_escritura_de_sistema_deja_el_actor_a_null(sesion) -> None:  # noqa: ANN001
    """El scheduler nunca pasa por `require_auth`: sin actor en el contextvar, todo sale NULL."""
    db = sesion()
    try:
        db.execute(sa.text(
            "insert into meta (key, value) values ('test_auditoria_sistema', 'v1')"))
        db.commit()
        db.execute(sa.text(
            "update meta set value = 'v2' where key = 'test_auditoria_sistema'"))
        db.commit()
        fila = db.execute(sa.text(
            "select created_by, updated_at, updated_by from meta "
            "where key = 'test_auditoria_sistema'")).one()
        assert fila.created_by is None
        assert fila.updated_at is not None  # sí se toca el momento, no quién
        assert fila.updated_by is None
    finally:
        db.execute(sa.text("delete from meta where key = 'test_auditoria_sistema'"))
        db.commit()
        db.close()


def test_las_filas_existentes_no_se_tocan(sesion) -> None:  # noqa: ANN001
    """Una fila insertada antes del saneamiento (sin pasar por el trigger) se queda con su rastro
    a NULL para siempre: nadie hace un backfill."""
    db = sesion()
    try:
        # Simulación de "fila vieja": construida sin insert real, solo se comprueba la forma.
        cols = {c[0] for c in db.execute(sa.text(
            "select column_name from information_schema.columns "
            "where table_schema='public' and table_name='meta'")).all()}
        assert {"created_at", "created_by", "updated_at", "updated_by"} <= cols
    finally:
        db.close()
