"""Rutas del blog contra la BD de pruebas, con JWT y RLS reales."""

import os
import re
import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app import correo
from app.config import settings
from app.i18n import translate
from app.liga import acceso, blog, rutas_blog

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
EMISOR = "https://proyecto.supabase.co"


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
    from app.liga import auth
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
    monkeypatch.setattr(rutas_blog, "_limite", acceso.LimiteFrecuencia(10, 900))

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
    app.include_router(rutas_blog.router)
    app.include_router(rutas_blog.router_admin)
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
        cx.execute("delete from blog.articulos where slug like %s", (prefijo + "%",))
        cx.execute("delete from blog.suscriptores where correo like %s", (prefijo + "%",))
        for uid in reversed(usuarios):
            cx.execute("delete from auth.users where id = %s", (uid,))
        cx.close()
        motor.dispose()


@pytest.fixture
def mensajes(monkeypatch):
    enviados = []
    monkeypatch.setattr(settings, "turnstile_secret_key", "secreto-de-prueba")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(200, json={"success": True}))

    def enviar(*a, **k):
        enviados.append((a, k))
        return True

    monkeypatch.setattr(correo, "enviar", enviar)
    return enviados


def _alta(api):
    c, _, _, _, prefijo = api
    return c.post("/blog/boletin", json={"correo": prefijo + "@prueba.local",
                                        "idioma": "es", "turnstile": "valido"})


def _tokens(mensajes):
    texto = mensajes[-1][0][2]
    urls = re.findall(r"https?://[^\s]+", texto)
    return {"baja" if "/baja?" in url else "alta": parse_qs(urlsplit(url).query)["token"][0]
            for url in urls if "token=" in url}


def test_sin_clave(api, mensajes, monkeypatch):
    monkeypatch.setattr(settings, "turnstile_secret_key", "")
    assert _alta(api).status_code == 503
    assert api[3].execute("select count(*) from blog.suscriptores where correo = %s",
                          (api[4] + "@prueba.local",)).fetchone()[0] == 0
    assert not mensajes


def test_sin_token(api, mensajes):
    respuesta = api[0].post("/blog/boletin", json={"correo": api[4] + "@prueba.local"})
    assert respuesta.status_code == 403
    assert api[3].execute("select count(*) from blog.suscriptores where correo = %s",
                          (api[4] + "@prueba.local",)).fetchone()[0] == 0
    assert not mensajes


def test_alta_confirmacion_repeticion_y_baja(api, mensajes):
    c, _, _, cx, prefijo = api
    assert _alta(api).status_code == 202
    assert len(mensajes) == 1
    tokens = _tokens(mensajes)
    fila = cx.execute("select estado, hash_alta, token_baja from blog.suscriptores "
                      "where correo = %s", (prefijo + "@prueba.local",)).fetchone()
    assert fila == ("pendiente", blog.hash_token(tokens["alta"]), tokens["baja"])
    assert prefijo + "@prueba.local" not in mensajes[0][0][2]
    assert tokens["alta"] in mensajes[0][0][3]
    assert c.post("/blog/boletin/confirmar", json={"token": tokens["alta"]}).json() == {"ok": True}
    assert c.post("/blog/boletin/confirmar", json={"token": "inventado"}).json() == {"ok": False}
    assert _alta(api).status_code == 202
    assert len(mensajes) == 1
    for _ in range(2):
        assert c.post("/blog/boletin/baja", json={"token": tokens["baja"]}).json() == {"ok": True}
    assert cx.execute("select estado from blog.suscriptores where correo = %s",
                      (prefijo + "@prueba.local",)).fetchone()[0] == "baja"


def _crear(api):
    c, cab, usuario, _, prefijo = api
    headers = cab(usuario(admin=True), "aal2")
    respuesta = c.post("/blog/admin/articulos", headers=headers, json={"slug": prefijo})
    assert respuesta.status_code == 201
    return headers, respuesta.json()["id"]


def _editar(c, headers, id):
    texto = {"titulo": "Título", "resumen": "Resumen", "cuerpo": "Contenido"}
    assert c.put(f"/blog/admin/articulos/{id}", headers=headers,
                 json={"es": texto, "en": texto}).status_code == 200


