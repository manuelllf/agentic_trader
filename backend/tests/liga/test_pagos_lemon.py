"""Webhook de Lemon Squeezy: firma, idempotencia y traducción de eventos a acciones. Sin base de
datos ni red: los eventos son diccionarios con la forma que describe la documentación de Lemon."""

import hashlib
import hmac

from app.liga.pagos_lemon import clave_idempotencia, interpretar, verificar_firma

SECRETO = "secreto-de-prueba"
MAPA = {"111": "mensual", "222": "media_temporada", "333": "temporada", "444": "pack_liga"}
USUARIO = "6f2c1e1a-0000-4000-8000-000000000001"


def _firma(cuerpo: bytes, secreto: str = SECRETO) -> str:
    return hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()


def _evento(nombre: str, variante: str = "111", estado: str = "active", test: bool = True,
            usuario: str | None = USUARIO, **attrs) -> dict:
    meta = {"event_name": nombre, "test_mode": test}
    if usuario is not None:
        meta["custom_data"] = {"user_id": usuario}
    base = {"variant_id": int(variante), "status": estado,
            "updated_at": "2026-10-10T10:00:00.000000Z"}
    base.update(attrs)
    return {"meta": meta, "data": {"id": "98765", "type": "subscriptions", "attributes": base}}


def test_firma_valida_se_acepta():
    cuerpo = b'{"meta":{}}'
    assert verificar_firma(cuerpo, _firma(cuerpo), SECRETO)


def test_firma_con_otro_secreto_se_rechaza():
    cuerpo = b'{"meta":{}}'
    assert not verificar_firma(cuerpo, _firma(cuerpo, "otro"), SECRETO)


def test_cuerpo_alterado_se_rechaza():
    cuerpo = b'{"meta":{}}'
    assert not verificar_firma(b'{"meta":{"x":1}}', _firma(cuerpo), SECRETO)


def test_firma_vacia_o_sin_secreto_se_rechaza():
    assert not verificar_firma(b"{}", "", SECRETO)
    assert not verificar_firma(b"{}", _firma(b"{}"), "")


def test_firma_en_mayusculas_se_acepta():
    cuerpo = b"{}"
    assert verificar_firma(cuerpo, _firma(cuerpo).upper(), SECRETO)


def test_clave_idempotencia_es_estable_y_distingue_cuerpos():
    assert clave_idempotencia(b"a") == clave_idempotencia(b"a")
    assert clave_idempotencia(b"a") != clave_idempotencia(b"b")


