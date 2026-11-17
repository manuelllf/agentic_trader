"""Tareas y servicio del agente contra la base real de pruebas."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.agente import avisos, base, libro, servicio, tareas
from app.agente.config import ajustes
from app.agente.datos import Barra
from app.agente.models import Decision, Ejecucion, Ejecutada, Leccion, Noticia, Seguimiento
from app.agente.reloj import Tarea
from app.config import settings

NY = ZoneInfo("America/New_York")
D1, D2 = date(2026, 11, 17), date(2026, 11, 18)
_TABLAS = ("ejecuciones, eventos, seguimiento, decisiones, ordenes, ejecutadas, "
           "movimientos_caja, splits, precios, valor_diario, noticias, informes, gasto")


@pytest.fixture(autouse=True)
def _comision_fija(monkeypatch):
    monkeypatch.setattr(settings, "commission_per_share", 0.005)
    monkeypatch.setattr(settings, "commission_min", 1)
    monkeypatch.setattr(settings, "commission_max_pct", 1)


def _vaciar() -> None:
    with base.motor().begin() as cx:
        cx.execute(text(f"truncate table {', '.join('agente.' + t for t in _TABLAS.split(', '))} "
                        "restart identity cascade"))


@pytest.fixture
def base_real(url_base_agente: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Base de pruebas para código que abre sus propias sesiones; se vacía antes y después."""
    monkeypatch.setattr(ajustes, "database_url", url_base_agente)
    base.motor.cache_clear()
    _vaciar()
    try:
        yield
    finally:
        _vaciar()
        base.motor().dispose()
        base.motor.cache_clear()


def _ahora(dia: date, hora: int = 17, minuto: int = 30) -> datetime:
    return datetime(dia.year, dia.month, dia.day, hora, minuto, tzinfo=NY)


def _barra(dia: date, cierre: str, apertura: str | None = None) -> Barra:
    c = Decimal(cierre)
    a = Decimal(apertura) if apertura else None
    return Barra(dia, a, None, None, c, 1000, Decimal("0"), Decimal("1"))


def _falso(datos: dict[str, list[Barra]], llamadas: list | None = None):
    def descargar(tickers: list[str], desde: date) -> dict[str, list[Barra]]:
        if llamadas is not None:
            llamadas.append((list(tickers), desde))
        return {t: datos[t] for t in tickers if t in datos}
    return descargar


def _no_debe_llamarse(tickers: list[str], desde: date) -> dict[str, list[Barra]]:
    raise AssertionError("no debía descargar")


def _caida(tickers: list[str], desde: date) -> dict[str, list[Barra]]:
    raise RuntimeError("sin red")


def _ej(s: Session, tarea: Tarea, dia: date) -> Ejecucion:
    ej = tareas.reclamar(s, tarea, dia)
    assert ej is not None
    return ej


def _decision(s: Session) -> int:
    d = Decision(fecha_ny=D1, tipo="operar", propuesta={}, razonamiento="r", modelo="m")
    s.add(d)
    s.flush()
    return d.id


def _con_posicion(s: Session, ticker: str = "AAA") -> None:
    """Libro abierto con 10 acciones compradas a 100 el día D1."""
    libro.abrir_libro(s, D1)
    o = libro.crear_orden(s, _decision(s), ticker, "compra", D1, acciones=Decimal("10"))
    s.add(Ejecutada(orden_id=o.id, ejecutada_en=_ahora(D1, 9, 35), acciones=Decimal("10"),
                    precio=Decimal("100"), comision=Decimal("1")))
    o.estado = "ejecutada"
    s.flush()


def _eventos(s: Session) -> list:
    s.flush()
    return s.execute(text(
        "select origen, tipo, ticker, datos from agente.eventos order by id")).all()


def _cuenta(s: Session, tabla: str) -> int:
    return s.execute(text(f"select count(*) from agente.{tabla}")).scalar_one()


def test_reclamar_dos_veces_la_segunda_es_none(sesion_agente: Session) -> None:
    assert tareas.reclamar(sesion_agente, Tarea.DESPERTAR, D1) is not None
    assert tareas.reclamar(sesion_agente, Tarea.DESPERTAR, D1) is None
    assert tareas.reclamar(sesion_agente, Tarea.DESPERTAR, D2) is not None


