"""La pregunta propia de la formación: finalidad propia y hora límite. Sin base de datos ni IA, con
la caché, el proveedor y la sesión sustituidos."""

from __future__ import annotations

import contextlib

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
