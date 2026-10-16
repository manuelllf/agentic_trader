from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.liga import comparativa as cp
from app.liga import rutas_publicas as rp


def _periodo(retorno, puntos=3, base="2026-08-31", fin="2026-09-30", temporada=1):
    return {
        "dia_base": date.fromisoformat(base), "dia_fin": date.fromisoformat(fin),
        "rentabilidad": Decimal(str(retorno)), "sp500": Decimal("1"),
        "puntos": puntos, "temporada_id": temporada, "jornada_id": 1, "numero": 1,
    }


class Resultado:
    def __init__(self, filas=(), una=None, total=0):
        self.filas, self.una, self.total = filas, una, total

    def all(self):
        return self.filas

    def mappings(self):
        return self

    def one_or_none(self):
        return self.una

    def scalar_one(self):
        return self.total


def _equipo(eid, puntos=3, dif="1"):
    datos = dict(
        eid=eid, nombre=eid, casa_clave=None, alias="ana",
        forma="circulo", dibujo="liso", color1="#000000", color2="#ffffff",
        iniciales=None, creada=datetime(2026, 1, 1), puntos=puntos, jornadas=1,
        ganadas=1, empatadas=0, perdidas=0, dif_sp=Decimal(dif),
    )
    return SimpleNamespace(**datos, _mapping=datos)


def _preparar(monkeypatch, formada=True, sp=Decimal("1")):
    jornada = SimpleNamespace(id=2, numero=2, dia_base=date(2026, 9, 30))
    temporada = rp.TemporadaOut(
        id=1, nombre="Liga", cuenta=True, estado="en_juego", n_jornadas=12)
    cerrados = {"a": [_periodo(10)], "b": [_periodo(1)], "c": [_periodo(2)]}
    oficiales = [_equipo("a"), _equipo("b"), _equipo("c")]
    vivo = {
        "dia": date(2026, 10, 9), "sp": sp,
        "por_inscripcion": {
            10: {"rentabilidad": Decimal("-5"), "puntos": 0},
            20: {"rentabilidad": Decimal("20"), "puntos": 3},
            30: {"rentabilidad": None, "puntos": None},
            40: {"rentabilidad": Decimal("3"), "puntos": 1},
        },
    }

    class Db:
        def execute(self, consulta, params=None):
            sql = str(consulta)
            if "select id, numero, dia_base" in sql:
                return Resultado(una=jornada if formada else None)
            if "select id::text as iid" in sql:
                return Resultado([{"iid": iid, "eid": eid}
                                  for iid, eid in (("10", "a"), ("20", "b"), ("40", "d"))])
            if "select count(*)" in sql:
                return Resultado(total=len(oficiales))
            if "from liga.v_clasificacion c" in sql:
                return Resultado(oficiales)
            if "from liga.estrategias e" in sql:
                return Resultado([_equipo("d")])
            raise AssertionError(sql)

    monkeypatch.setattr(rp, "_temporada", lambda *_a: temporada)
    monkeypatch.setattr(rp, "_clasificacion_viva_activa", lambda: True)
    monkeypatch.setattr(rp.diario, "vivo", lambda jid: vivo)
    monkeypatch.setattr(cp, "periodos_cerrados", lambda _db, ids: {
        eid: cerrados[eid] for eid in ids if eid in cerrados})
    monkeypatch.setattr(rp, "movimientos_clasificacion", lambda *_a: {"a": 2})
    return Db(), jornada, vivo, cerrados


def _clasificacion(db, orden="rentabilidad", desde=0, cuantos=50, alias=None):
    return rp.clasificacion(
        temporada=1, desde=desde, cuantos=cuantos, alias=alias,
        orden=orden, db=db, ident=None)


