"""Entrar con el nombre de usuario: el correo no sale, un alias inexistente no se distingue de una
contraseña mala y los fallos tienen tope. Supabase se simula; la búsqueda del correo se prueba
contra el Postgres de la liga (se salta sin `LIGA_TEST_DATABASE_URL`)."""

from __future__ import annotations

import os
import uuid

import httpx
import pytest
from fastapi import HTTPException

from app.liga import acceso

SESION = {"access_token": "a.b.c", "refresh_token": "r1", "user": {"email": "yo@correo.es"}}


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.setattr(acceso, "limite", acceso.LimiteFallos(por_ip=5, global_=50, ventana_s=900))
    pedidos: list[str] = []

    def pedir(email: str, clave: str):  # noqa: ANN202
        pedidos.append(email)
        return SESION if (email, clave) == ("yo@correo.es", "buena") else None

    monkeypatch.setattr(acceso, "_pedir_sesion", pedir)
    monkeypatch.setattr(acceso, "_email_de", lambda a: "yo@correo.es" if a == "admin" else None)
    return pedidos


def _codigo(usuario: str, clave: str, ip: str = "1.1.1.1") -> tuple[int, str]:
    with pytest.raises(HTTPException) as e:
        acceso.entrar_con_alias(usuario, clave, ip)
    return e.value.status_code, e.value.detail


def test_con_alias_y_clave_buenos_da_la_sesion_y_nunca_el_correo() -> None:
    fuera = acceso.entrar_con_alias("  Admin ", "buena", "1.1.1.1")
    assert fuera == {"access_token": "a.b.c", "refresh_token": "r1"}


def test_alias_que_no_existe_y_clave_mala_son_indistinguibles(_limpio) -> None:  # noqa: ANN001
    malo_clave = _codigo("admin", "mala")
    malo_alias = _codigo("nadie", "buena")
    malo_formato = _codigo("con espacios", "buena")
    assert malo_clave == malo_alias == malo_formato == (401, acceso._MAL)
    # También se pregunta a Supabase cuando el alias no existe (mismo tiempo de respuesta).
    assert len(_limpio) == 3 and _limpio[1].endswith("@no-existe.invalid")


def test_cinco_fallos_bloquean_la_ip_y_un_acierto_la_limpia() -> None:
    for _ in range(4):
        _codigo("admin", "mala", ip="9.9.9.9")
    acceso.entrar_con_alias("admin", "buena", "9.9.9.9")
    for _ in range(5):
        _codigo("admin", "mala", ip="9.9.9.9")
    assert _codigo("admin", "buena", ip="9.9.9.9")[0] == 429
    assert acceso.entrar_con_alias("admin", "buena", "8.8.8.8")["refresh_token"] == "r1"


class _Resp:
    def __init__(self, codigo: int, cuerpo: dict | None = None) -> None:
        self.status_code, self._cuerpo = codigo, cuerpo or {}

    def json(self) -> dict:
        return self._cuerpo


def test_la_peticion_a_supabase(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.undo()  # quita la simulación del fixture para probar la función de verdad
    pedir = acceso._pedir_sesion
    monkeypatch.setattr(acceso.settings, "supabase_url", "https://proyecto.supabase.co")
    monkeypatch.setattr(acceso.settings, "supabase_publishable_key", "sb_publishable_x")
    visto = {}

    def post(url, headers, json, timeout):  # noqa: ANN001, ANN202
        visto.update(url=url, headers=headers, json=json)
        return respuesta

    monkeypatch.setattr(acceso.httpx, "post", post)
    respuesta = _Resp(200, SESION)
    assert pedir("yo@correo.es", "buena") == SESION
    assert visto["url"].endswith("/auth/v1/token?grant_type=password")
    assert visto["headers"] == {"apikey": "sb_publishable_x"}
    respuesta = _Resp(400)
    assert pedir("yo@correo.es", "mala") is None
    for codigo, esperado in ((500, 503), (429, 429)):
        respuesta = _Resp(codigo)
        with pytest.raises(HTTPException) as e:
            pedir("yo@correo.es", "buena")
        assert e.value.status_code == esperado

    def caida(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(acceso.httpx, "post", caida)
    with pytest.raises(HTTPException) as e:
        pedir("yo@correo.es", "buena")
    assert e.value.status_code == 503
    monkeypatch.setattr(acceso.settings, "supabase_publishable_key", "")
    with pytest.raises(HTTPException) as e:
        pedir("yo@correo.es", "buena")
    assert e.value.status_code == 503


URL = os.environ.get("LIGA_TEST_DATABASE_URL")


@pytest.mark.skipif(not URL, reason="Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")
def test_el_alias_se_resuelve_a_su_correo(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.undo()
    psycopg = pytest.importorskip("psycopg")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    monkeypatch.setattr(acceso, "SessionLocal", sessionmaker(bind=motor))
    uid = uuid.uuid4()
    email = f"{uid.hex[:12]}@prueba.local"
    alias = f"prueba_{uid.hex[:8]}"
    with psycopg.connect(URL, autocommit=True) as cx:
        cx.execute("insert into auth.users (id, email, email_confirmed_at) "
                   "values (%s, %s, now())", (uid, email))
        try:
            cx.execute("update liga.perfiles set alias = %s where id = %s", (alias, uid))
            assert acceso._email_de(alias) == email
            assert acceso._email_de("no_existe_nunca") is None
        finally:
            cx.execute("delete from auth.users where id = %s", (uid,))
    motor.dispose()


def _peticion(cabecera: str | None, directa: str = "10.0.0.1"):
    from starlette.requests import Request

    cabeceras = [(b"x-forwarded-for", cabecera.encode())] if cabecera is not None else []
    return Request({"type": "http", "headers": cabeceras, "client": (directa, 1234)})


def test_la_ip_la_pone_el_proxy_de_confianza_no_el_cliente(monkeypatch) -> None:
    monkeypatch.setattr(acceso.settings, "proxies_confiables", 1)
    assert acceso.ip_cliente(_peticion("1.1.1.1, 2.2.2.2, 9.9.9.9")) == "9.9.9.9"
    assert acceso.ip_cliente(_peticion("9.9.9.9")) == "9.9.9.9"
    assert acceso.ip_cliente(_peticion(None)) == "10.0.0.1"
    monkeypatch.setattr(acceso.settings, "proxies_confiables", 2)
    assert acceso.ip_cliente(_peticion("1.1.1.1, 8.8.8.8, 9.9.9.9")) == "8.8.8.8"
    assert acceso.ip_cliente(_peticion("9.9.9.9")) == "9.9.9.9"
