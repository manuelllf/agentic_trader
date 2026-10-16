from __future__ import annotations

import json
import logging
import os
import uuid
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import avisos_admin, push
from app.config import settings
from app.models import PushSubscription


class Db:
    def __init__(self, subs=()):
        self.subs = list(subs)
        self.borradas = []

    def scalars(self, _sql):
        return SimpleNamespace(all=lambda: self.subs)

    def execute(self, sql, params=None):
        if str(sql).startswith("delete"):
            self.borradas.append(params["i"])
        return SimpleNamespace(all=lambda: self.subs)

    def delete(self, sub):
        self.borradas.append(sub.id)

    def commit(self):
        pass

    def close(self):
        pass


def sub(n):
    return SimpleNamespace(id=n, endpoint=f"https://fcm.googleapis.com/test/{n}",
                           p256dh="p", auth="a")


@pytest.mark.parametrize("segundo", ["error", "baja"])
def test_resumen_y_warning(monkeypatch, caplog, segundo):
    monkeypatch.setattr(settings, "vapid_private_key", "prueba")
    monkeypatch.setattr(push, "enviar", lambda endpoint, *_: "ok" if endpoint == sub(1).endpoint
                        else segundo)
    db = Db([sub(1), sub(2)])
    with caplog.at_level(logging.WARNING):
        resultado = push.enviar_a_todos(db, "t", "b")
    assert resultado["total"] == 2
    assert resultado["ok"] == 1
    assert resultado[segundo] == 1
    assert sub(2).endpoint not in str(resultado)
    assert sub(2).endpoint not in caplog.text
    if segundo == "error":
        assert "codigo=error" in caplog.text
    else:
        assert db.borradas == [2]


def test_sin_vapid(monkeypatch, caplog):
    monkeypatch.setattr(settings, "vapid_private_key", "")
    with caplog.at_level(logging.WARNING):
        assert push.enviar_a_todos(None, "t", "b") == dict(total=0, ok=0, baja=0, error=0)
    assert "VAPID" in caplog.text


@pytest.fixture
def postgres():
    url = os.environ.get("LIGA_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
    pytest.importorskip("psycopg")
    motor = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
    with motor.connect() as cx:
        transaccion = cx.begin()
        PushSubscription.__table__.create(cx, checkfirst=True)
        with Session(bind=cx, join_transaction_mode="create_savepoint") as db:
            yield db
        transaccion.rollback()
    motor.dispose()


def test_auditoria_y_dedupe(postgres, monkeypatch):
    db = postgres
    db.execute(text("insert into liga.ajustes (clave, valor) "
                    "values ('liga.registro.abierto', 'true') "
                    "on conflict (clave) do update set valor = excluded.valor"))
    def _usuario(db) -> uuid.UUID:
        db.execute(text("reset role"))
        db.execute(text("select set_config('request.jwt.claims', '', true)"))
        uid = uuid.uuid4()
        db.execute(text("insert into auth.users (id, email, email_confirmed_at) "
                        "values (cast(:u as uuid), :e, now())"),
                   {"u": str(uid), "e": f"{uid.hex[:12]}@prueba.local"})
        return uid

    uid = str(_usuario(db))
    endpoint = f"https://fcm.googleapis.com/test/{uid}"
    db.execute(text("insert into liga.roles_usuario (usuario_id, rol) "
                    "values (cast(:u as uuid), 'admin')"), {"u": uid})
    db.execute(text("delete from push_subscriptions"))
    db.execute(text("delete from liga.suscripciones_push"))
    db.add(PushSubscription(endpoint=endpoint, p256dh="p", auth="a"))
    db.execute(text("insert into liga.suscripciones_push (usuario_id, endpoint, p256dh, auth) "
                    "values (cast(:u as uuid), :e, 'p', 'a')"), {"u": uid, "e": endpoint})
    db.flush()
    monkeypatch.setattr(settings, "vapid_private_key", "prueba")
    llamadas = []
    monkeypatch.setattr(push, "enviar", lambda e, *_: llamadas.append(e) or "ok")
    antes = db.execute(text("select count(*) from liga.auditoria where accion='aviso.push'")).scalar()
    resumen = {}
    assert avisos_admin.avisar(db, "omega_prueba", title="t", body="b", url="/x", tag="x",
                               resumen=resumen) == 1
    assert llamadas == [endpoint]
    filas = db.execute(text("select detalle from liga.auditoria where accion='aviso.push' "
                            "and objeto='tipo:omega_prueba' order by id desc")).all()
    despues = db.execute(text("select count(*) from liga.auditoria where accion='aviso.push'")).scalar()
    assert despues == antes + 1
    assert filas[0].detalle == {**resumen, "liga_ok": 0, "liga_error": 0}
    assert endpoint not in json.dumps(filas[0].detalle)


def test_prueba_cuenta(monkeypatch):
    from app.liga import rutas_avisos
    from app.liga.auth import Identidad, require_usuario
    from app.liga.procesos import comun

    db = Db([sub(1), sub(2), sub(3)])
    monkeypatch.setattr(comun, "fabrica_sistema", lambda: db)
    resultados = iter(["ok", "baja", "error"])
    monkeypatch.setattr(push, "enviar", lambda *_: next(resultados))
    app = FastAPI()
    app.include_router(rutas_avisos.router, prefix="/liga")
    app.dependency_overrides[require_usuario] = lambda: Identidad(uid=str(uuid.uuid4()),
                                                                 aal="aal1", claims={})
    respuesta = TestClient(app).post("/liga/avisos/probar")
    assert respuesta.status_code == 200
    assert respuesta.json() == dict(dispositivos=3, ok=1, baja=1, error=1)
    assert db.borradas == [2]
    assert "endpoint" not in respuesta.text


def test_prueba_admin(monkeypatch, token_admin):
    from app.auth import require_auth
    from app.db import get_db
    from app.momentum.routes import router

    resumen = dict(dispositivos=3, ok=1, baja=1, error=1)

    def falso(*args, **kwargs):
        kwargs["resumen"].update(resumen)
        return 1

    monkeypatch.setattr(avisos_admin, "avisar", falso)
    app = FastAPI()
    app.include_router(router, dependencies=[Depends(require_auth)])
    app.dependency_overrides[get_db] = lambda: None
    cliente = TestClient(app)
    ruta = "/momentum/admin/probar-aviso"
    assert cliente.post(ruta).status_code in (401, 403)
    respuesta = cliente.post(ruta, headers={"Authorization": f"Bearer {token_admin}"})
    assert respuesta.status_code == 200
    assert respuesta.json() == resumen
    assert "endpoint" not in respuesta.text