def test_periodo_provisional_compone_y_un_hueco_reinicia():
    cerrado = _periodo(10)
    provisional = _periodo(20, base="2026-09-30", fin="2026-10-09")
    resumen = cp.acumular_periodos([cerrado, provisional])
    assert resumen["rentabilidad"] == Decimal("32.0000")
    assert resumen["sp500"] == Decimal("2.0100")
    assert resumen["periodos"] == 2
    provisional["dia_base"] = date(2026, 10, 1)
    resumen = cp.acumular_periodos([cerrado, provisional])
    assert resumen["rentabilidad"] == Decimal("20.0000")
    assert resumen["periodos"] == 1 and resumen["incompleta"]


def test_suma_puntos_categorias_y_solo_marca_las_filas_con_valor_vivo(monkeypatch):
    db, jornada, vivo, _ = _preparar(monkeypatch)
    filas = cp.clasificacion_viva(db, 1, vivo, jornada)
    assert set(filas) == {"a", "b", "d"}
    assert (filas["a"].puntos, filas["a"].jornadas,
            filas["a"].ganadas, filas["a"].perdidas) == (3, 2, 1, 1)
    assert (filas["b"].puntos, filas["b"].ganadas) == (6, 2)
    assert (filas["d"].puntos, filas["d"].empatadas, filas["d"].jornadas) == (1, 1, 1)
    assert all(f.provisional for f in filas.values())
    respuesta = _clasificacion(db)
    assert respuesta.total == 4 and respuesta.jornada_provisional == 2
    assert {f.equipo.nombre: f.provisional for f in respuesta.filas} == {
        "a": True, "b": True, "c": False, "d": True}


def test_el_provisional_puede_cambiar_el_lider_y_pagina_con_mias(monkeypatch):
    db, _, _, cerrados = _preparar(monkeypatch)
    assert cp.acumular_periodos(cerrados["a"])["rentabilidad"] > (
        cp.acumular_periodos(cerrados["b"])["rentabilidad"])
    respuesta = _clasificacion(db, cuantos=1, alias=" ANA ")
    assert respuesta.filas[0].equipo.nombre == "b"
    assert respuesta.filas[0].acumulado.rentabilidad == Decimal("21.2000")
    assert [f.posicion for f in respuesta.mias] == [2, 3, 4]
    desplazada = _clasificacion(db, desde=1, cuantos=1, alias="ana")
    assert desplazada.filas[0].posicion == 2
    assert [f.posicion for f in desplazada.mias] == [1, 3, 4]


def test_desempate_de_puntos_usa_diferencia_y_movimientos_oficiales(monkeypatch):
    db, _, vivo, _ = _preparar(monkeypatch)
    vivo["por_inscripcion"][10] = {"rentabilidad": Decimal("0"), "puntos": 3}
    respuesta = _clasificacion(db, orden="puntos")
    assert [f.equipo.nombre for f in respuesta.filas[:2]] == ["b", "a"]
    assert [f.puntos for f in respuesta.filas[:2]] == [6, 6]
    assert respuesta.filas[0].dif_sp > respuesta.filas[1].dif_sp
    assert respuesta.filas[1].movimiento == 2


def test_diferencia_usa_toda_la_temporada_aunque_haya_huecos(monkeypatch):
    db, jornada, vivo, cerrados = _preparar(monkeypatch)
    cerrados["a"] = [
        _periodo(50, temporada=2),
        _periodo(10, base="2026-07-31", fin="2026-08-31"),
    ]
    fila = cp.clasificacion_viva(db, 1, vivo, jornada)["a"]
    assert fila.acumulado["rentabilidad"] == Decimal("-5.0000")
    assert fila.acumulado["incompleta"]
    assert fila.dif_sp == Decimal("2.4900")
    assert fila.puntos == 3 and fila.jornadas == 2


@pytest.mark.parametrize("orden", ["rentabilidad", "puntos"])
def test_interruptor_apagado_conserva_la_respuesta_cerrada(monkeypatch, orden):
    db, _, _, _ = _preparar(monkeypatch)
    monkeypatch.setattr(rp, "_clasificacion_viva_activa", lambda: False)
    monkeypatch.setattr(rp.diario, "vivo", lambda *_a: pytest.fail("vivo"))
    respuesta = _clasificacion(db, orden=orden)
    assert respuesta.total == 3
    assert respuesta.jornada_provisional is None
    assert all(not f.provisional for f in respuesta.filas)
    esperado = ["a", "c", "b"] if orden == "rentabilidad" else ["a", "b", "c"]
    assert [f.equipo.nombre for f in respuesta.filas] == esperado
    assert all(f.puntos == 3 and f.jornadas == 1 for f in respuesta.filas)