def test_articulos(api):
    c = api[0]
    headers, id = _crear(api)
    ruta = f"/blog/admin/articulos/{id}"
    texto = {"titulo": "Título", "resumen": "", "cuerpo": "Contenido"}
    assert c.put(ruta, headers=headers, json={"es": texto}).status_code == 200
    respuesta = c.post(ruta + "/publicar", headers=headers)
    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == translate("api_error_blog_faltan_textos")
    assert api[4] not in {a["slug"] for a in c.get("/blog/articulos").json()}
    _editar(c, headers, id)
    assert c.post(ruta + "/publicar", headers=headers).json()["estado"] == "publicado"
    assert api[4] in {a["slug"] for a in c.get("/blog/articulos").json()}
    assert c.get("/blog/articulos/" + api[4] + "?idioma=en").json()["cuerpo"] == "Contenido"
    assert c.post(ruta + "/despublicar", headers=headers).json()["estado"] == "borrador"
    assert c.get("/blog/articulos/" + api[4]).status_code == 404


def test_programar_pasado(api):
    c = api[0]
    headers, id = _crear(api)
    _editar(c, headers, id)
    pasado = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    respuesta = c.post(f"/blog/admin/articulos/{id}/programar", headers=headers,
                       json={"programado_para": pasado})
    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == translate("api_error_blog_fecha_pasada")


def test_envio_unico(api, mensajes):
    c = api[0]
    _alta(api)
    c.post("/blog/boletin/confirmar", json={"token": _tokens(mensajes)["alta"]})
    headers, id = _crear(api)
    _editar(c, headers, id)
    ruta = f"/blog/admin/articulos/{id}"
    assert c.post(ruta + "/publicar", headers=headers).status_code == 200
    respuesta = c.post(ruta + "/boletin", headers=headers, json={"idioma": "es"})
    assert respuesta.status_code == 200
    assert respuesta.json()["destinatarios"] >= 1
    assert api[3].execute("select count(*) from blog.entregas d join blog.envios e "
                          "on e.id = d.envio_id join blog.suscriptores s on s.id = d.suscriptor_id "
                          "where e.articulo_id = %s and s.correo = %s and d.estado = 'pendiente'",
                          (id, api[4] + "@prueba.local")).fetchone()[0] == 1
    respuesta = c.post(ruta + "/boletin", headers=headers, json={"idioma": "es"})
    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == translate("api_error_blog_boletin_ya_enviado")
    assert c.get("/blog/admin/boletin", headers=headers).status_code == 200
    suscriptores = c.get("/blog/admin/suscriptores", headers=headers).json()
    assert all("token_baja" not in s and "hash_alta" not in s for s in suscriptores)


def test_no_admin_y_admin_sin_aal2(api):
    c, cab, usuario, _, _ = api
    # La puerta compartida oculta las rutas administrativas a quien no tiene ese rol.
    assert c.get("/blog/admin/articulos", headers=cab(usuario())).status_code == 404
    assert c.get("/blog/admin/articulos", headers=cab(usuario(admin=True))).status_code == 403


def test_slug_repetido_y_limites(api):
    c = api[0]
    headers, id = _crear(api)
    respuesta = c.post("/blog/admin/articulos", headers=headers, json={"slug": api[4]})
    assert respuesta.status_code == 409
    assert respuesta.json()["detail"] == translate("api_error_blog_slug_repetido")
    segundo = c.post("/blog/admin/articulos", headers=headers,
                     json={"slug": api[4] + "-otro"}).json()["id"]
    assert c.put(f"/blog/admin/articulos/{segundo}", headers=headers,
                 json={"slug": api[4]}).status_code == 409
    assert c.put(f"/blog/admin/articulos/{id}", headers=headers, json={
        "es": {"titulo": "x" * 161, "resumen": "", "cuerpo": ""}}).status_code == 422
    assert c.post(f"/blog/admin/articulos/{id}/programar", headers=headers,
                  json={"programado_para": "2099-01-01T12:00:00"}).status_code == 422


