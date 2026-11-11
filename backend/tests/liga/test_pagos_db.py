"""Capa de pagos de Lemon contra el Postgres de pruebas: idempotencia, orden de eventos y que el
Pro y el pase quedan en su tabla con origen «pago». Se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.liga import pagos
from app.liga.pagos_lemon import interpretar

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
MAPA = {"111": "mensual", "222": "temporada", "444": "pack_liga"}
AHORA = datetime.now(UTC)


def _cuando(dias: int = 0, horas: int = 0) -> str:
    """Instante relativo a hoy: los eventos son recientes y las renovaciones, futuras."""
    return (AHORA + timedelta(days=dias, hours=horas)).strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def _evento(uid: str, nombre: str, actualizado: str, variante: int = 111,
            compra: str = "5001", **extra) -> bytes:
    attrs = {"variant_id": variante, "status": "active", "updated_at": actualizado}
    attrs.update(extra)
    return json.dumps({
        "meta": {"event_name": nombre, "test_mode": True, "custom_data": {"user_id": uid}},
        "data": {"id": compra, "type": "subscriptions", "attributes": attrs},
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
    cuerpo = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    assert _aplicar(cuerpo) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1
    assert _cuenta(usuario, "select count(*) from liga.compras_pago "
                            "where usuario_id = %s and producto = 'mensual'") == 1


def test_evento_de_usuario_borrado_se_ignora(usuario, caplog) -> None:  # noqa: ANN001
    import psycopg

    compra = f"borrado-{uuid.uuid4()}"
    assert _aplicar(_evento(
        usuario, "subscription_created", _cuando(-3), compra=compra,
        renews_at=_cuando(30))) == "aplicado"
    with psycopg.connect(URL, autocommit=True) as cx:
        cx.execute("delete from auth.users where id = %s", (usuario,))
    cuerpo = _evento(usuario, "subscription_cancelled", _cuando(-2),
                     compra=compra, status="cancelled")
    with caplog.at_level("INFO", logger=pagos.__name__):
        assert _aplicar(cuerpo) == "ignorado"
    assert "usuario borrado" in caplog.text
    assert _cuenta(usuario, "select count(*) from liga.compras_pago where usuario_id = %s") == 0
    with psycopg.connect(URL, autocommit=True) as cx:
        assert cx.execute("select estado from liga.eventos_pago where clave = %s",
                          (pagos.clave_idempotencia(cuerpo),)).fetchone()[0] == "ignorado"
    assert _aplicar(cuerpo) == "duplicado"


def test_reenvio_del_mismo_evento_no_se_aplica_dos_veces(usuario):  # noqa: ANN001
    cuerpo = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    assert _aplicar(cuerpo) == "aplicado"
    assert _aplicar(cuerpo) == "duplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_evento_mas_viejo_que_el_guardado_no_pisa_nada(usuario):  # noqa: ANN001
    nuevo = _evento(usuario, "subscription_updated", _cuando(-1), renews_at=_cuando(32))
    viejo = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    assert _aplicar(nuevo) == "aplicado"
    assert _aplicar(viejo) == "obsoleto"
    assert _cuenta(usuario, "select count(*) from liga.compras_pago "
                            f"where usuario_id = %s and actualizado_lemon < '{_cuando(-2)}'") == 0


def test_pack_liga_da_pase_de_pago(usuario):  # noqa: ANN001
    cuerpo = _evento(usuario, "order_created", _cuando(-3), variante=444,
                     created_at=_cuando(-3))
    assert _aplicar(cuerpo) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.pases_liga "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_dos_packs_dan_dos_pases_de_pago(usuario):  # noqa: ANN001
    for pedido in ("pedido-1", "pedido-2"):
        cuerpo = _evento(usuario, "order_created", _cuando(-3), variante=444,
                         compra=pedido, created_at=_cuando(-3))
        assert _aplicar(cuerpo) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.pases_liga "
                            "where usuario_id = %s and origen = 'pago'") == 2


def test_cambio_de_variante_actualiza_el_producto_y_sigue_siendo_un_solo_pro(usuario):  # noqa: ANN001
    import psycopg

    alta = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    cambio = _evento(usuario, "subscription_updated", _cuando(-2), variante=222,
                     renews_at=_cuando(180))
    assert _aplicar(alta) == "aplicado"
    assert _aplicar(cambio) == "aplicado"
    with psycopg.connect(URL, autocommit=True) as cx:
        producto = cx.execute("select producto from liga.compras_pago "
                              "where usuario_id = %s", (usuario,)).fetchone()[0]
    assert producto == "temporada"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_baja_corta_el_pro_de_pago(usuario):  # noqa: ANN001
    alta = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    baja = _evento(usuario, "subscription_cancelled", _cuando(-2), status="cancelled")
    _aplicar(alta)
    assert _aplicar(baja) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago' "
                            "and (hasta is null or hasta > now())") == 0


def test_baja_de_una_suscripcion_no_toca_la_otra(usuario):  # noqa: ANN001
    primera = _evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30))
    segunda = json.loads(_evento(usuario, "subscription_created", _cuando(-3, 1),
                                 renews_at=_cuando(60)))
    segunda["data"]["id"] = "5002"
    _aplicar(primera)
    _aplicar(json.dumps(segunda).encode())
    baja = _evento(usuario, "subscription_expired", _cuando(-1), estado="expired")
    _aplicar(baja)
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            "and compra_lemon_id = '5002' "
                            "and (hasta is null or hasta > now())") == 1


def test_renovacion_extiende_la_misma_fila(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30)))
    _aplicar(_evento(usuario, "subscription_updated", _cuando(-1), renews_at=_cuando(60)))
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario "
                            "where usuario_id = %s and origen = 'pago'") == 1


def test_cancelacion_conserva_el_acceso_hasta_ends_at(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_created", _cuando(-3), renews_at=_cuando(30)))
    _aplicar(_evento(usuario, "subscription_cancelled", _cuando(-2),
                     status="cancelled", ends_at=_cuando(30)))
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            "and origen = 'pago' and hasta > now()") == 1


def test_reembolso_de_pack_quita_el_pase(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "order_created", _cuando(-3), variante=444,
                     created_at=_cuando(-3)))
    reembolso = json.loads(_evento(usuario, "order_refunded", _cuando(-1), variante=444))
    reembolso["data"]["id"] = "5001"
    assert _aplicar(json.dumps(reembolso).encode()) == "aplicado"
    assert _cuenta(usuario, "select count(*) from liga.pases_liga where usuario_id = %s "
                            "and origen = 'pago' and hasta > now()") == 0


def test_evento_de_la_misma_compra_no_se_pisa_con_uno_mas_viejo(usuario):  # noqa: ANN001
    _aplicar(_evento(usuario, "subscription_updated", _cuando(-1), renews_at=_cuando(90)))
    viejo = _evento(usuario, "subscription_updated", _cuando(-3), renews_at=_cuando(30))
    assert _aplicar(viejo) == "obsoleto"
    assert _cuenta(usuario, "select count(*) from liga.planes_usuario where usuario_id = %s "
                            f"and hasta > '{_cuando(60)}'") == 1


def test_disputa_se_registra_sin_cambiar_derechos(usuario, caplog):  # noqa: ANN001
    import psycopg

    assert _aplicar(_evento(
        usuario, "subscription_created", _cuando(-3),
        renews_at=_cuando(30))) == "aplicado"
    assert _aplicar(_evento(
        usuario, "order_created", _cuando(-3), variante=444,
        compra="pack-disputa", created_at=_cuando(-3))) == "aplicado"
    tablas = ("liga.planes_usuario", "liga.pases_liga")
    antes = {tabla: _cuenta(usuario, f"select count(*) from {tabla} where usuario_id = %s")
             for tabla in tablas}
    with psycopg.connect(URL, autocommit=True) as cx:
        derechos = {tabla: cx.execute(
            f"select * from {tabla} where usuario_id = %s order by id", (usuario,)).fetchall()
            for tabla in tablas}
    cuerpo = _evento(usuario, "dispute_created", _cuando(-1))
    with caplog.at_level("WARNING", logger=pagos.__name__):
        assert _aplicar(cuerpo) == "ignorado"
    for tabla in tablas:
        despues = _cuenta(usuario, f"select count(*) from {tabla} where usuario_id = %s")
        assert despues == antes[tabla]
    with psycopg.connect(URL, autocommit=True) as cx:
        for tabla in tablas:
            assert cx.execute(
                f"select * from {tabla} where usuario_id = %s order by id",
                (usuario,)).fetchall() == derechos[tabla]
        assert cx.execute(
            "select estado from liga.eventos_pago where clave = %s",
            (pagos.clave_idempotencia(cuerpo),)).fetchone()[0] == "ignorado"
    assert any(registro.levelname == "WARNING" and "disputa" in registro.getMessage()
               and "dispute_created" in registro.getMessage() and "5001" in registro.getMessage()
               for registro in caplog.records)