def test_reclamar_hecha_no_se_repite(sesion_agente: Session) -> None:
    ej = _ej(sesion_agente, Tarea.EJECUCION, D1)
    tareas.terminar(sesion_agente, ej, None)
    assert ej.estado == "hecha"
    assert tareas.reclamar(sesion_agente, Tarea.EJECUCION, D1) is None


def test_reclamar_fallida_un_unico_reintento(sesion_agente: Session) -> None:
    s = sesion_agente
    tareas.terminar(s, _ej(s, Tarea.DESPERTAR, D1), "boom")
    ej = tareas.reclamar(s, Tarea.DESPERTAR, D1)
    assert ej is not None
    assert ej.estado == "en_curso"
    assert ej.error == "reintento: boom"
    tareas.terminar(s, ej, "otra vez")
    assert ej.estado == "fallida"
    assert ej.error == "reintento: otra vez"
    assert tareas.reclamar(s, Tarea.DESPERTAR, D1) is None


def test_terminar_recorta_el_error(sesion_agente: Session) -> None:
    ej = _ej(sesion_agente, Tarea.DESPERTAR, D1)
    tareas.terminar(sesion_agente, ej, "x" * 5000)
    assert len(ej.error) == 2000


def test_tickers_vigilados_une_sin_duplicados(sesion_agente: Session) -> None:
    s = sesion_agente
    _con_posicion(s, "BBB")
    s.add_all([Seguimiento(ticker="AAA", motivo="m"), Seguimiento(ticker="BBB", motivo="m"),
               Seguimiento(ticker="CCC", motivo="m", hasta=date(2026, 11, 20))])
    assert tareas.tickers_vigilados(s) == ["AAA", "BBB"]


def test_despertar_sin_tickers_abre_el_libro(sesion_agente: Session) -> None:
    s = sesion_agente
    tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _no_debe_llamarse)
    assert libro.caja(s) == Decimal("5000")
    fila = s.execute(text(
        "select caja, valor_posiciones, valor_total from agente.v_valor_diario "
        "where fecha = :f"), {"f": D2}).one()
    assert (fila.caja, fila.valor_posiciones, fila.valor_total) == (5000, 0, 5000)


def test_despertar_con_nivel_cruzado_avisa(sesion_agente: Session) -> None:
    s = sesion_agente
    _con_posicion(s)
    s.add(Seguimiento(ticker="AAA", motivo="m", niveles=[
        {"precio": "105", "direccion": "arriba", "motivo": "ruptura"}]))
    llamadas: list = []
    barras = {"AAA": [_barra(D1, "100"), _barra(D2, "106")]}
    tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _falso(barras, llamadas))

    assert llamadas == [(["AAA"], D2 - timedelta(days=400))]
    assert _cuenta(s, "precios") == 2
    ev = _eventos(s)
    cruce = next(e for e in ev if e.tipo == "nivel_cruzado")
    assert (cruce.origen, cruce.ticker, cruce.datos) == ("vigia", "AAA", {"valor": "105"})
    assert ev[-2].tipo == "ciclo_pendiente"
    assert _cuenta(s, "valor_diario") == 1


def test_despertar_sin_precios_de_la_mayoria_falla(sesion_agente: Session) -> None:
    s = sesion_agente
    for t in ("AAA", "BBB", "CCC"):
        s.add(Seguimiento(ticker=t, motivo="m"))
    s.flush()
    with pytest.raises(RuntimeError, match="sin precios para 3 de 3"):
        tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _falso({}))


def test_despertar_con_pocos_sin_precios_sigue_y_lo_anota(sesion_agente: Session) -> None:
    s = sesion_agente
    for t in ("AAA", "BBB", "CCC", "DDD"):
        s.add(Seguimiento(ticker=t, motivo="m"))
    s.flush()
    barras = {"AAA": [_barra(D1, "100"), _barra(D2, "101")],
              "BBB": [_barra(D1, "50"), _barra(D2, "51")],
              "CCC": [_barra(D1, "20"), _barra(D2, "21")]}
    tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _falso(barras))
    assert _cuenta(s, "precios") == 6
    sin = [e for e in _eventos(s) if e.tipo == "sin_datos"]
    assert len(sin) == 1 and sin[0].datos == {"tickers": ["DDD"]}


