"""La receta vigente se evalúa sobre la imagen global, sin necesitar inscripciones."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.liga import estrategias
from app.liga import preview_seleccion as preview
from app.liga import rutas_estrategias as rutas
from app.liga.auth import Identidad
from app.liga.motor.catalogo import CATALOGO_VERSION, EmpresaFoto
from app.liga.motor.seleccion import NotasJev


@pytest.fixture
def escenario(monkeypatch):
    motor = create_engine("sqlite://")
    conexion = motor.connect()
    conexion.execute(text("attach database ':memory:' as liga"))
    conexion.execute(text(
        "create table liga.jornadas "
        "(id integer, dia_base integer, estado text, foto_id integer, scan_run_id integer)"
    ))
    conexion.commit()
    sesiones = []

    def sistema():
        db = Session(bind=conexion)
        db.close = Mock(wraps=db.close)
        sesiones.append(db)
        return db

    monkeypatch.setattr(estrategias, "fabrica_sistema", sistema)
    receta = SimpleNamespace(
        reglas=[], excluidas=["X"], pregunta=None, peso_negocio=50,
        peso_precio=0, peso_deuda=0, peso_pronto=0, peso_pregunta=0,
        n_empresas=3, reparto="igual", max_por_sector=0,
        catalogo_version=CATALOGO_VERSION,
    )
    empresas = {10: [EmpresaFoto("X")], 20: [EmpresaFoto("OTRA")]}
    notas = {100: {}, 200: {"X": NotasJev(9, 9, 9, 9)}}
    leer_empresas = Mock(side_effect=lambda db, fid: empresas[fid])
    leer_notas = Mock(side_effect=lambda db, sid: notas[sid])
    monkeypatch.setattr(estrategias.procesos_datos, "cargar_empresas", leer_empresas)
    monkeypatch.setattr(estrategias.procesos_datos, "cargar_notas", leer_notas)
    monkeypatch.setattr(estrategias, "_cache_ctx", estrategias.OrderedDict())
    actual = {"foto": 10, "scan": 200}
    monkeypatch.setattr(
        estrategias, "foto_y_notas_actuales",
        lambda: estrategias.foto_y_notas_jornada(actual["foto"], actual["scan"]),
    )
    monkeypatch.setattr(rutas, "_exigir_calculo_disponible", lambda uid: None)
    receta_de = Mock(return_value=receta)
    monkeypatch.setattr(rutas, "_receta_de", receta_de)
    monkeypatch.setattr(estrategias, "respuestas_sistema", lambda *_: {})
    monkeypatch.setattr(preview._LIMITE_PREVIEW, "permitido", lambda uid: True)
    usuario = Mock()
    eid = uuid4()
    ident = Identidad(uid="usuario", aal="aal1", claims={})

    def jornada(jid=1, estado="formada", foto=10, scan=100, dia=None):
        conexion.execute(text("insert into liga.jornadas values (:j, :d, :estado, :f, :s)"),
                         {"j": jid, "d": jid if dia is None else dia,
                          "estado": estado, "f": foto, "s": scan})
        conexion.commit()

    def consultar():
        return rutas.por_que(eid, "X", ident, usuario)

    def previsualizar():
        body = preview.PreviewSeleccionIn(
            pesos={"negocio": 50, "precio": 0, "deuda": 0, "pronto": 0, "pregunta": 0},
            n_empresas=3, reparto="igual", max_por_sector=0,
        )
        return preview.previsualizar(body, ident)

    try:
        yield SimpleNamespace(
            jornada=jornada, consultar=consultar, previsualizar=previsualizar,
            actual=actual, receta=receta, receta_de=receta_de, usuario=usuario, eid=eid,
            leer_empresas=leer_empresas, leer_notas=leer_notas, sesiones=sesiones,
        )
    finally:
        for db in sesiones:
            db.close.assert_called_once_with()
        conexion.close()
        motor.dispose()


def test_formada_conserva_foto_y_escaneo_sin_inscripciones(escenario):
    escenario.jornada()
    antes = escenario.consultar()
    escenario.actual.update(foto=20, scan=200)
    assert escenario.consultar() == antes
    assert escenario.leer_empresas.call_args.args[1] == 10
    assert escenario.leer_notas.call_args.args[1] == 100
    escenario.usuario.execute.assert_not_called()


def test_receta_es_la_ultima_de_la_estrategia(escenario):
    escenario.jornada(scan=200)
    antes = escenario.consultar()
    escenario.receta_de.assert_called_once_with(escenario.usuario, escenario.eid)
    escenario.receta.excluidas = []
    assert escenario.consultar().motivo != antes.motivo


@pytest.mark.parametrize("imagen", [None, (None, None), (None, 100), (10, None)])
def test_sin_imagen_designada_usa_foto_actual(escenario, imagen):
    if imagen is not None:
        escenario.jornada(estado="programada", foto=imagen[0], scan=imagen[1])
    escenario.receta.excluidas = []
    antes = escenario.consultar()
    escenario.actual.update(foto=20, scan=200)
    assert escenario.consultar().motivo != antes.motivo


@pytest.mark.parametrize("foto,scan", [(10, 100), (None, None), (None, 100), (10, None)])
def test_programada_designada_es_referencia_o_cae_a_formada(escenario, foto, scan):
    escenario.jornada(foto=20, scan=200)
    escenario.jornada(jid=2, estado="programada", foto=foto, scan=scan)
    esperado = (10, 100) if foto is not None and scan is not None else (20, 200)
    assert estrategias.jornada_de_referencia() == esperado
    escenario.consultar()
    assert escenario.leer_empresas.call_args.args[1] == esperado[0]
    assert escenario.leer_notas.call_args.args[1] == esperado[1]


def test_orden_por_dia_y_desempate_por_id(escenario):
    escenario.jornada()
    escenario.jornada(jid=2, estado="cerrada", foto=20, scan=200)
    escenario.jornada(jid=3, estado="programada", dia=2)
    assert estrategias.jornada_de_referencia() == (10, 100)
    escenario.jornada(jid=4, dia=1, foto=20, scan=200)
    assert estrategias.jornada_de_referencia() == (10, 100)


def test_estado_no_elegible_no_es_referencia(escenario):
    escenario.jornada()
    escenario.jornada(jid=2, estado="cancelada", foto=20, scan=200)
    assert estrategias.jornada_de_referencia() == (10, 100)


@pytest.mark.parametrize("estado", ["formada", "programada"])
def test_preview_sin_estrategia_usa_referencia(escenario, estado):
    escenario.jornada(estado=estado)
    assert "estrategia_id" not in preview.PreviewSeleccionIn.model_fields
    resultado = escenario.previsualizar()
    assert (resultado.foto_id, resultado.scan_run_id) == (10, 100)
    assert resultado.seleccionadas == 0


def test_preview_sin_jornada_usa_hoy(escenario):
    resultado = escenario.previsualizar()
    assert (resultado.foto_id, resultado.scan_run_id) == (10, 200)
    assert resultado.seleccionadas == 1


@pytest.mark.parametrize("codigo", [404, 409, 503])
def test_preview_mantiene_manejo_de_errores(escenario, monkeypatch, codigo):
    monkeypatch.setattr(estrategias, "contexto_de_referencia",
                        Mock(side_effect=HTTPException(codigo, "Sin datos")))
    if codigo in (404, 409):
        assert escenario.previsualizar().estado == "sin_datos"
    else:
        with pytest.raises(HTTPException) as exc:
            escenario.previsualizar()
        assert exc.value.status_code == codigo


def test_preview_mantiene_limite_de_frecuencia(escenario, monkeypatch):
    monkeypatch.setattr(preview._LIMITE_PREVIEW, "permitido", lambda uid: False)
    with pytest.raises(HTTPException) as exc:
        escenario.previsualizar()
    assert exc.value.status_code == 429
    assert not escenario.sesiones


def test_referencia_cierra_sesion_si_falla_consulta(monkeypatch):
    db = Mock()
    db.execute.side_effect = RuntimeError("Fallo de consulta")
    monkeypatch.setattr(estrategias, "fabrica_sistema", lambda: db)
    with pytest.raises(RuntimeError, match="Fallo de consulta"):
        estrategias.jornada_de_referencia()
    db.close.assert_called_once_with()
