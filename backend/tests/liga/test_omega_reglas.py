"""Reglas y persistencia de Omega en la liga."""
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.liga.motor.omega_huecos import Alerta, Operacion, simular
from app.liga.procesos import omega
from app.precios import Cierre

DIA = date(2026, 10, 1)


@pytest.mark.parametrize("alertas, esperado", [
    ([Alerta("AAA", datetime(2026, 10, 1, 10), 99, 1000),
      Alerta("BBB", datetime(2026, 10, 1, 11), 1, 1)], "BBB"),
    ([Alerta("AAA", datetime(2026, 10, 1, 10), 99, 1000),
      Alerta("BBB", datetime(2026, 10, 1, 10), 1, 2000)], "BBB"),
    ([Alerta("AAA", datetime(2026, 9, 25, 10), 99)], None),
    ([Alerta("AAA", datetime(2026, 9, 26, 10), 99)], "AAA"),
])
def test_prioridad_y_frescura(alertas, esperado):
    cierres = {a.ticker: [Cierre(DIA, 100)] for a in alertas}
    ops = simular([], alertas, cierres, DIA, DIA, n_huecos=1)
    assert (ops[0].ticker if ops else None) == esperado


class PersistenciaDB:
    def __init__(self):
        self.escrituras = []

    def execute(self, sql, params):
        self.escrituras.append((str(sql), params))
        return SimpleNamespace(all=lambda: [])


def test_precio_tardio_casa_por_senal_y_guarda_cierre(monkeypatch, caplog):
    db = PersistenciaDB()
    j = SimpleNamespace(id=1, dia_base=DIA - timedelta(days=1),
                        dia_fin=DIA + timedelta(days=30), temporada_id=1)
    fila = SimpleNamespace(id=9, numero=1, ticker="AAA", entrada_dia=DIA,
                           entrada_precio=100, salida_dia=None, salida_precio=None,
                           motivo=None, senal_id=17)
    monkeypatch.setattr(omega, "capturar_alertas", lambda *args: 0)
    monkeypatch.setattr(omega, "_arrastre", lambda *args: [])
    monkeypatch.setattr(omega, "_propias", lambda *args: [fila])
    monkeypatch.setattr(omega, "alertas", lambda *args: [])
    monkeypatch.setattr(omega.precios, "series", lambda *args: {})
    recalculada = Operacion(1, "AAA", DIA + timedelta(days=1), 101,
                           DIA + timedelta(days=5), 112, "objetivo", 17)
    monkeypatch.setattr(omega.motor, "simular", lambda *args: [recalculada])
    auditorias = []
    monkeypatch.setattr(omega, "auditar", lambda *args: auditorias.append(args[3]))
    res = omega.sincronizar(db, j, j.dia_fin)
    assert res["nuevas"] == 0 and res["cerradas"] == 1
    assert res["discrepancias"] == 1
    assert auditorias[0]["discrepancias"] == 1
    assert "Entrada discrepante" in caplog.text
    updates = [(sql, p) for sql, p in db.escrituras if "update liga.omega_operaciones" in sql]
    assert len(updates) == 1 and updates[0][1]["i"] == 9
    assert "entrada_dia =" not in updates[0][0]
    assert not any("insert into liga.omega_operaciones" in sql for sql, _ in db.escrituras)


def test_simulacion_recibe_la_entrada_guardada(monkeypatch):
    db = PersistenciaDB()
    j = SimpleNamespace(id=1, dia_base=DIA - timedelta(days=1),
                        dia_fin=DIA + timedelta(days=30), temporada_id=1)
    fila = SimpleNamespace(id=9, numero=1, ticker="AAA", entrada_dia=DIA,
                           entrada_precio=100, salida_dia=None, salida_precio=None,
                           motivo=None, senal_id=17)
    monkeypatch.setattr(omega, "capturar_alertas", lambda *args: 0)
    monkeypatch.setattr(omega, "_arrastre", lambda *args: [])
    monkeypatch.setattr(omega, "_propias", lambda *args: [fila])
    monkeypatch.setattr(omega, "alertas", lambda *args: [])
    monkeypatch.setattr(omega.precios, "series", lambda *args: {
        "AAA": [Cierre(DIA + timedelta(days=n), p)
                for n, p in enumerate([100, 100, 101, 102, 112]) ]})
    monkeypatch.setattr(omega, "auditar", lambda *args: None)
    res = omega.sincronizar(db, j, DIA + timedelta(days=4))
    assert res["nuevas"] == 0 and res["cerradas"] == 1


def test_cierre_incluye_omega_sin_empresas(monkeypatch):
    from app.liga.procesos import cerrar

    db = PersistenciaDB()
    db.flush = lambda: None
    db.commit = lambda: None
    j = SimpleNamespace(id=1, dia_fin=DIA, temporada_id=1)
    monkeypatch.setattr(cerrar, "jornada_bloqueada", lambda *args: j)
    monkeypatch.setattr(cerrar, "motivos_no_lista", lambda *args: [])
    monkeypatch.setattr(omega, "sincronizar", lambda *args: {})
    monkeypatch.setattr(cerrar, "calcular", lambda *args: {
        "sp_rentabilidad": Decimal(0), "filas": [{"inscripcion_id": 7,
        "estado": "sin_empresas", "rentabilidad": Decimal("2.0000"), "puntos": 3}]})
    monkeypatch.setattr(cerrar, "auditar", lambda *args: None)
    cerrar._escribir(db, 1, None, False)
    resultados = [p for sql, p in db.escrituras if "insert into liga.resultados" in sql]
    assert resultados == [{"i": 7, "r": Decimal("2.0000"), "p": 3}]


