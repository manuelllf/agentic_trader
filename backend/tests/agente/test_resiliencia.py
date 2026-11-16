"""Interruptor del proveedor y entrega de avisos a Vennett: sin red ni llamadas de pago."""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import avisos
from app.agente.config import ajustes
from app.agente.interruptor import EnPausa, EstadoInterruptor, Interruptor


class Reloj:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def _abierto(reloj: Reloj) -> Interruptor:
    i = Interruptor(fallos=3, pausa_s=60, reloj=reloj)
    assert [i.fallo() for _ in range(3)] == [False, False, True]
    return i


def test_abre_al_tercer_fallo_seguido_y_un_exito_reinicia_la_cuenta() -> None:
    i = Interruptor(fallos=3, pausa_s=60, reloj=Reloj())
    i.fallo()
    i.fallo()
    i.exito()
    assert i.fallo() is False
    assert i.estado is EstadoInterruptor.CERRADO


def test_abierto_no_deja_pasar_hasta_acabar_la_pausa() -> None:
    reloj = Reloj()
    i = _abierto(reloj)
    reloj.t = 59
    with pytest.raises(EnPausa):
        i.antes()
    # Fallos con el interruptor ya abierto no vuelven a avisar.
    assert i.fallo() is False


def test_tras_la_pausa_pasa_una_sola_prueba() -> None:
    reloj = Reloj()
    i = _abierto(reloj)
    reloj.t = 60
    assert i.estado is EstadoInterruptor.PRUEBA
    i.antes()
    with pytest.raises(EnPausa):
        i.antes()
    i.exito()
    assert i.estado is EstadoInterruptor.CERRADO
    i.antes()


def test_si_la_prueba_falla_vuelve_a_una_pausa_entera() -> None:
    reloj = Reloj()
    i = _abierto(reloj)
    reloj.t = 60
    i.antes()
    assert i.fallo() is True
    reloj.t = 119
    assert i.estado is EstadoInterruptor.ABIERTO
    reloj.t = 120
    assert i.estado is EstadoInterruptor.PRUEBA


def test_parametros_absurdos_se_rechazan() -> None:
    with pytest.raises(ValueError):
        Interruptor(fallos=0, pausa_s=60)


# Avisos


def _cerrados(s: Session) -> list[tuple[int, str]]:
    s.flush()
    return [((r.datos["aviso_id"]), r.datos["resultado"]) for r in s.execute(text(
        "select datos from agente.eventos where tipo = 'aviso_cerrado' order by id"))]


def test_tipo_de_aviso_mal_escrito_falla_antes_de_la_red(sesion_agente: Session) -> None:
    with pytest.raises(ValueError):
        avisos.avisar(sesion_agente, "ciclo_fallido")


def test_entrega_en_orden_y_no_repite(sesion_agente: Session) -> None:
    s = sesion_agente
    avisos.avisar(s, "agente_uno", {"n": 1})
    avisos.avisar(s, "agente_dos")
    enviados: list[tuple[str, dict]] = []
    assert avisos.entregar_pendientes(s, lambda t, d: enviados.append((t, d))) == 2
    assert enviados == [("agente_uno", {"n": 1}), ("agente_dos", {})]
    assert [r for _, r in _cerrados(s)] == ["entregado", "entregado"]
    assert avisos.entregar_pendientes(s, lambda t, d: enviados.append((t, d))) == 0
    assert len(enviados) == 2


def test_fallo_pasajero_para_y_deja_todo_pendiente(sesion_agente: Session) -> None:
    s = sesion_agente
    avisos.avisar(s, "agente_uno")
    avisos.avisar(s, "agente_dos")
    llamadas: list[str] = []

    def caido(tipo: str, datos: dict) -> None:
        llamadas.append(tipo)
        raise httpx.ConnectTimeout("sin red")
    assert avisos.entregar_pendientes(s, caido) == 0
    assert llamadas == ["agente_uno"]
    assert len(avisos.pendientes(s)) == 2


def _error(codigo: int) -> httpx.HTTPStatusError:
    peticion = httpx.Request("POST", "http://vennett.test")
    return httpx.HTTPStatusError("x", request=peticion,
                                 response=httpx.Response(codigo, request=peticion))


def test_rechazo_definitivo_se_cierra_y_sigue_con_el_siguiente(sesion_agente: Session) -> None:
    s = sesion_agente
    avisos.avisar(s, "agente_malo")
    avisos.avisar(s, "agente_bueno")
    enviados: list[str] = []

    def enviar(tipo: str, datos: dict) -> None:
        if tipo == "agente_malo":
            raise _error(422)
        enviados.append(tipo)
    assert avisos.entregar_pendientes(s, enviar) == 1
    assert enviados == ["agente_bueno"]
    assert [r for _, r in _cerrados(s)] == ["rechazado_422", "entregado"]


def test_429_no_es_definitivo(sesion_agente: Session) -> None:
    s = sesion_agente
    avisos.avisar(s, "agente_uno")

    def saturado(tipo: str, datos: dict) -> None:
        raise _error(429)
    assert avisos.entregar_pendientes(s, saturado) == 0
    assert len(avisos.pendientes(s)) == 1


def test_sin_configurar_no_envia(sesion_agente: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "vennett_url", "")
    avisos.avisar(sesion_agente, "agente_uno")
    assert avisos.entregar_pendientes(sesion_agente) == 0
    assert len(avisos.pendientes(sesion_agente)) == 1


def test_envio_http_con_clave_ruta_y_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "vennett_url", "http://vennett.test/")
    monkeypatch.setattr(ajustes, "vennett_clave_servicio", "secreta")
    visto: dict = {}

    def post(url: str, **kw: object) -> httpx.Response:
        visto.update(url=url, **kw)
        return httpx.Response(201, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    avisos.enviar_http("agente_uno", {"n": 1})
    assert visto["url"] == "http://vennett.test/liga/admin/avisos/agente"
    assert visto["headers"] == {"X-Clave-Servicio": "secreta"}
    assert visto["json"] == {"tipo": "agente_uno", "datos": {"n": 1}}
    assert visto["timeout"] == ajustes.timeout_vennett_s