def test_despertar_sin_cierre_de_hoy_no_guarda_valor(sesion_agente: Session) -> None:
    s = sesion_agente
    _con_posicion(s)
    barras = {"AAA": [_barra(D1, "100")]}
    tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _falso(barras))
    ev = _eventos(s)
    assert [(e.tipo, e.datos) for e in ev] == [("sin_cierre", {"tickers": ["AAA"]})]
    assert _cuenta(s, "valor_diario") == 0


def test_despertar_registra_dividendos(sesion_agente: Session) -> None:
    s = sesion_agente
    _con_posicion(s)
    dia = Barra(D2, None, None, None, Decimal("100"), 1, Decimal("0.5"), Decimal("1"))
    barras = {"AAA": [_barra(D1, "100"), dia]}
    tareas.hacer_despertar(s, _ej(s, Tarea.DESPERTAR, D2), D2, _falso(barras))
    n = s.execute(text(
        "select importe from agente.movimientos_caja where tipo = 'dividendo'")).scalar_one()
    assert n == Decimal("5.00")


def _orden_pendiente(s: Session) -> int:
    libro.abrir_libro(s, D1)
    o = libro.crear_orden(s, _decision(s), "AAA", "compra", D2, acciones=Decimal("10"))
    return o.id


def test_ejecucion_ejecuta_la_orden_con_la_apertura(sesion_agente: Session) -> None:
    s = sesion_agente
    orden_id = _orden_pendiente(s)
    barras = {"AAA": [_barra(D1, "100"), _barra(D2, "101", apertura="100")]}
    tareas.hacer_ejecucion(s, _ej(s, Tarea.EJECUCION, D2), D2, _ahora(D2, 9, 35), _falso(barras))
    estado = s.execute(text("select estado from agente.ordenes where id = :i"),
                       {"i": orden_id}).scalar_one()
    assert estado == "ejecutada"
    ev = _eventos(s)
    assert [(e.origen, e.tipo, e.ticker) for e in ev] == [("ejecutor", "orden_ejecutada", "AAA")]


def test_ejecucion_compra_fracciones_por_importe(sesion_agente: Session) -> None:
    s = sesion_agente
    libro.abrir_libro(s, D1)
    libro.crear_orden(s, _decision(s), "MSFT", "compra", D2, importe=Decimal("300"))
    barras = {"MSFT": [_barra(D1, "518"), _barra(D2, "520", apertura="517.99")]}
    tareas.hacer_ejecucion(s, _ej(s, Tarea.EJECUCION, D2), D2, _ahora(D2, 9, 35), _falso(barras))
    acciones = s.execute(text("select acciones from agente.ejecutadas")).scalar_one()
    # 300 $ menos su comisión (1 $), a 517,99: una fracción con cuatro decimales.
    assert acciones == Decimal("0.5772")


def test_preparacion_guarda_precios_y_fundamentales(sesion_agente: Session) -> None:
    s = sesion_agente
    for t in ("AAA", "BBB", "CCC"):
        s.add(Seguimiento(ticker=t, motivo="m"))
    barras = {t: [_barra(D1, "10"), _barra(D2, "11")] for t in ("AAA", "BBB", "CCC")}

    def leer(t: str) -> dict:
        if t == "CCC":
            raise TimeoutError("Yahoo no contesta")
        return {"forwardPE": 12.0, "next_earnings_date": date(2027, 1, 27)}

    tareas.hacer_preparacion(s, _ej(s, Tarea.PREPARACION, D2), D2, _falso(barras), leer)
    assert _cuenta(s, "precios") == 6
    filas = s.execute(text("select ticker, fecha_ny, datos from agente.fundamentales "
                           "order by ticker")).all()
    assert [(f.ticker, f.fecha_ny) for f in filas] == [("AAA", D2), ("BBB", D2)]
    assert filas[0].datos == {"forwardPE": 12.0, "next_earnings_date": "2027-01-27"}
    ev = [e for e in _eventos(s) if e.tipo == "preparacion"]
    assert ev[0].datos == {"empresas": 3, "fundamentales": 2, "sin_fundamentales": ["CCC"]}
    # Al día siguiente se sobrescribe: una fila por empresa, sin crecer.
    tareas.hacer_preparacion(s, _ej(s, Tarea.PREPARACION, D2 + timedelta(days=1)),
                             D2 + timedelta(days=1), _falso(barras), lambda t: {"forwardPE": 9.0})
    assert _cuenta(s, "fundamentales") == 3


