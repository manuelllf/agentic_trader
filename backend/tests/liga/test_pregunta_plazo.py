"""La pregunta propia de la formación: finalidad propia y hora límite. Sin base de datos ni IA, con
la caché, el proveedor y la sesión sustituidos."""

from __future__ import annotations

import contextlib
import threading
import time

import pytest

from app.liga.ia import comun, pregunta
from app.liga.motor.catalogo import EmpresaFoto


class SesionFalsa:
    def __init__(self) -> None:
        self.anadidas: list = []

    def begin_nested(self):  # noqa: ANN201
        return contextlib.nullcontext()

    def add(self, fila) -> None:  # noqa: ANN001
        self.anadidas.append(fila)

    def flush(self) -> None: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def close(self) -> None: ...


@pytest.fixture
def mundo(monkeypatch):  # noqa: ANN001, ANN201
    llamadas: list[dict] = []
    sesion = SesionFalsa()

    def jev(*, finalidad, modelo, state, pregunta, fabrica=None, verificar=True):  # noqa: ANN001, ANN202
        llamadas.append({"finalidad": finalidad, "verificar": verificar})
        return (0.9, 0.95), comun.LlamadaIA(modelo=modelo, tokens_entrada=1, tokens_salida=0,
                                            coste_usd=0.0, latencia_ms=1, ok=True)

    monkeypatch.setattr(pregunta, "_cache", lambda *_a, **_k: {})
    monkeypatch.setattr(comun, "verificar_disponible",
                        lambda finalidad, fabrica=None: llamadas.append({"comprobada": finalidad}))
    monkeypatch.setattr(comun, "llamar_ia_jev", jev)
    monkeypatch.setattr(comun, "registrar_llamada",
                        lambda **kw: llamadas.append({"registrada": kw["finalidad"]}) or 1)
    empresas = {t: EmpresaFoto(t, nombre=t) for t in ("AAA", "BBB", "CCC", "DDD", "EEE")}
    return llamadas, sesion, empresas


def _preguntar(mundo, **kw):  # noqa: ANN001, ANN003, ANN202
    _, sesion, empresas = mundo
    return pregunta.responder_pendientes(
        pregunta="¿Foso?", foto_id=1, empresas=empresas, candidatas=sorted(empresas),
        fabrica=lambda: sesion, **kw)


def test_la_finalidad_de_la_formacion_llega_a_todas_las_comprobaciones(mundo) -> None:  # noqa: ANN001
    llamadas, _, _ = mundo
    r = _preguntar(mundo, finalidad="formacion")
    assert r.nuevas == 5 and r.cortada is False
    usadas = {v for d in llamadas for v in d.values() if isinstance(v, str)}
    assert usadas == {"formacion"}


def test_por_defecto_sigue_siendo_la_pregunta_de_los_usuarios(mundo) -> None:  # noqa: ANN001
    llamadas, _, _ = mundo
    _preguntar(mundo)
    assert {v for d in llamadas for v in d.values() if isinstance(v, str)} == {"pregunta"}


def test_la_hora_limite_corta_y_guarda_lo_contestado(mundo) -> None:  # noqa: ANN001
    llamadas, sesion, _ = mundo
    reloj = iter(range(100))
    r = _preguntar(mundo, finalidad="formacion", hasta=3, reloj=lambda: next(reloj))
    assert r.cortada is True
    assert r.nuevas == 3 and len(sesion.anadidas) == 3        # las tres primeras quedan guardadas
    assert sum(1 for d in llamadas if "registrada" in d) == 3


def test_con_la_hora_limite_ya_pasada_no_se_llama_a_nadie(mundo) -> None:  # noqa: ANN001
    llamadas, sesion, _ = mundo
    r = _preguntar(mundo, finalidad="formacion", hasta=0, reloj=lambda: 5)
    assert r.cortada is True and r.nuevas == 0 and sesion.anadidas == []
    assert not any("registrada" in d for d in llamadas)


def test_sin_hora_limite_se_contestan_todas(mundo) -> None:  # noqa: ANN001
    r = _preguntar(mundo, finalidad="formacion", hasta=None)
    assert r.nuevas == 5 and r.cortada is False


# ---- a la vez, con reintento --------------------------------------------------------------------


def _jev_con(monkeypatch, fabrica_respuesta):  # noqa: ANN001, ANN202
    def jev(*, finalidad, modelo, state, pregunta, fabrica=None, verificar=True):  # noqa: ANN001, ANN202
        return fabrica_respuesta(state, modelo)

    monkeypatch.setattr(comun, "llamar_ia_jev", jev)


def _bien(modelo: str):  # noqa: ANN202
    return (0.9, 0.95), comun.LlamadaIA(modelo=modelo, tokens_entrada=1, tokens_salida=0,
                                        coste_usd=0.0, latencia_ms=1, ok=True)