def test_limite_ip(api, mensajes, monkeypatch):
    monkeypatch.setattr(rutas_blog, "_limite", acceso.LimiteFrecuencia(1, 900))
    assert _alta(api).status_code == 202
    assert _alta(api).status_code == 429
    assert len(mensajes) == 1


def test_correo_fallido_no_revela(api, mensajes, monkeypatch):
    monkeypatch.setattr(correo, "enviar", lambda *a, **k: False)
    assert _alta(api).status_code == 202


@pytest.mark.parametrize("repeticiones", [1, 2])
def test_publicar_con_boletin(api, repeticiones):
    c, _, _, cx, _ = api
    headers, id = _crear(api)
    _editar(c, headers, id)
    for _ in range(repeticiones):
        respuesta = c.post(f"/blog/admin/articulos/{id}/publicar", headers=headers,
                           json={"avisar_boletin": True})
        assert respuesta.status_code == 200
    assert cx.execute("select avisar_boletin from blog.articulos where id = %s",
                      (id,)).fetchone() == (True,)
    assert cx.execute("select idioma from blog.envios where articulo_id = %s order by idioma",
                      (id,)).fetchall() == [("en",), ("es",)]


def test_programar_con_boletin(api):
    c, _, _, cx, _ = api
    headers, id = _crear(api)
    _editar(c, headers, id)
    respuesta = c.post(f"/blog/admin/articulos/{id}/programar", headers=headers, json={
        "programado_para": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "avisar_boletin": True})
    assert respuesta.status_code == 200
    assert cx.execute("select estado, avisar_boletin from blog.articulos where id = %s",
                      (id,)).fetchone() == ("programado", True)
    assert cx.execute("select count(*) from blog.envios where articulo_id = %s",
                      (id,)).fetchone() == (0,)


def test_correo_prueba(api, mensajes):
    c, cab, usuario, _, prefijo = api
    headers, id = _crear(api)
    _editar(c, headers, id)
    assert c.post(f"/blog/admin/articulos/{id}/publicar", headers=headers).status_code == 200
    destino = prefijo + "@prueba.local"
    headers = cab(usuario(admin=True), "aal2", email=destino)
    respuesta = c.post("/blog/admin/boletin/prueba", headers=headers)
    assert respuesta.status_code == 200
    assert respuesta.json() == {"ok": True}
    assert len(mensajes) == 1
    args = mensajes[0][0]
    assert args[0] == destino
    assert args[1] == "Título"
    assert "Resumen" in args[2]
    assert "/blog/" + prefijo in args[2]
    assert "token=" not in args[2] + args[3]


def test_correo_prueba_sin_articulo(api, mensajes, monkeypatch):
    c, cab, usuario, _, _ = api
    monkeypatch.setattr(blog, "correo_prueba", lambda db, correo_admin: None)
    headers = cab(usuario(admin=True), "aal2", email="admin@prueba.local")
    respuesta = c.post("/blog/admin/boletin/prueba", headers=headers)
    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == translate("api_error_blog_sin_articulo_para_prueba")
    assert not mensajes


def test_resumen_maximo_160(api):
    c = api[0]
    headers, id = _crear(api)
    for longitud, estado in [(160, 200), (161, 422)]:
        respuesta = c.put(f"/blog/admin/articulos/{id}", headers=headers, json={
            "es": {"titulo": "Título", "resumen": "x" * longitud, "cuerpo": "Contenido"}})
        assert respuesta.status_code == estado


def test_correo_prueba_sin_correo_admin(api, mensajes):
    headers, _ = _crear(api)
    respuesta = api[0].post("/blog/admin/boletin/prueba", headers=headers)
    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == translate("api_error_blog_sin_correo_admin")
    assert not mensajes


def test_correo_prueba_limite_compartido(api, mensajes, monkeypatch):
    monkeypatch.setattr(rutas_blog, "_limite", acceso.LimiteFrecuencia(1, 900))
    assert _alta(api).status_code == 202
    headers, _ = _crear(api)
    assert api[0].post("/blog/admin/boletin/prueba", headers=headers).status_code == 429
    assert len(mensajes) == 1