@pytest.mark.parametrize("caso", ["sin_jornada", "sin_vivo", "sin_sp"])
def test_sin_jornada_o_calculo_util_conserva_el_cierre(monkeypatch, caso):
    db, _, _, _ = _preparar(monkeypatch, formada=caso != "sin_jornada")
    monkeypatch.setattr(rp.diario, "vivo", lambda *_a: (
        {"sp": None} if caso == "sin_sp" else None))
    respuesta = _clasificacion(db)
    assert respuesta.total == 3 and respuesta.jornada_provisional is None
    assert all(not f.provisional for f in respuesta.filas)


def test_premio_no_depende_de_la_clasificacion_viva():
    liga = Path(__file__).resolve().parents[2] / "app" / "liga"
    for ruta in (liga / "procesos" / "premio.py", liga / "motor" / "premio.py"):
        texto = ruta.read_text(encoding="utf-8")
        assert "clasificacion_viva" not in texto
        assert "diario.vivo" not in texto


def test_acumulado_invalido_no_recupera_el_cerrado_y_queda_al_final(monkeypatch):
    db, _, vivo, _ = _preparar(monkeypatch)
    vivo["por_inscripcion"][20]["rentabilidad"] = Decimal("-101")
    respuesta = _clasificacion(db)
    assert respuesta.filas[-1].equipo.nombre == "b"
    assert respuesta.filas[-1].acumulado is None
    assert respuesta.filas[-1].provisional


def test_sin_valores_vivos_no_busca_inscripciones():
    class Db:
        def execute(self, *_a):
            pytest.fail("consulta")

    assert cp.clasificacion_viva(
        Db(), 1, {"por_inscripcion": {10: {"rentabilidad": None}}},
        SimpleNamespace(id=2)) == {}


def test_interruptor_consulta_el_ajuste_con_defecto_true(monkeypatch):
    llamadas = []
    monkeypatch.setattr(rp.gestion, "_ajuste_booleano",
                        lambda *args: llamadas.append(args) or True)
    assert rp._clasificacion_viva_activa()
    assert llamadas == [("liga.clasificacion_viva", True)]


def test_periodos_cerrados_conserva_filtros_orden_y_metadatos():
    periodo = _periodo(10)
    llamadas = []

    class Db:
        def execute(self, consulta, params):
            llamadas.append((str(consulta), params))
            return Resultado([dict(periodo, estrategia_id="a", creada=datetime(2026, 1, 1))])

    resultado = cp.periodos_cerrados(Db(), ["a", "a"])
    assert resultado == {"a": [periodo]}
    sql, params = llamadas[0]
    assert params == {"ids": ["a"]}
    assert "j.estado = 'cerrada'" in sql
    assert "r.rentabilidad is not null" in sql
    assert "j.sp_rentabilidad is not null" in sql
    assert "order by e.id, j.dia_base, j.id, i.id" in sql
    assert cp.periodos_cerrados(Db(), []) == {}
    assert len(llamadas) == 1


def test_acumulado_contiguo_y_puntos_tienen_sus_ambitos(monkeypatch):
    db, jornada, vivo, cerrados = _preparar(monkeypatch)
    cerrados["a"].insert(0, _periodo(
        10, base="2026-07-31", fin="2026-08-31", temporada=2))
    fila = cp.clasificacion_viva(db, 1, vivo, jornada)["a"]
    assert fila.acumulado["rentabilidad"] == Decimal("14.9500")
    assert fila.acumulado["periodos"] == 3
    assert fila.puntos == 3 and fila.jornadas == 2
    assert fila.dif_sp == Decimal("2.4900")
