"""Capa de pagos de Lemon contra el Postgres de pruebas: idempotencia, orden de eventos y que el
Pro y el pase quedan en su tabla con origen «pago». Se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import json
import os
import uuid

import pytest

from app.liga import pagos
from app.liga.pagos_lemon import interpretar

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
MAPA = {"111": "mensual", "444": "pack_liga"}


def _evento(uid: str, nombre: str, actualizado: str, variante: int = 111, **extra) -> bytes:
    attrs = {"variant_id": variante, "status": "active", "updated_at": actualizado}
    attrs.update(extra)
    return json.dumps({
        "meta": {"event_name": nombre, "test_mode": True, "custom_data": {"user_id": uid}},
        "data": {"id": "5001", "type": "subscriptions", "attributes": attrs},
    }).encode()


def _aplicar(cuerpo: bytes) -> str:
    evento = json.loads(cuerpo)
    accion = interpretar(evento, MAPA, "test")
    return pagos.registrar(cuerpo, accion, evento["meta"]["event_name"])


@pytest.fixture
def usuario(monkeypatch):  # noqa: ANN001, ANN201
    psycopg = pytest.importorskip("psycopg")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1),
                          pool_pre_ping=True)
    fabrica = sessionmaker(bind=motor, expire_on_commit=False)
    monkeypatch.setattr(pagos, "fabrica_sistema", fabrica)
    uid = str(uuid.uuid4())
    with psycopg.connect(URL, autocommit=True) as cx:
        cx.execute("insert into auth.users (id, email, email_confirmed_at) "
                   "values (%s, %s, now())",
                   (uid, f"pago-{uid[:8]}@pruebas.invalid"))
    yield uid
    with psycopg.connect(URL, autocommit=True) as cx:
        cx.execute("delete from auth.users where id = %s", (uid,))
    motor.dispose()


def _cuenta(uid: str, sql: str) -> int:
    import psycopg

    with psycopg.connect(URL, autocommit=True) as cx:
        return cx.execute(sql, (uid,)).fetchone()[0]


def test_alta_da_pro_de_pago_y_guarda_la_compra(usuario):  # noqa: ANN001
    cuerpo = _evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                     renews_at="2026-11-10T00:00:00.000000Z")
    assert _aplicar(cuerpo) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1
    assert _cuenta(usuario, "select count(*) from liga.compras_pago "
                            "where usuario_id = %s and producto = 'mensual'") == 1


def test_reenvio_del_mismo_evento_no_se_aplica_dos_veces(usuario):  # noqa: ANN001
    cuerpo = _evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                     renews_at="2026-11-10T00:00:00.000000Z")
    assert _aplicar(cuerpo) == "aplicado"
    assert _aplicar(cuerpo) == "duplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_evento_mas_viejo_que_el_guardado_no_pisa_nada(usuario):  # noqa: ANN001
    nuevo = _evento(usuario, "subscription_updated", "2026-10-12T10:00:00.000000Z",
                    renews_at="2026-11-12T00:00:00.000000Z")
    viejo = _evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                    renews_at="2026-11-10T00:00:00.000000Z")
    assert _aplicar(nuevo) == "aplicado"
    assert _aplicar(viejo) == "obsoleto"
    assert _cuenta(usuario, "select count(*) from liga.compras_pago "
                            "where usuario_id = %s and actualizado_lemon < "
                            "'2026-10-11T00:00:00Z'") == 0


def test_pack_liga_da_pase_de_pago(usuario):  # noqa: ANN001
    cuerpo = _evento(usuario, "order_created", "2026-10-10T10:00:00.000000Z", variante=444,
                     created_at="2026-10-10T10:00:00.000000Z")
    assert _aplicar(cuerpo) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.pases_liga "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_baja_corta_el_pro_de_pago(usuario):  # noqa: ANN001
    alta = _evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                   renews_at="2026-11-10T00:00:00.000000Z")
    baja = _evento(usuario, "subscription_cancelled", "2026-10-11T10:00:00.000000Z",
                   status="cancelled")
    _aplicar(alta)
    assert _aplicar(baja) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago' "
                            "and (hasta is null or hasta > now())") == 0


def test_baja_de_una_suscripcion_no_toca_la_otra(usuario):  # noqa: ANN001
    primera = _evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                      renews_at="2026-11-10T00:00:00.000000Z")
    segunda = json.loads(_evento(usuario, "subscription_created", "2026-10-10T11:00:00.000000Z",
                                 renews_at="2026-12-10T00:00:00.000000Z"))
    segunda["data"]["id"] = "5002"
    _aplicar(primera)
    _aplicar(json.dumps(segunda).encode())
    baja = _evento(usuario, "subscription_expired", "2026-10-12T10:00:00.000000Z", estado="expired")
    _aplicar(baja)
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            "and compra_lemon_id = '5002' "
                            "and (hasta is null or hasta > now())") == 1


def test_renovacion_extiende_la_misma_fila(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                     renews_at="2026-11-10T00:00:00.000000Z"))
    _aplicar(_evento(usuario, "subscription_updated", "2026-11-10T10:00:00.000000Z",
                     renews_at="2026-12-10T00:00:00.000000Z"))
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_cancelacion_conserva_el_acceso_hasta_ends_at(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_created", "2026-10-10T10:00:00.000000Z",
                     renews_at="2026-11-10T00:00:00.000000Z"))
    _aplicar(_evento(usuario, "subscription_cancelled", "2026-10-11T10:00:00.000000Z",
                     status="cancelled", ends_at="2026-11-10T00:00:00.000000Z"))
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            "and origen = 'pago' and hasta > now()") == 1


def test_reembolso_de_pack_quita_el_pase(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "order_created", "2026-10-10T10:00:00.000000Z", variante=444,
                     created_at="2026-10-10T10:00:00.000000Z"))
    reembolso = json.loads(_evento(usuario, "order_refunded", "2026-10-12T10:00:00.000000Z",
                                   variante=444))
    reembolso["data"]["id"] = "5001"
    assert _aplicar(json.dumps(reembolso).encode()) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.pases_liga where usuario_id = %s "
                            "and origen = 'pago' and hasta > now()") == 0


def test_evento_de_la_misma_compra_no_se_pisa_con_uno_mas_viejo(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_updated", "2026-10-12T10:00:00.000000Z",
                     renews_at="2026-12-12T00:00:00.000000Z"))
    viejo = _evento(usuario, "subscription_updated", "2026-10-10T10:00:00.000000Z",
                    renews_at="2026-11-10T00:00:00.000000Z")
    assert _aplicar(viejo) == "obsoleto"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            "and hasta > '2026-12-01T00:00:00Z'") == 1
