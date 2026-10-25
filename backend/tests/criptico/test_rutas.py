"""Contrato público contra Postgres, con permisos anónimos reales."""

import os
import re
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from app import correo
from app.criptico import logica, rutas
from app.liga import acceso, blog

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
DETALLE = {"respuesta": "ACCION", "palabra": "acción", "resolucion": "Resolución",
           "concepto": "Concepto", "ejemplo": "Ejemplo", "regla_catalogo": None}


@pytest.fixture
def api(monkeypatch):
    psycopg = pytest.importorskip("psycopg")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.db as app_db
    from app.liga import db as liga_db

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1),
                          connect_args={"connect_timeout": 5,
                                        "options": "-c statement_timeout=10000"})
    fabrica = sessionmaker(bind=motor)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica)
    monkeypatch.setattr(rutas, "_limite", acceso.LimiteFrecuencia(10, 900))
    mensajes = []
    monkeypatch.setattr(correo, "enviar", lambda *args: mensajes.append(args) or True)
    app = FastAPI()
    app.include_router(rutas.router)
    cx = psycopg.connect(URL, autocommit=True, connect_timeout=5,
                         options="-c statement_timeout=10000")
    ids = []
    prefijo = "criptico-test-" + uuid.uuid4().hex

    def crear(dia, estado="publicado"):
        numero = cx.execute("select coalesce(max(numero), 0) + 1 "
                            "from criptico.acertijos where idioma = 'es'").fetchone()[0]
        id = cx.execute("""
            insert into criptico.acertijos
            (idioma, numero, dia, pista, longitud, respuesta, palabra, nivel, ayudas,
             resolucion, concepto, ejemplo, estado)
            values ('es', %s, %s, '[{"texto":"Pista","papel":"def"}]', 6, 'ACCION',
                    'acción', 'facil', '{"def":"Def","ind":"Ind","mat":"Mat"}',
                    'Resolución', 'Concepto', 'Ejemplo', %s) returning id
        """, (numero, dia, estado)).fetchone()[0]
        ids.append(id)
        return id, numero

    try:
        hoy = logica.hoy_madrid()
        actual = crear(hoy)
        anterior = crear(hoy - timedelta(days=1))
        futuro = crear(hoy + timedelta(days=1))
        borrador = crear(hoy - timedelta(days=2), "borrador")
        with TestClient(app) as cliente:
            yield cliente, cx, actual, anterior, futuro, borrador, prefijo, mensajes
    finally:
        cx.execute("delete from criptico.acertijos where id = any(%s)", (ids,))
        cx.execute("delete from criptico.suscriptores where correo like %s", (prefijo + "%",))
        cx.close()
        motor.dispose()


def test_lecturas_y_comprobar(api):
    c, _, (id, numero), (_, pasado), *_ = api
    hoy = c.get("/criptico/hoy").json()
    acertijo = hoy["acertijo"]
    assert set(hoy) == {"acertijo"}
    assert set(acertijo) == {"id", "idioma", "numero", "fecha", "nivel", "pista",
                             "longitud", "ayudas", "media", "n_media"}
    assert acertijo["id"] == id
    assert acertijo["fecha"] == logica.hoy_madrid().isoformat()
    assert acertijo["ayudas"] == {"def": "Def", "ind": "Ind", "mat": "Mat"}
    assert acertijo["media"] is None and acertijo["n_media"] is None
    assert c.get(f"/criptico/numero/{numero}").json() == hoy
    assert c.get(f"/criptico/numero/{pasado}").json()["detalle"] == DETALLE
    for letras in ("MAL", "ACCIONES", "ACCIOS", ""):
        r = c.post(f"/criptico/{id}/comprobar", json={"letras": letras})
        assert r.status_code == 200
        assert r.json() == {"correcta": False, "detalle": None}
    r = c.post(f"/criptico/{id}/comprobar", json={"letras": " áccíon "})
    assert r.status_code == 200
    assert r.json() == {"correcta": True, "detalle": DETALLE}
    assert c.post(f"/criptico/{id}/letra", json={}).json() == {"letra": "A"}


def test_indice(api):
    c, cx, (id, numero), (_, pasado), futuro, borrador, *_ = api
    hoy = logica.hoy_madrid()
    numeros = {numero, pasado, futuro[1], borrador[1]}
    r = c.get("/criptico/indice", params={"idioma": "es"})
    assert r.status_code == 200
    filas = r.json()
    assert [fila["numero"] for fila in filas] == sorted(fila["numero"] for fila in filas)
    assert [fila for fila in filas if fila["numero"] in numeros] == [
        {"numero": numero, "fecha": hoy.isoformat()},
        {"numero": pasado, "fecha": (hoy - timedelta(days=1)).isoformat()},
    ]
    cx.execute("update criptico.acertijos set estado = 'borrador' where id = %s", (id,))
    r = c.get("/criptico/indice", params={"idioma": "es"})
    assert r.status_code == 200
    assert numero not in {fila["numero"] for fila in r.json()}
    r = c.get("/criptico/indice", params={"idioma": "en"})
    assert r.status_code == 200 and r.json() == []
    assert c.get("/criptico/indice", params={"idioma": "fr"}).status_code == 422


