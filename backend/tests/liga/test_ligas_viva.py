from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.liga import comparativa, rutas_ligas


def _acumulado(retorno):
    return dict(rentabilidad=Decimal(retorno), sp500=Decimal("1"),
                diferencia_pp=Decimal(retorno) - 1, desde=date(2026, 1, 1),
                hasta=date(2026, 9, 30), periodos=1, incompleta=False)


def _miembro(eid, puntos, dif):
    datos = dict(liga_id="liga", alias=eid, usuario_id=eid,
                 unido=datetime(2026, 1, 1), estrategia_id=eid, puntos=puntos,
                 jornadas=1, dif_sp=Decimal(dif), nombre=eid, forma="escudo",
                 dibujo="liso", color1="#000000", color2="#ffffff", iniciales=None,
                 visibilidad="publicada", inscripcion_id=eid)
    return SimpleNamespace(**datos, _mapping=datos)


@pytest.fixture
def escenario(monkeypatch):
    liga_id = UUID("00000000-0000-0000-0000-000000000001")
    liga = SimpleNamespace(id=liga_id, dueno_id="a", nombre="Liga", codigo="ABC",
                           cupo=50, oculta=False, creada=datetime(2026, 1, 1))
    jornada = SimpleNamespace(id=2, numero=2, dia_base=date(2026, 9, 30))
    miembros = [_miembro("a", 6, "2"), _miembro("b", 3, "1"), _miembro("c", 0, "-1")]
    cerrado = _acumulado("2")
    acumulado_vivo = _acumulado("12")
    vivas = {
        "b": comparativa.FilaViva("b", 9, 2, 2, 0, 0, Decimal("5"), acumulado_vivo),
        "c": comparativa.FilaViva("c", 0, 2, 0, 0, 2, Decimal("-2"), None),
    }
    vivo = dict(dia=date(2026, 10, 9), sp=Decimal("1"), en_vivo=True,
                por_inscripcion={"b": {"rentabilidad": Decimal("4"), "dif": Decimal("3")}})
    estado = SimpleNamespace(jornada=jornada, temporada=1, activo=True, vivas=vivas,
                             vivo=vivo, llamadas=[])

    class Db:
        def execute(self, consulta, params=None):
            assert "from liga.ligas_privadas where id" in str(consulta)
            return SimpleNamespace(one_or_none=lambda: liga)

    db = Db()
    monkeypatch.setattr(rutas_ligas, "_temporada_actual", lambda _db: estado.temporada)
    monkeypatch.setattr(rutas_ligas, "_jornada_formada", lambda *_a: estado.jornada)
    monkeypatch.setattr(rutas_ligas, "_miembros", lambda *_a: miembros)
    monkeypatch.setattr(rutas_ligas.gestion, "_ajuste_booleano", lambda *_a: estado.activo)
    monkeypatch.setattr(rutas_ligas.diario, "vivo", lambda jid: estado.vivo)
    monkeypatch.setattr(rutas_ligas, "retornos_acumulados", lambda *_a: {
        eid: dict(cerrado) for eid in ("a", "b", "c")})
    monkeypatch.setattr(rutas_ligas, "movimientos_grupo", lambda *_a: {"b": 1})

    def clasificacion(db_recibida, temporada, vivo_recibido, jornada_recibida):
        assert db_recibida is db
        assert temporada == 1
        assert vivo_recibido is vivo
        assert jornada_recibida is jornada
        estado.llamadas.append(True)
        return estado.vivas

    monkeypatch.setattr(rutas_ligas.comparativa, "clasificacion_viva", clasificacion)
    estado.respuesta = lambda: rutas_ligas.ver_liga(
        liga_id, ident=SimpleNamespace(uid="a"), db=db)
    estado.miembros = miembros
    return estado


def test_detalle_aplica_cifras_orden_y_acumulados_vivos(escenario):
    detalle = escenario.respuesta()
    assert [m.alias for m in detalle.miembros] == ["b", "a", "c"]
    b, a, c = detalle.miembros
    assert [m.provisional for m in detalle.miembros] == [True, False, True]
    assert (b.puntos, b.jornadas, b.dif_sp) == (9, 2, Decimal("5"))
    assert (c.puntos, c.jornadas, c.dif_sp) == (0, 2, Decimal("-2"))
    assert b.acumulado.rentabilidad == Decimal("12")
    assert a.acumulado.rentabilidad == Decimal("2")
    assert c.acumulado is None
    assert b.movimiento == 1
    assert (b.rentabilidad_mes, b.diferencia_mes) == (Decimal("4"), Decimal("3"))
    assert escenario.miembros[1].puntos == 3
    assert escenario.llamadas == [True]


@pytest.mark.parametrize("caso", ["apagada", "sin_jornada", "sin_temporada", "sin_sp", "sin_vivo"])
def test_detalle_conserva_cifras_cerradas(escenario, caso):
    if caso == "apagada":
        escenario.activo = False
    elif caso == "sin_jornada":
        escenario.jornada = None
    elif caso == "sin_temporada":
        escenario.temporada = None
    elif caso == "sin_sp":
        escenario.vivo["sp"] = None
    else:
        escenario.vivo = None
    miembros = escenario.respuesta().miembros
    assert [m.alias for m in miembros] == ["a", "b", "c"]
    assert [m.puntos for m in miembros] == [6, 3, 0]
    assert [m.jornadas for m in miembros] == [1, 1, 1]
    assert [m.dif_sp for m in miembros] == [Decimal("2"), Decimal("1"), Decimal("-1")]
    assert all(not m.provisional for m in miembros)
    assert all(m.acumulado.rentabilidad == Decimal("2") for m in miembros)
    assert escenario.llamadas == []


def test_liga_sin_miembros_con_valor_vivo_conserva_orden(escenario):
    escenario.vivas = {"ajena": escenario.vivas["b"]}
    miembros = escenario.respuesta().miembros
    assert [m.alias for m in miembros] == ["a", "b", "c"]
    assert [m.puntos for m in miembros] == [6, 3, 0]
    assert all(not m.provisional for m in miembros)
    assert all(m.acumulado.rentabilidad == Decimal("2") for m in miembros)


def test_orden_por_liga_puntos_diferencia_y_alias():
    filas = [_miembro("z", None, "0"), _miembro("b", 3, "2"),
             _miembro("a", 3, "2"), _miembro("c", 3, "1")]
    filas[0]._mapping["dif_sp"] = None
    otra = _miembro("otra", 99, "99")
    otra._mapping["liga_id"] = "otra"
    filas.append(otra)
    miembros = rutas_ligas._aplicar_clasificacion_viva(filas, {})
    assert [m.alias for m in miembros] == ["a", "b", "c", "z", "otra"]