def _mal(modelo: str):  # noqa: ANN202
    return None, comun.LlamadaIA(modelo=modelo, tokens_entrada=0, tokens_salida=0, coste_usd=0.0,
                                 latencia_ms=1, ok=False, error="timeout")


def test_las_preguntas_se_hacen_a_la_vez_con_un_maximo(mundo, monkeypatch) -> None:  # noqa: ANN001
    activas = {"ahora": 0, "maximo": 0}
    candado = threading.Lock()

    def lenta(state, modelo):  # noqa: ANN001, ANN202
        with candado:
            activas["ahora"] += 1
            activas["maximo"] = max(activas["maximo"], activas["ahora"])
        time.sleep(0.03)
        with candado:
            activas["ahora"] -= 1
        return _bien(modelo)

    _jev_con(monkeypatch, lenta)
    r = _preguntar(mundo, finalidad="formacion", trabajadores=3)
    assert r.nuevas == 5
    assert 2 <= activas["maximo"] <= 3


def test_la_base_solo_se_toca_desde_el_hilo_principal(mundo, monkeypatch) -> None:  # noqa: ANN001
    hilos: set[int] = set()
    monkeypatch.setattr(comun, "registrar_llamada",
                        lambda **_kw: hilos.add(threading.get_ident()) or 1)
    _jev_con(monkeypatch, lambda state, modelo: _bien(modelo))
    _, sesion, _ = mundo
    _preguntar(mundo, finalidad="formacion", trabajadores=4)
    assert hilos == {threading.get_ident()} and len(sesion.anadidas) == 5


def test_una_que_falla_se_reintenta_una_vez(mundo, monkeypatch) -> None:  # noqa: ANN001
    intentos: dict[str, int] = {}

    def a_veces(state, modelo):  # noqa: ANN001, ANN202
        ticker = state.split(" ", 1)[0]
        intentos[ticker] = intentos.get(ticker, 0) + 1
        return _mal(modelo) if ticker == "CCC" and intentos[ticker] == 1 else _bien(modelo)

    _jev_con(monkeypatch, a_veces)
    r = _preguntar(mundo, finalidad="formacion")
    assert r.nuevas == 5 and intentos["CCC"] == 2 and "CCC" in r.respuestas


def test_si_sigue_fallando_tras_el_reintento_queda_sin_respuesta(mundo, monkeypatch) -> None:  # noqa: ANN001
    llamadas, _, _ = mundo
    intentos: dict[str, int] = {}

    def siempre_mal(state, modelo):  # noqa: ANN001, ANN202
        ticker = state.split(" ", 1)[0]
        intentos[ticker] = intentos.get(ticker, 0) + 1
        return _mal(modelo) if ticker == "CCC" else _bien(modelo)

    _jev_con(monkeypatch, siempre_mal)
    r = _preguntar(mundo, finalidad="formacion")
    assert r.nuevas == 4 and "CCC" not in r.respuestas and intentos["CCC"] == 2
    assert sum(1 for d in llamadas if "registrada" in d) == 6   # 5 intentos y el reintento


def test_el_reintento_respeta_la_hora_limite(mundo, monkeypatch) -> None:  # noqa: ANN001
    intentos: dict[str, int] = {}

    def siempre_mal(state, modelo):  # noqa: ANN001, ANN202
        ticker = state.split(" ", 1)[0]
        intentos[ticker] = intentos.get(ticker, 0) + 1
        return _mal(modelo) if ticker == "EEE" else _bien(modelo)

    _jev_con(monkeypatch, siempre_mal)
    reloj = iter([0, 0, 0, 0, 0, 9, 9])      # cinco al enviar y el límite superado al reintentar
    r = _preguntar(mundo, finalidad="formacion", hasta=5, reloj=lambda: next(reloj))
    assert intentos["EEE"] == 1 and r.cortada is True


def test_entre_todas_las_peticiones_nunca_hay_mas_de_las_permitidas_a_la_vez(  # noqa: ANN001
        mundo, monkeypatch) -> None:
    monkeypatch.setattr(pregunta, "_PUERTA", threading.BoundedSemaphore(3))
    activas = {"ahora": 0, "maximo": 0}
    candado = threading.Lock()

    def lenta(state, modelo):  # noqa: ANN001, ANN202
        with candado:
            activas["ahora"] += 1
            activas["maximo"] = max(activas["maximo"], activas["ahora"])
        time.sleep(0.03)
        with candado:
            activas["ahora"] -= 1
        return _bien(modelo)

    _jev_con(monkeypatch, lenta)
    hilos = [threading.Thread(target=_preguntar, args=(mundo,),
                              kwargs={"finalidad": "formacion", "trabajadores": 4})
             for _ in range(3)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert 2 <= activas["maximo"] <= 3