def test_ficha_cartera_abierta_y_serie_de_huecos(monkeypatch):
    from contextlib import nullcontext

    from app.liga.procesos import comun

    fin = DIA + timedelta(days=1)
    j = SimpleNamespace(id=1, numero=1, dia_base=DIA, dia_fin=fin, estado="formada")
    db = SimpleNamespace(execute=lambda *args: SimpleNamespace(all=lambda: [(j, 52)]))
    monkeypatch.setattr(comun, "sesion", lambda *args: nullcontext(db))
    monkeypatch.setattr(comun, "hoy_bolsa", lambda: fin)
    ops = [Operacion(1, "AAA", DIA, 100),
           Operacion(2, "BBB", DIA, 100, fin, 110, "objetivo")]
    monkeypatch.setattr(omega, "operaciones", lambda *args: ops)
    monkeypatch.setattr(omega.precios, "series", lambda *args: {
        "SPY": [Cierre(DIA, 100), Cierre(fin, 101)]})
    monkeypatch.setattr(omega, "rentabilidad", lambda db, j, dia: (
        Decimal(0) if dia == DIA else Decimal(4), []))
    cartera, serie = omega.datos_ficha("00000000-0000-0000-0000-000000000001", False)
    assert cartera == [
        {"numero": 1, "ticker": "AAA", "entrada_dia": DIA, "entrada_precio": 100,
         "salida_dia": None, "salida_precio": None, "peso": 20.0},
        {"numero": 2, "ticker": "BBB", "entrada_dia": DIA, "entrada_precio": 100,
         "salida_dia": fin, "salida_precio": 110, "peso": 20.0},
    ]
    assert serie["serie"][-1]["estrategia"] == pytest.approx(4)
    assert serie["serie"][-1]["provisional"] is True
    assert serie["serie"][-1]["jornada_total"] == 52


def test_calculo_omega_sin_empresas_usa_media_real(monkeypatch):
    from app.liga.procesos import diario

    fin = DIA + timedelta(days=1)
    j = SimpleNamespace(id=1, dia_base=DIA, dia_fin=fin)
    fila = SimpleNamespace(id=7, estrategia_id="omega", estado="sin_empresas", nombre="Omega",
                           tipo="casa", casa_clave="omega")
    db = SimpleNamespace(execute=lambda *args: SimpleNamespace(all=lambda: [fila]))
    monkeypatch.setattr(diario.datos, "posiciones", lambda *args: {7: []})
    monkeypatch.setattr(omega, "operaciones", lambda *args: [Operacion(1, "AAA", DIA, 100)])
    monkeypatch.setattr(omega.precios, "series", lambda *args: {
        "SPY": [Cierre(DIA, 100), Cierre(fin, 101)],
        "AAA": [Cierre(DIA, 100), Cierre(fin, 110)]})
    calculo = diario.calcular(db, j, fin)
    assert calculo["filas"][0]["rentabilidad"] == Decimal("2.0000")
    assert calculo["filas"][0]["inscripcion_id"] == 7
    assert calculo["por_ticker"]["AAA"]["precio"] == 110


def test_retorno_desde_entrada():
    assert omega.retorno_desde_entrada(100, 110) == 10.0
    assert omega.retorno_desde_entrada(100, None) is None
    assert omega.retorno_desde_entrada(None, 110) is None
    assert omega.retorno_desde_entrada(10, 9) == -10.0


def test_historial_guardado_no_se_solapa_con_alerta_capturada_tarde():
    salida = DIA + timedelta(days=4)
    guardada = Operacion(1, "AAA", DIA, 100, salida, 112, "objetivo", 17)
    cierres = {"BBB": [Cierre(DIA + timedelta(days=i), 100) for i in range(6)]}
    alerta = Alerta("BBB", datetime(2026, 10, 1, 12), 20, senal_id=18)
    ops = simular([guardada], [alerta], cierres, DIA, DIA + timedelta(days=5), n_huecos=1)
    nueva = next(op for op in ops if op.ticker == "BBB")
    assert nueva.entrada_dia == salida


def test_segunda_abierta_se_rechaza_con_auditoria(monkeypatch, caplog):
    db = PersistenciaDB()
    j = SimpleNamespace(id=1, dia_base=DIA - timedelta(days=1), dia_fin=DIA, temporada_id=1)
    fila = SimpleNamespace(id=9, numero=1, ticker="AAA", entrada_dia=DIA,
                           entrada_precio=100, salida_dia=None, salida_precio=None,
                           motivo=None, senal_id=17)
    monkeypatch.setattr(omega, "capturar_alertas", lambda *args: 0)
    monkeypatch.setattr(omega, "_arrastre", lambda *args: [])
    monkeypatch.setattr(omega, "_propias", lambda *args: [fila])
    monkeypatch.setattr(omega, "alertas", lambda *args: [])
    monkeypatch.setattr(omega.precios, "series", lambda *args: {})
    monkeypatch.setattr(omega.motor, "simular", lambda *args: [
        Operacion(1, "BBB", DIA, 100, senal_id=18)])
    auditorias = []
    monkeypatch.setattr(omega, "auditar", lambda *args: auditorias.append(args[3]))
    res = omega.sincronizar(db, j, DIA)
    assert res["nuevas"] == 0 and res["discrepancias"] == 1
    assert auditorias[0]["discrepancias"] == 1
    assert "Conflicto de hueco" in caplog.text
    assert not any("insert into liga.omega_operaciones" in sql for sql, _ in db.escrituras)