def test_no_publicados(api):
    c, _, _, _, futuro, borrador, *_ = api
    for ruta in ("/criptico/hoy?idioma=en", "/criptico/numero/2147483647",
                 f"/criptico/numero/{futuro[1]}", f"/criptico/numero/{borrador[1]}"):
        r = c.get(ruta)
        assert r.status_code == 404
        assert r.json() == {"detail": "criptico_sin_publicar"}
    for id in (futuro[0], borrador[0], 9223372036854775807):
        for accion, body in (("letra", {}), ("comprobar", {"letras": "ACCION"}),
                             ("resuelto", {"ayudas_usadas": 0}),
                             ("solucion", {"ayudas_usadas": 0})):
            r = c.post(f"/criptico/{id}/{accion}", json=body)
            assert r.status_code == 404
            assert r.json() == {"detail": "criptico_no_encontrado"}


def test_resultados_y_validacion(api):
    c, cx, (id, _), *_ = api
    r = c.post(f"/criptico/{id}/resuelto", json={"ayudas_usadas": 1})
    assert r.status_code == 204 and r.content == b""
    r = c.post(f"/criptico/{id}/solucion", json={"ayudas_usadas": 3})
    assert r.status_code == 200 and r.json() == {"detalle": DETALLE}
    # Con las cuatro ayudas (la última es la letra) se puede resolver y ver la solución.
    r = c.post(f"/criptico/{id}/resuelto", json={"ayudas_usadas": 4})
    assert r.status_code == 204
    r = c.post(f"/criptico/{id}/solucion", json={"ayudas_usadas": 4})
    assert r.status_code == 200 and r.json() == {"detalle": DETALLE}
    for accion in ("resuelto", "solucion"):
        for ayudas in (-1, 5, True, 1.5, "2", None):
            r = c.post(f"/criptico/{id}/{accion}", json={"ayudas_usadas": ayudas})
            assert r.status_code == 422
            assert r.json() == {"detail": "criptico_ayudas_invalidas"}
    r = c.post(f"/criptico/{id}/comprobar", json={"letras": 123})
    assert r.status_code == 422
    assert r.json() == {"detail": "criptico_letras_invalidas"}
    assert cx.execute("select ayudas_usadas, solucion_vista from criptico.resultados "
                      "where acertijo_id = %s order by id", (id,)).fetchall() == [
                          (1, False), (3, True), (4, False), (4, True)]


def test_anon_no_lee_respuesta(api):
    psycopg = pytest.importorskip("psycopg")
    with psycopg.connect(URL, connect_timeout=5) as cx:
        cx.execute("set local role anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match="permission denied"):
            cx.execute("select respuesta from criptico.acertijos where id = %s", (api[2][0],))


def test_suscripcion_confirmacion_baja(api):
    c, cx, *_, prefijo, mensajes = api
    body = {"email": prefijo + "@prueba.local", "idioma": "es"}
    r = c.post("/criptico/suscripcion", json=body)
    assert r.status_code == 202 and r.json() == {"ok": True}
    urls = re.findall(r"https?://[^\s]+", mensajes[-1][2])
    tokens = {"baja" if "/baja?" in url else "alta": parse_qs(urlsplit(url).query)["token"][0]
              for url in urls if "token=" in url}
    # Los enlaces del correo llevan a las páginas de la web, no a la API.
    assert {urlsplit(url).path for url in urls if "token=" in url} == {
        "/criptico/confirmar", "/criptico/baja"}
    fila = cx.execute("select hash_alta, token_baja, alta_expira > now(), estado "
                      "from criptico.suscriptores where correo = %s", (body["email"],)).fetchone()
    assert fila == (blog.hash_token(tokens["alta"]), tokens["baja"], True, "pendiente")
    assert c.get("/criptico/suscripcion/confirmar", params={"token": tokens["alta"]}).json() == {
        "ok": True}
    assert c.get("/criptico/suscripcion/confirmar", params={"token": "inventado"}).json() == {
        "ok": False}
    repetida = c.post("/criptico/suscripcion", json=body)
    assert (repetida.status_code, repetida.json()) == (r.status_code, r.json())
    assert len(mensajes) == 1
    for _ in range(2):
        assert c.get("/criptico/suscripcion/baja", params={"token": tokens["baja"]}).json() == {
            "ok": True}
    c.post("/criptico/suscripcion", json={"email": prefijo + "-en@prueba.local", "idioma": "en"})
    urls = re.findall(r"https?://[^\s]+", mensajes[-1][2])
    assert {urlsplit(url).path for url in urls if "token=" in url} == {
        "/en/criptico/confirmar", "/en/criptico/baja"}


def test_limite_y_correo_fallido(api, monkeypatch):
    c, cx, *_, prefijo, mensajes = api
    monkeypatch.setattr(rutas, "_limite", acceso.LimiteFrecuencia(1, 900))
    monkeypatch.setattr(correo, "enviar", lambda *args: False)
    for email in (prefijo + "@prueba.local", prefijo + "-otro@prueba.local"):
        r = c.post("/criptico/suscripcion", json={"email": email, "idioma": "en"})
        assert r.status_code == 202 and r.json() == {"ok": True}
    assert cx.execute("select count(*) from criptico.suscriptores where correo like %s",
                      (prefijo + "%",)).fetchone() == (1,)
    assert not mensajes