def test_preparacion_sin_fundamentales_de_la_mayoria_falla(sesion_agente: Session) -> None:
    s = sesion_agente
    for t in ("AAA", "BBB"):
        s.add(Seguimiento(ticker=t, motivo="m"))
    barras = {t: [_barra(D2, "11")] for t in ("AAA", "BBB")}

    def roto(t: str) -> dict:
        raise TimeoutError("sin Yahoo")

    with pytest.raises(RuntimeError, match="sin fundamentales"):
        tareas.hacer_preparacion(s, _ej(s, Tarea.PREPARACION, D2), D2, _falso(barras), roto)


def test_ejecucion_sin_apertura_de_hoy_deja_la_orden_pendiente(sesion_agente: Session) -> None:
    s = sesion_agente
    orden_id = _orden_pendiente(s)
    barras = {"AAA": [_barra(D1, "100"), _barra(D2, "101")]}
    tareas.hacer_ejecucion(s, _ej(s, Tarea.EJECUCION, D2), D2, _ahora(D2, 9, 35), _falso(barras))
    estado = s.execute(text("select estado from agente.ordenes where id = :i"),
                       {"i": orden_id}).scalar_one()
    assert estado == "pendiente"
    assert _eventos(s) == []


def test_consolidacion_borra_solo_lo_caducado(sesion_agente: Session) -> None:
    s = sesion_agente
    ahora = datetime.now(NY)
    s.add_all([
        Noticia(url="u1", titulo="t", fuente="f", resumen="r", caduca=ahora - timedelta(days=1)),
        Noticia(url="u2", titulo="t", fuente="f", resumen="r", caduca=ahora + timedelta(days=1))])
    s.flush()
    tareas.hacer_consolidacion(s, _ej(s, Tarea.CONSOLIDACION, D2), D2)
    urls = s.execute(text("select url from agente.noticias")).scalars().all()
    assert urls == ["u2"]
    assert _eventos(s)[-1].datos == {"noticias_borradas": 1}


def test_consolidacion_con_ia_juzga_las_lecciones_pendientes(sesion_agente: Session,
                                                             monkeypatch) -> None:
    s = sesion_agente
    monkeypatch.setattr(ajustes, "ia_activa", True)
    d = Decision(fecha_ny=D1, tipo="nada", propuesta={}, razonamiento="r", modelo="m")
    s.add(d)
    s.flush()
    s.add(Leccion(texto="Una lección suficientemente larga", decision_ids=[d.id]))

    class Revisor:
        usage = {"cost_usd": 0.0}

        def chat(self, system: str, user: str, **_: object) -> str:
            return '{"verdict": "approve", "reason": "ok"}'

        def chat_con_herramientas(self, mensajes: list, *_a: object, **_k: object) -> dict:
            return {"content": '{"verdict": "approve", "reason": "ok"}', "tool_calls": [],
                    "mensaje": {"role": "assistant", "content": None}}
    tareas.hacer_consolidacion(s, _ej(s, Tarea.CONSOLIDACION, D2), D2, revisor_llm=Revisor())
    datos_ev = [e.datos for e in _eventos(s) if e.tipo == "consolidacion"][0]
    assert datos_ev["lecciones_aprobadas"] == 1
    assert (datos_ev["propuestas_en_sombra"], datos_ev["filosofias_adoptadas"]) == (0, 0)


def test_vigia_previo_deja_constancia(sesion_agente: Session) -> None:
    s = sesion_agente
    tareas.hacer_vigia_previo(s, _ej(s, Tarea.VIGIA_PREVIO, D2), D2)
    assert [e.tipo for e in _eventos(s)] == ["vigia_previo_sin_fuente"]


def test_correr_fallida_no_deja_nada_a_medias(base_real: None) -> None:
    with base.sesion() as s:
        s.add(Seguimiento(ticker="AAA", motivo="m"))
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _caida) is False
    with base.sesion() as s:
        fila = s.execute(text("select estado, error, terminada from agente.ejecuciones")).one()
        assert fila.estado == "fallida"
        assert "sin red" in fila.error
        assert fila.terminada is not None
        assert _cuenta(s, "precios") == 0
        assert _cuenta(s, "movimientos_caja") == 0
        assert _cuenta(s, "ejecuciones") == 1
    # Un único reintento: el segundo fallo se queda marcado y no se reclama más.
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _caida) is False
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _no_debe_llamarse) is False
    with base.sesion() as s:
        assert s.execute(text("select estado from agente.ejecuciones")).scalar_one() == "fallida"


