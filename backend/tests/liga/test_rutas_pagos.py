"""Ruta del webhook de Lemon: firma, formato y reparto a la capa de pagos. La capa de base de datos
se sustituye aquí; se prueba aparte contra el Postgres de pruebas."""

import hashlib
import hmac
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.liga import acceso, pagos, rutas_pagos
from app.liga.rutas_pagos import router

SECRETO = "130221-de-prueba"
USUARIO = "6f2c1e1a-0000-4000-8000-000000000001"
_ACEPTO_VERSION_VIGENTE = pagos.acepto_version_vigente


@pytest.fixture
def cliente(monkeypatch):  # noqa: ANN001, ANN201
    monkeypatch.setattr(settings, "lemon_webhook_secret", SECRETO)
    monkeypatch.setattr(settings, "lemon_modo", "test")
    monkeypatch.setattr(settings, "lemon_variantes", {"111": "mensual"})
    llamadas = []

    def registrar(cuerpo, accion, evento):  # noqa: ANN001, ANN202
        llamadas.append((accion, evento))
        return "aplicado"

    monkeypatch.setattr(pagos, "registrar", registrar)
    app = FastAPI()
    app.include_router(router)
    cli = TestClient(app)
    cli.llamadas = llamadas  # type: ignore[attr-defined]
    return cli


def _cuerpo(evento: str = "subscription_created", test: bool = True) -> bytes:
    return json.dumps({
        "meta": {"event_name": evento, "test_mode": test,
                 "custom_data": {"user_id": USUARIO}},
        "data": {"id": "98765", "type": "subscriptions", "attributes": {
            "variant_id": 111, "status": "active",
            "renews_at": "2027-01-10T00:00:00.000000Z",
            "updated_at": "2026-10-10T10:00:00.000000Z"}},
    }).encode()


def _firma(cuerpo: bytes, secreto: str = SECRETO) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


def test_firma_buena_aplica_y_responde_estado(cliente):  # noqa: ANN001
    cuerpo = _cuerpo()
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 200
    assert r.json() == {"estado": "aplicado"}
    accion, evento = cliente.llamadas[0]
    assert accion.tipo == "pro" and accion.producto == "mensual"
    assert evento == "subscription_created"


def test_firma_mala_responde_401_y_no_aplica(cliente):  # noqa: ANN001
    cuerpo = _cuerpo()
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo, "otro")})
    assert r.status_code == 401
    assert cliente.llamadas == []


def test_sin_firma_responde_401(cliente):  # noqa: ANN001
    r = cliente.post("/liga/pagos/lemon/webhook", content=_cuerpo())
    assert r.status_code == 401


def test_cuerpo_no_json_responde_400(cliente):  # noqa: ANN001
    cuerpo = b"no es json"
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 400


def test_evento_de_test_con_modo_live_no_aplica_pro(cliente, monkeypatch):  # noqa: ANN001
    monkeypatch.setattr(settings, "lemon_modo", "live")
    cuerpo = _cuerpo(test=True)
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 200
    assert cliente.llamadas[0][0].tipo == "ignorar"


def test_cuerpo_demasiado_grande_responde_413(cliente):  # noqa: ANN001
    cuerpo = b"{" + b" " * (70 * 1024) + b"}"
    r = cliente.post("/liga/pagos/lemon/webhook", content=cuerpo,
                     headers={"X-Signature": _firma(cuerpo)})
    assert r.status_code == 413


def _cliente_con_sesion(monkeypatch):  # noqa: ANN001, ANN202
    """Cliente de la ruta con una sesión de prueba, sin pasar por Supabase."""
    monkeypatch.setattr(settings, "planes_visibles", True)
    from app.liga.auth import Identidad, require_usuario

    monkeypatch.setattr(pagos, "acepto_version_vigente", lambda uid: True)
    monkeypatch.setattr(rutas_pagos, "_LIMITE_CHECKOUT",
                        acceso.LimiteFrecuencia(tope=10, ventana_s=60 * 10))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[require_usuario] = lambda: Identidad(
        uid=USUARIO, aal="aal1", claims={})
    return TestClient(app)


def test_checkout_con_pro_vigente_no_abre_pago(monkeypatch):  # noqa: ANN001
    from app.liga import pagos as pagos_mod

    monkeypatch.setattr(pagos_mod, "clave_si_ya_tiene",
                        lambda uid, producto: "api_error_pro_ya_activo")
    cliente = _cliente_con_sesion(monkeypatch)
    r = cliente.post("/liga/pagos/lemon/checkout", json={"producto": "mensual"})
    assert r.status_code == 409
    assert r.json()["detail"] == "Ya tienes Pro activo."