def test_suscripcion_activa_da_pro_hasta_renovacion():
    accion = interpretar(
        _evento("subscription_created", renews_at="2027-01-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "pro"
    assert accion.usuario_id == USUARIO
    assert accion.producto == "mensual"
    assert accion.hasta.year == 2027


def test_media_temporada_es_pro_con_su_producto():
    accion = interpretar(
        _evento("subscription_updated", variante="222",
                renews_at="2027-04-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "pro"
    assert accion.producto == "media_temporada"


def test_pack_liga_da_pase_de_doce_meses():
    accion = interpretar(
        _evento("order_created", variante="444", created_at="2026-10-10T10:00:00.000000Z"),
        MAPA, "test")
    assert accion.tipo == "pase"
    assert accion.producto == "pack_liga"
    assert accion.hasta.year == 2027 and accion.hasta.month == 10


def test_cancelacion_da_baja():
    accion = interpretar(_evento("subscription_cancelled", estado="cancelled"), MAPA, "test")
    assert accion.tipo == "baja"


def test_evento_sin_usuario_se_ignora():
    accion = interpretar(_evento("subscription_created", usuario=None), MAPA, "test")
    assert accion.tipo == "ignorar"


def test_evento_de_test_en_modo_live_se_ignora():
    accion = interpretar(_evento("subscription_created", test=True), MAPA, "live")
    assert accion.tipo == "ignorar"


def test_evento_real_en_modo_test_se_ignora():
    accion = interpretar(_evento("subscription_created", test=False), MAPA, "test")
    assert accion.tipo == "ignorar"


def test_variante_desconocida_se_ignora():
    accion = interpretar(_evento("subscription_created", variante="999"), MAPA, "test")
    assert accion.tipo == "ignorar"


def test_suscripcion_pendiente_no_da_pro():
    accion = interpretar(
        _evento("subscription_created", estado="pending", renews_at="2027-01-10T00:00:00.000000Z"),
        MAPA, "test")
    assert accion.tipo == "ignorar"


def test_reanudar_tras_pausa_vuelve_a_dar_pro():
    accion = interpretar(
        _evento("subscription_unpaused", renews_at="2027-01-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "pro"


def test_cambio_de_plan_aplica_el_producto_nuevo():
    accion = interpretar(
        _evento("subscription_plan_changed", variante="222",
                renews_at="2027-04-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "pro"
    assert accion.producto == "media_temporada"


def test_devolucion_de_cobro_quita_el_derecho():
    accion = interpretar(_evento("subscription_payment_refunded", estado="active",
                                 subscription_id="98765"), MAPA, "test")
    assert accion.tipo == "baja"


def test_fallo_de_cobro_no_cambia_el_derecho():
    accion = interpretar(_evento("subscription_payment_failed", estado="past_due",
                                 subscription_id="98765"), MAPA, "test")
    assert accion.tipo == "ignorar"


def test_cobro_correcto_no_da_derecho_por_si_solo():
    evento = _evento("subscription_payment_success", subscription_id="98765")
    accion = interpretar(evento, MAPA, "test")
    assert accion.tipo == "ignorar"


def test_cobro_reembolsado_usa_la_suscripcion_no_la_factura():
    accion = interpretar(_evento("subscription_payment_refunded", subscription_id="98765"),
                         MAPA, "test")
    assert accion.tipo == "baja"
    assert accion.lemon_id == "98765"


def test_cobro_sin_suscripcion_se_ignora():
    accion = interpretar(_evento("subscription_payment_refunded"), MAPA, "test")
    assert accion.tipo == "ignorar" and accion.motivo == "sin_compra"


def test_cancelacion_conserva_el_acceso_hasta_ends_at():
    accion = interpretar(
        _evento("subscription_cancelled", estado="cancelled",
                ends_at="2026-11-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "baja"
    assert accion.hasta.year == 2026 and accion.hasta.month == 11


def test_cancelacion_sin_ends_at_corta_ya():
    accion = interpretar(_evento("subscription_cancelled", estado="cancelled"), MAPA, "test")
    assert accion.tipo == "baja" and accion.hasta is None


def test_reembolso_de_pedido_pack_quita_el_pase():
    accion = interpretar(_evento("order_refunded", variante="444"), MAPA, "test")
    assert accion.tipo == "baja"


def test_usuario_con_formato_invalido_se_ignora():
    evento = _evento("subscription_created", renews_at="2027-01-10T00:00:00.000000Z")
    evento["meta"]["custom_data"]["user_id"] = "no-es-un-uuid"
    accion = interpretar(evento, MAPA, "test")
    assert accion.tipo == "ignorar" and accion.motivo == "sin_usuario_valido"


def test_alta_sin_fecha_de_fin_se_ignora():
    accion = interpretar(_evento("subscription_created"), MAPA, "test")
    assert accion.tipo == "ignorar" and accion.motivo == "sin_fecha_de_fin"


def test_estado_no_activo_en_alta_se_ignora():
    accion = interpretar(
        _evento("subscription_updated", estado="past_due",
                renews_at="2027-01-10T00:00:00.000000Z"), MAPA, "test")
    assert accion.tipo == "ignorar" and accion.motivo == "estado_no_activo"


def test_modo_inesperado_no_aplica_nada():
    accion = interpretar(_evento("subscription_created", test=False,
                                 renews_at="2027-01-10T00:00:00.000000Z"), MAPA, "tst")
    assert accion.tipo == "ignorar"
