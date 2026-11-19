"""La cartera de la casa Alpha sale de la base del agente: pesos, esperas y caja, sin red."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.liga.procesos import alpha_agente, casa
from app.liga.procesos.alpha_agente import FotoAgente, SinLecturaAgente
from app.liga.procesos.comun import ErrorProceso

DIA = date(2026, 11, 30)


def _lector(foto: FotoAgente):
    return lambda fecha: foto if fecha == DIA else pytest.fail(f"pidió el día {fecha}")


def _falla(fecha: date) -> FotoAgente:
    raise SinLecturaAgente("No se pudo leer la base del agente (OperationalError)")


def test_los_pesos_del_agente_pasan_a_porcentajes_de_la_casa() -> None:
    foto = FotoAgente((("AAA", Decimal("0.6")), ("BBB", Decimal("0.4"))), cierre_guardado=True)
    c = casa.cartera_alpha(DIA, espera_agotada=False, leer=_lector(foto))
    assert dict(c.posiciones) == {"AAA": Decimal("60.0000"), "BBB": Decimal("40.0000")}
    assert c.avisos == () and c.motivo is None


def test_pesos_que_no_suman_uno_por_redondeo_no_pasan_de_cien() -> None:
    tercios = tuple((t, Decimal("0.3333333333")) for t in ("AAA", "BBB", "CCC"))
    c = casa.cartera_alpha(DIA, espera_agotada=False, leer=_lector(FotoAgente(tercios, True)))
    assert sum(p for _, p in c.posiciones) <= Decimal(100)
    assert all(p > 0 for _, p in c.posiciones)


def test_sin_cierre_guardado_espera_mientras_dure_la_espera() -> None:
    foto = FotoAgente((("AAA", Decimal("1")),), cierre_guardado=False)
    with pytest.raises(ErrorProceso, match="Alpha: .*30-11-2026|Alpha: .*2026-11-30"):
        casa.cartera_alpha(DIA, espera_agotada=False, leer=_lector(foto))


def test_sin_cierre_guardado_y_espera_agotada_juega_con_lo_que_hay_y_lo_dice() -> None:
    foto = FotoAgente((("AAA", Decimal("1")),), cierre_guardado=False)
    c = casa.cartera_alpha(DIA, espera_agotada=True, leer=_lector(foto))
    assert dict(c.posiciones) == {"AAA": Decimal("100.0000")}
    assert "último cierre" in c.avisos[0] and "2026-11-30" in c.avisos[0]


def test_si_no_se_puede_leer_espera_y_despues_juega_en_caja() -> None:
    with pytest.raises(ErrorProceso, match="Alpha: No se pudo leer"):
        casa.cartera_alpha(DIA, espera_agotada=False, leer=_falla)
    c = casa.cartera_alpha(DIA, espera_agotada=True, leer=_falla)
    assert c.posiciones == () and "caja" in c.motivo and "No se pudo leer" in c.motivo


def test_un_agente_sin_posiciones_juega_en_caja() -> None:
    c = casa.cartera_alpha(DIA, espera_agotada=False, leer=_lector(FotoAgente((), True)))
    assert c.posiciones == ()      # vacío, no None: la casa entra, en caja
    assert "no tenía posiciones" in c.motivo and "caja" in c.motivo


def test_sin_dia_de_foto_juega_en_caja_y_no_lee() -> None:
    c = casa.cartera_alpha(None, espera_agotada=False, leer=lambda f: pytest.fail("no debía leer"))
    assert c.posiciones == () and "caja" in c.motivo


def test_la_casa_usa_el_lector_del_modulo_si_no_se_le_da_otro(
        monkeypatch: pytest.MonkeyPatch) -> None:
    foto = FotoAgente((("AAA", Decimal("1")),), True)
    monkeypatch.setattr(alpha_agente, "leer", _lector(foto))
    c = casa.cartera_alpha(DIA, espera_agotada=False)
    assert dict(c.posiciones) == {"AAA": Decimal("100.0000")}


# ---- la lectura de verdad, con una conexión falsa ------------------------------------------------


class _Resultado:
    def __init__(self, filas):
        self._filas = filas

    def scalar_one(self):
        return self._filas[0][0]

    def all(self):
        return self._filas


class _Conexion:
    def __init__(self, respuestas):
        self.respuestas, self.consultas = respuestas, []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, consulta, params=None):
        sql = str(consulta)
        self.consultas.append((sql, params))
        return _Resultado(self.respuestas["dia_cerrado" if "dia_cerrado" in sql else "foto"])


class _Motor:
    def __init__(self, conexion):
        self.conexion = conexion

    def connect(self):
        return self.conexion


def test_leer_pide_las_dos_funciones_del_dia_y_devuelve_los_pesos(monkeypatch) -> None:
    cx = _Conexion({"dia_cerrado": [(True,)],
                    "foto": [("AAA", Decimal("0.7")), ("BBB", Decimal("0.3"))]})
    monkeypatch.setattr(settings, "agente_lectura_url", "postgresql://u:clave@servidor/base")
    monkeypatch.setattr(alpha_agente, "_motor", lambda url: _Motor(cx))
    foto = alpha_agente.leer(DIA)
    assert foto == FotoAgente((("AAA", Decimal("0.7")), ("BBB", Decimal("0.3"))), True)
    assert [p for _, p in cx.consultas] == [{"f": DIA}, {"f": DIA}]
    assert "agente.dia_cerrado" in cx.consultas[0][0]
    assert "agente.foto_cartera" in cx.consultas[1][0]


def test_leer_sin_url_dice_que_falta_la_conexion(monkeypatch) -> None:
    monkeypatch.setattr(settings, "agente_lectura_url", "")
    with pytest.raises(SinLecturaAgente, match="AGENTE_LECTURA_URL"):
        alpha_agente.leer(DIA)


def test_un_fallo_de_la_base_no_filtra_servidor_ni_clave(monkeypatch) -> None:
    class Roto:
        def connect(self):
            raise OperationalError("select", {}, Exception("fallo con u:clave@servidor"))

    monkeypatch.setattr(settings, "agente_lectura_url", "postgresql://u:clave@servidor/base")
    monkeypatch.setattr(alpha_agente, "_motor", lambda url: Roto())
    with pytest.raises(SinLecturaAgente) as e:
        alpha_agente.leer(DIA)
    assert "clave" not in str(e.value) and "servidor" not in str(e.value)
    assert "OperationalError" in str(e.value)