def test_checkout_sin_configuracion_responde_503(monkeypatch):  # noqa: ANN001
    from app.liga import pagos as pagos_mod

    monkeypatch.setattr(pagos_mod, "clave_si_ya_tiene", lambda uid, producto: None)
    monkeypatch.setattr(settings, "lemon_api_key", "")
    cliente = _cliente_con_sesion(monkeypatch)
    r = cliente.post("/liga/pagos/lemon/checkout", json={"producto": "mensual"})
    assert r.status_code == 503


class _Respuesta:
    status_code = 201

    def json(self):  # noqa: ANN201
        return {"data": {"attributes": {"url": "https://vennett.lemonsqueezy.com/checkout/buy/prueba"}}}


@pytest.mark.parametrize(("modo", "esperado"), [("test", True), ("live", False)])
def test_checkout_pide_a_lemon_el_modo_del_servidor(monkeypatch, modo, esperado):  # noqa: ANN001
    from app.liga import pagos as pagos_mod
    from app.liga import rutas_pagos

    enviado = {}

    def fingir(url, **kwargs):  # noqa: ANN001, ANN202
        enviado.update(kwargs["json"]["data"])
        return _Respuesta()

    monkeypatch.setattr(pagos_mod, "clave_si_ya_tiene", lambda uid, producto: None)
    monkeypatch.setattr(settings, "lemon_api_key", "clave-de-prueba")
    monkeypatch.setattr(settings, "lemon_store_id", "494051")
    monkeypatch.setattr(settings, "lemon_modo", modo)
    monkeypatch.setattr(settings, "lemon_variantes", {"2228229": "mensual"})
    monkeypatch.setattr(rutas_pagos.httpx, "post", fingir)
    cliente = _cliente_con_sesion(monkeypatch)
    r = cliente.post("/liga/pagos/lemon/checkout", json={"producto": "mensual"})
    assert r.status_code == 200
    assert enviado["attributes"]["test_mode"] is esperado
    assert enviado["relationships"]["variant"]["data"]["id"] == "2228229"


def test_pack_liga_no_se_bloquea_por_tener_pase():
    assert pagos.clave_si_ya_tiene(USUARIO, "pack_liga") is None


