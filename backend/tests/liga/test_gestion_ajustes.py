"""Catálogo de `liga.ajustes` (`app.liga.gestion`): validación por tipo y valor efectivo por
defecto. Sin BD -- pura, como `test_procesos_puros.py`."""

from __future__ import annotations

import pytest

from app.liga import gestion


def test_catalogo_cubre_las_mismas_claves_que_antes() -> None:
    assert gestion.AJUSTES_CONOCIDOS == frozenset({
        "creditos.bienvenida",
        "ia.conversor.activo", "ia.pregunta.activo", "ia.lectura.activo",
        "ia.tope_mensual_usd", "ia.margen_objetivo",
        "ia.formacion.activo", "ia.tope_formacion_usd", "procesos.formar.limite_preguntas_s",
        "liga.registro.abierto", "liga.visible",
        "procesos.foto.auto", "procesos.formar.auto",
    })


def test_valor_efectivo_usa_el_defecto_solo_si_no_hay_valor() -> None:
    assert gestion.valor_efectivo("liga.registro.abierto", None) is False
    assert gestion.valor_efectivo("liga.registro.abierto", False) is False
    assert gestion.valor_efectivo("ia.conversor.activo", None) is False
    assert gestion.valor_efectivo("ia.tope_mensual_usd", None) is None
    assert gestion.valor_efectivo("ia.tope_mensual_usd", 5.0) == 5.0
    assert gestion.valor_efectivo("ia.margen_objetivo", None) == 3


@pytest.mark.parametrize("clave", ["liga.registro.abierto", "ia.conversor.activo"])
def test_interruptor_solo_acepta_booleano(clave: str) -> None:
    assert gestion.validar_ajuste(clave, True) is True
    assert gestion.validar_ajuste(clave, False) is False
    for malo in ("true", 1, None, 0):
        with pytest.raises(ValueError, match="interruptor"):
            gestion.validar_ajuste(clave, malo)


def test_dolares_normaliza_a_dos_decimales() -> None:
    assert gestion.validar_ajuste("ia.tope_mensual_usd", 5) == 5.0
    assert gestion.validar_ajuste("ia.tope_mensual_usd", "2.5") == 2.5
    assert gestion.validar_ajuste("ia.tope_mensual_usd", 2.567) == 2.57


def test_dolares_rechaza_negativo_y_no_numerico() -> None:
    with pytest.raises(ValueError, match="negativo"):
        gestion.validar_ajuste("ia.tope_mensual_usd", -0.01)
    with pytest.raises(ValueError, match="número"):
        gestion.validar_ajuste("ia.tope_mensual_usd", "no numero")
    with pytest.raises(ValueError, match="número"):
        gestion.validar_ajuste("ia.tope_mensual_usd", True)


def test_multiplicador_misma_regla_que_dolares() -> None:
    assert gestion.validar_ajuste("ia.margen_objetivo", 4) == 4.0
    with pytest.raises(ValueError, match="negativo"):
        gestion.validar_ajuste("ia.margen_objetivo", -1)


def test_clave_desconocida_no_esta_en_el_catalogo() -> None:
    assert "lo.que.sea" not in gestion.CATALOGO


# ---- caché de `liga.ajustes` (hallazgos de latencia #3 y seguridad #2) ------------------------


class _FilaFalsa:
    def __init__(self, clave: str, valor: object) -> None:
        self.clave = clave
        self.valor = valor


class _ResultadoFalso:
    def __init__(self, filas: list[_FilaFalsa]) -> None:
        self._filas = filas

    def all(self) -> list[_FilaFalsa]:
        return self._filas


class _DBFalsa:
    def __init__(self, valores: dict[str, object], contador: dict[str, int]) -> None:
        self._valores = valores
        self._contador = contador

    def execute(self, _stmt, params):  # noqa: ANN001, ANN201
        self._contador["consultas"] += 1
        claves = params["c"]
        return _ResultadoFalso([_FilaFalsa(c, self._valores[c]) for c in claves
                                if c in self._valores])

    def close(self) -> None:
        pass


def test_ajuste_booleano_no_va_a_bd_dentro_del_ttl(monkeypatch) -> None:  # noqa: ANN001
    contador = {"consultas": 0}
    db_falsa = _DBFalsa({"liga.visible": True}, contador)
    monkeypatch.setattr(gestion, "fabrica_sistema", lambda: db_falsa)
    gestion.invalidar_cache_ajustes()

    assert gestion.liga_visible() is True
    assert gestion.liga_visible() is True
    assert gestion.liga_visible() is True
    # Las tres lecturas caen en la misma sesión de proceso (TTL de 15 s): una sola ida a la BD,
    # no una por petición pública (antes: una sesión de sistema nueva en CADA lectura).
    assert contador["consultas"] == 1


def test_invalidar_cache_ajustes_fuerza_una_lectura_nueva(monkeypatch) -> None:  # noqa: ANN001
    contador = {"consultas": 0}
    db_falsa = _DBFalsa({"liga.visible": True}, contador)
    monkeypatch.setattr(gestion, "fabrica_sistema", lambda: db_falsa)
    gestion.invalidar_cache_ajustes()

    assert gestion.liga_visible() is True
    assert contador["consultas"] == 1
    # Un admin apaga la liga: `restablecer_ajuste`/`actualizar_ajuste` invalidan la clave -- el
    # siguiente lector del MISMO proceso ve el cambio al instante, no tras el TTL.
    db_falsa._valores["liga.visible"] = False  # noqa: SLF001
    gestion.invalidar_cache_ajustes("liga.visible")
    assert gestion.liga_visible() is False
    assert contador["consultas"] == 2


def test_invalidar_cache_ajustes_sin_clave_limpia_todo(monkeypatch) -> None:  # noqa: ANN001
    contador = {"consultas": 0}
    db_falsa = _DBFalsa({"liga.visible": True, "liga.registro.abierto": True}, contador)
    monkeypatch.setattr(gestion, "fabrica_sistema", lambda: db_falsa)
    gestion.invalidar_cache_ajustes()

    assert gestion.liga_visible() is True
    assert gestion.registro_abierto() is True
    assert contador["consultas"] == 2
    gestion.invalidar_cache_ajustes()
    assert gestion.liga_visible() is True
    assert contador["consultas"] == 3