def test_tarea_fallida_avisa_y_el_aviso_espera_a_que_vennett_responda(
        base_real: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "vennett_url", "http://vennett.test")
    monkeypatch.setattr(ajustes, "vennett_clave_servicio", "clave")
    enviados: list[tuple[str, dict]] = []
    caido = {"si": True}

    def enviar(tipo: str, datos: dict) -> None:
        if caido["si"]:
            raise ConnectionError("vennett caído")
        enviados.append((tipo, datos))
    monkeypatch.setattr(avisos, "enviar_http", enviar)

    with base.sesion() as s:
        s.add(Seguimiento(ticker="AAA", motivo="m"))
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _caida) is False
    with base.sesion() as s:
        assert len(avisos.pendientes(s)) == 1
    # Vennett vuelve: la siguiente tarea entrega lo pendiente, aunque no tenga nada que ver.
    caido["si"] = False
    assert tareas.correr(Tarea.VIGIA_PREVIO, D2, _ahora(D2, 8, 45), _no_debe_llamarse) is True
    assert [t for t, _ in enviados] == ["agente_tarea_fallida"]
    assert enviados[0][1]["tarea"] == "despertar"
    with base.sesion() as s:
        assert avisos.pendientes(s) == []


def test_correr_hecha_y_no_se_repite(base_real: None) -> None:
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _no_debe_llamarse) is True
    assert tareas.correr(Tarea.DESPERTAR, D2, _ahora(D2), _no_debe_llamarse) is False
    with base.sesion() as s:
        assert s.execute(text("select estado from agente.ejecuciones")).scalar_one() == "hecha"
        assert _cuenta(s, "valor_diario") == 1


def test_recuperar_perdidas_llama_solo_lo_que_falta(
        base_real: None, monkeypatch: pytest.MonkeyPatch) -> None:
    llamadas: list = []
    monkeypatch.setattr(servicio, "correr", lambda t, f, a: llamadas.append((t, f)) or True)
    with base.sesion() as s:
        s.add_all([Ejecucion(tarea=t.value, fecha_ny=D1, estado="hecha")
                   for t in (Tarea.VIGIA_PREVIO, Tarea.EJECUCION, Tarea.PREPARACION,
                             Tarea.DESPERTAR)])
    ahora = _ahora(D1, 18, 0)
    servicio.recuperar_perdidas(ahora)
    assert llamadas == [(Tarea.CONSOLIDACION, date(2026, 11, 16))]

    llamadas.clear()
    with base.sesion() as s:
        s.add(Ejecucion(tarea=Tarea.CONSOLIDACION.value, fecha_ny=date(2026, 11, 16),
                        estado="hecha"))
    servicio.recuperar_perdidas(ahora)
    assert llamadas == []


def test_planificador_un_trabajo_por_tarea() -> None:
    planificador = servicio.crear_planificador()
    ids = sorted(j.id for j in planificador.get_jobs())
    assert ids == sorted(f"agente_{t.value}" for t in Tarea)


def test_salud_forma_correcta(base_real: None, monkeypatch: pytest.MonkeyPatch) -> None:
    class _Falso:
        def start(self) -> None: ...
        def shutdown(self, wait: bool = True) -> None: ...

    monkeypatch.setattr(servicio, "crear_planificador", lambda: _Falso())
    monkeypatch.setattr(servicio, "recuperar_perdidas", lambda ahora: None)
    with base.sesion() as s:
        s.add_all([Ejecucion(tarea="despertar", fecha_ny=D1, estado="hecha"),
                   Ejecucion(tarea="ejecucion", fecha_ny=D2, estado="fallida")])
    r = TestClient(servicio.app).get("/salud")
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["ok"] is True
    assert cuerpo["parada"] is False
    assert cuerpo["ia"] == "cerrado"
    assert cuerpo["ultimas"] == [
        {"tarea": "ejecucion", "fecha_ny": "2026-11-18", "estado": "fallida"},
        {"tarea": "despertar", "fecha_ny": "2026-11-17", "estado": "hecha"}]


def test_salud_sin_base_da_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ajustes, "database_url", "")
    base.motor.cache_clear()
    try:
        r = TestClient(servicio.app).get("/salud")
    finally:
        base.motor.cache_clear()
    assert r.status_code == 503
    assert r.json() == {"ok": False}