@pytest.fixture
def lectura(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(rutas_pagos, "_LIMITE_LECTURA",
                        acceso.LimiteFrecuencia(tope=10, ventana_s=60 * 10))
    monkeypatch.setattr(pagos, "plan_pago_vigente", lambda uid: ("sub-propia", "mensual"))
    monkeypatch.setattr(settings, "lemon_api_key", "valor-ficticio")
    monkeypatch.setattr(settings, "lemon_variantes", {"111": "mensual"})
    return _cliente_con_sesion(monkeypatch)


def _pedir_lectura(cliente: TestClient) -> httpx.Response:
    return cliente.request("GET", "/liga/pagos/lemon/suscripcion", json={"id": "ajena"})


def test_lectura_sin_suscripcion(lectura: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pagos, "plan_pago_vigente", lambda uid: None)
    r = _pedir_lectura(lectura)
    assert r.status_code == 409
    assert r.json()["detail"] == "No hay ajustes disponibles para tu cuenta."


@pytest.mark.parametrize(("estado", "esperado"), [
    ("active", "activa"), ("on_trial", "activa"), ("cancelled", "cancelada"),
    ("past_due", "atrasada"), ("unpaid", "impagada"), ("paused", "pausada"),
    ("expired", "caducada"),
])
def test_leer_suscripcion_traduce_datos(lectura: TestClient, monkeypatch: pytest.MonkeyPatch,
                                     estado: str, esperado: str) -> None:
    def leer(url: str, **kwargs: object) -> httpx.Response:
        assert url.endswith("/subscriptions/sub-propia")
        assert kwargs["timeout"] == 15
        return httpx.Response(200, json={"data": {"attributes": {
            "status": estado, "variant_id": 111, "renews_at": "2027-01-10T00:00:00Z",
            "ends_at": None, "card_brand": "Visa", "card_last_four": "4242",
            "urls": {"customer_portal": "https://ejemplo.test/portal",
                     "update_payment_method": "https://ejemplo.test/tarjeta"}}}})

    monkeypatch.setattr(rutas_pagos.httpx, "get", leer)
    r = _pedir_lectura(lectura)
    assert r.status_code == 200
    assert r.json() == {
        "estado": esperado, "producto": "mensual", "renueva_en": "2027-01-10T00:00:00Z",
        "termina_en": None, "tarjeta_marca": "Visa", "tarjeta_ultimos4": "4242",
        "portal_url": "https://ejemplo.test/portal", "tarjeta_url": "https://ejemplo.test/tarjeta"}


def test_lectura_error_de_red(lectura: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def caer(url: str, **kwargs: object) -> httpx.Response:
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(rutas_pagos.httpx, "get", caer)
    assert _pedir_lectura(lectura).status_code == 502


def test_lectura_sin_configuracion(lectura: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "lemon_api_key", "")
    assert _pedir_lectura(lectura).status_code == 503


def test_lectura_error_http(lectura: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rutas_pagos.httpx, "get",
                        lambda *args, **kwargs: httpx.Response(500))
    assert _pedir_lectura(lectura).status_code == 502


def test_lectura_sin_tarjeta_y_variante_desconocida(
    lectura: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rutas_pagos.httpx, "get", lambda *args, **kwargs:
                        httpx.Response(200, json={"data": {"attributes": {
                            "status": "active", "variant_id": 999, "card_brand": "",
                            "card_last_four": "", "urls": {}}}}))
    r = _pedir_lectura(lectura)
    assert r.status_code == 200
    assert all(r.json()[campo] is None for campo in (
        "producto", "renueva_en", "termina_en", "tarjeta_marca", "tarjeta_ultimos4",
        "portal_url", "tarjeta_url"))


@pytest.mark.parametrize("attrs", [None, {"status": "desconocido"}, {
    "status": "active", "renews_at": "no es una fecha",
}])
def test_lectura_malformada(lectura: TestClient, monkeypatch: pytest.MonkeyPatch,
                          attrs: dict | None) -> None:
    monkeypatch.setattr(rutas_pagos.httpx, "get", lambda *args, **kwargs:
                        httpx.Response(200, json={"data": {"attributes": attrs}}))
    assert _pedir_lectura(lectura).status_code == 502


def test_limite_de_lectura(lectura: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    llamadas = []

    def responder(url: str, **kwargs: object) -> httpx.Response:
        llamadas.append(url)
        return httpx.Response(200, json={"data": {"attributes": {"status": "active"}}})

    monkeypatch.setattr(rutas_pagos.httpx, "get", responder)
    for _ in range(10):
        assert _pedir_lectura(lectura).status_code == 200
    assert _pedir_lectura(lectura).status_code == 429
    assert len(llamadas) == 10


@pytest.mark.parametrize(("version", "estado"), [("1", 403), ("2", 403), ("3", 200)])
def test_checkout_exige_version_vigente(monkeypatch, version, estado):  # noqa: ANN001
    from app.liga.registro import VERSION_TERMINOS

    cliente = _cliente_con_sesion(monkeypatch)
    consultas = []

    class Db:
        def execute(self, sql, params):  # noqa: ANN001, ANN201
            consultas.append((str(sql), params))
            assert params == {"u": USUARIO, "v": VERSION_TERMINOS}
            assert "documento = 'terminos'" in str(sql)
            assert "version = :v" in str(sql)
            return self

        def scalar(self) -> bool:
            return version == VERSION_TERMINOS

        def close(self) -> None:
            pass

    monkeypatch.setattr(pagos, "acepto_version_vigente", _ACEPTO_VERSION_VIGENTE)
    monkeypatch.setattr(pagos, "fabrica_sistema", Db)
    comprobaciones = []
    monkeypatch.setattr(pagos, "clave_si_ya_tiene",
                        lambda uid, producto: comprobaciones.append(producto))
    monkeypatch.setattr(settings, "lemon_api_key", "valor-ficticio")
    monkeypatch.setattr(settings, "lemon_store_id", "123")
    monkeypatch.setattr(settings, "lemon_variantes", {"111": "mensual"})
    llamadas = []
    monkeypatch.setattr(rutas_pagos.httpx, "post",
                        lambda *args, **kwargs: llamadas.append(kwargs) or _Respuesta())
    r = cliente.post("/liga/pagos/lemon/checkout", json={"producto": "mensual"})
    assert r.status_code == estado
    assert len(consultas) == 1
    assert len(comprobaciones) == len(llamadas) == (1 if estado == 200 else 0)
    if estado == 403:
        assert r.json()["detail"] == (
            "Acepta la nueva versión de los términos para continuar.")


def test_planes_ocultos_conservan_webhook(
    cliente: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "planes_visibles", False)
    respuesta = cliente.post("/liga/pagos/lemon/checkout", json={"producto": "mensual"})
    assert respuesta.status_code == 404
    assert cliente.get("/liga/pagos/lemon/suscripcion").status_code == 404
    assert cliente.post("/liga/pagos/lemon/webhook", content=_cuerpo()).status_code == 401
