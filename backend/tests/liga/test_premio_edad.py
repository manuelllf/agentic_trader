"""Confirmación de edad y elegibilidad del premio anual."""
import os
import time
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.liga.procesos import premio

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
EMISOR = "https://proyecto.supabase.co"


class _Resultado:
    def __init__(self, filas):
        self.filas = filas

    def scalar(self):
        return self.filas[0]

    scalar_one = scalar

    def all(self):
        return self.filas


class _Db:
    def __init__(self, confirmada):
        self.confirmada = confirmada

    def execute(self, sql, params=None):
        q = str(sql)
        if "liga.ajustes" in q:
            return _Resultado([True if params["c"] == premio.AJUSTE_VISIBLE else None])
        if "from liga.temporadas" in q:
            return _Resultado([SimpleNamespace(id=1, nombre="Temporada", estado="abierta")])
        assert "join liga.perfiles_privados pp on pp.id = e.dueno_id" in q
        assert "pp.mayor_edad_confirmada_en is not null" in q
        if "count(distinct" in q:
            assert "e.opta_premio" in q
            return _Resultado([int(self.confirmada)])
        assert "i.optaba_premio" in q
        return _Resultado([SimpleNamespace(cuenta="cuenta", numero=n, rentabilidad=Decimal(1))
                           for n in range(1, 11)] if self.confirmada else [])

    def get(self, modelo, clave):
        return None

    def close(self):
        pass


@pytest.mark.parametrize("confirmada", [False, True])
def test_cuenta_solo_con_edad_confirmada(confirmada):
    db = _Db(confirmada)
    assert len(premio.cuentas_elegibles(db, 1, 12)) == int(confirmada)
    assert premio.estado_publico(lambda: db)["cuentas"] == int(confirmada)


@pytest.fixture
def api(monkeypatch):
    psycopg = pytest.importorskip("psycopg")
    import jwt
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import auth, rutas
    from app.liga import db as liga_db

    clave = ec.generate_private_key(ec.SECP256R1())

    class _JWKS:
        def get_signing_key_from_jwt(self, _token):
            return type("Clave", (), {"key": clave.public_key()})()

    monkeypatch.setattr(auth.settings, "supabase_url", EMISOR)
    monkeypatch.setattr(auth, "_cliente_jwks", lambda: _JWKS())
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)

    def cab(uid, aal="aal1", email=None):
        ahora = int(time.time())
        claims = {"sub": uid, "aud": "authenticated", "role": "authenticated",
                  "iss": EMISOR + "/auth/v1", "exp": ahora + 3600, "iat": ahora, "aal": aal}
        if email is not None:
            claims["email"] = email
        return {"Authorization": "Bearer " + jwt.encode(claims, clave, algorithm="ES256")}

    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.main import translated_http_error

    app = FastAPI()
    app.include_router(rutas.router)
    app.add_exception_handler(StarletteHTTPException, translated_http_error)
    cx = psycopg.connect(URL, autocommit=True)
    usuarios = []
    prefijo = "blog-test-" + uuid.uuid4().hex

    def usuario(admin=False):
        uid = uuid.uuid4()
        cx.execute("insert into auth.users (id, email, email_confirmed_at) values (%s,%s,now())",
                   (uid, f"{uid.hex}@prueba.local"))
        usuarios.append(uid)
        if admin:
            cx.execute("insert into liga.roles_usuario (usuario_id, rol) values (%s,'admin')",
                       (uid,))
        return str(uid)

    try:
        with TestClient(app) as cliente:
            yield cliente, cab, usuario, cx, prefijo
    finally:
        for uid in reversed(usuarios):
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()



@pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
def test_confirmar_y_retirar_edad(api):
    cliente, cab, usuario, cx, _ = api
    uid = usuario()
    def fecha():
        sql = "select mayor_edad_confirmada_en from liga.perfiles_privados where id = %s"
        return cx.execute(sql, (uid,)).fetchone()[0]
    assert fecha() is None
    for valor in (True, True, False):
        anterior = fecha()
        respuesta = cliente.put("/liga/yo/mayor-edad", headers=cab(uid), json={"confirmada": valor})
        assert respuesta.status_code == 200
        assert respuesta.json() == {"confirmada": valor}
        assert (fecha() is not None) == valor
        if valor and anterior is not None:
            assert fecha() == anterior
