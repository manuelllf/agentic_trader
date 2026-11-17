"""API del panel de admin contra la base real de pruebas, con la verificación del JWT sustituida."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.agente import api, base, libro, servicio
from app.agente.config import ajustes
from app.agente.models import Decision, Ejecucion, FichaMejora, LlamadaModelo, PlaybookVersion
from app.supabase_auth import Identidad

ADMIN = "11111111-1111-1111-1111-111111111111"
AJENO = "22222222-2222-2222-2222-222222222222"
_TABLAS = ("eventos, decisiones, ordenes, ejecutadas, movimientos_caja, precios, "
           "valor_diario, informes, fichas_mejora, lecciones, playbook_versiones, "
           "llamadas_modelo, ejecuciones")


def _vaciar() -> None:
    with base.motor().begin() as cx:
        cx.execute(text(f"truncate table {', '.join('agente.' + t for t in _TABLAS.split(', '))} "
                        "restart identity cascade"))
        # Se rehace la fila: un update dejaría rastro de auditoría que otras pruebas no esperan.
        cx.execute(text("delete from agente.estado"))
        cx.execute(text("insert into agente.estado (id) values (1)"))


@pytest.fixture
def cliente(url_base_agente: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(ajustes, "database_url", url_base_agente)
    monkeypatch.setattr(ajustes, "admin_ids", ADMIN)
    base.motor.cache_clear()
    _vaciar()
    try:
        yield TestClient(servicio.app)
    finally:
        _vaciar()
        base.motor().dispose()
        base.motor.cache_clear()


def _como(monkeypatch: pytest.MonkeyPatch, uid: str, aal: str = "aal2") -> dict[str, str]:
    monkeypatch.setattr(api, "verificar", lambda token: Identidad(uid=uid, aal=aal, claims={}))
    return {"Authorization": "Bearer token"}


def _decisiones(n: int) -> None:
    with base.sesion() as s:
        s.add_all([Decision(fecha_ny=date(2026, 11, 17), tipo="nada", propuesta={},
                            razonamiento="r" * 400, modelo="m") for _ in range(n)])


def test_sin_token_401_aal1_403_y_ajeno_404(cliente: TestClient,
                                            monkeypatch: pytest.MonkeyPatch) -> None:
    assert cliente.get("/v1/hoy").status_code == 401
    assert cliente.get("/v1/hoy", headers=_como(monkeypatch, ADMIN, "aal1")).status_code == 403
    assert cliente.get("/v1/hoy", headers=_como(monkeypatch, AJENO)).status_code == 404


def test_hoy_con_libro_abierto_da_caja_5000(cliente: TestClient,
                                            monkeypatch: pytest.MonkeyPatch) -> None:
    with base.sesion() as s:
        libro.abrir_libro(s, date(2026, 11, 17))
    r = cliente.get("/v1/hoy", headers=_como(monkeypatch, ADMIN))
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["cartera"]["caja"] == "5000"
    assert cuerpo["cartera"]["posiciones"] == []
    assert cuerpo["estado"]["parada"] is False
    assert cuerpo["estado"]["modo"] == "normal"
    assert cuerpo["ultima_decision"] is None
    assert cuerpo["despertares"]


def test_parada_cambia_estado_deja_evento_y_actor(cliente: TestClient,
                                                  monkeypatch: pytest.MonkeyPatch) -> None:
    cab = _como(monkeypatch, ADMIN)
    r = cliente.post("/v1/control/parada", json={"parada": True, "motivo": "revisión"}, headers=cab)
    assert r.status_code == 200
    assert r.json()["parada"] is True
    with base.sesion() as s:
        fila = s.execute(text(
            "select parada, parada_motivo, actualizado_por from agente.estado")).one()
        ev = s.execute(text("select origen, tipo, creado_por from agente.eventos")).all()
    assert tuple(fila) == (True, "revisión", f"admin:{ADMIN}")
    assert [tuple(e) for e in ev] == [("admin", "parada", f"admin:{ADMIN}")]

    cliente.post("/v1/control/parada", json={"parada": False}, headers=cab)
    assert cliente.get("/v1/control", headers=cab).json()["parada"] is False
    with base.sesion() as s:
        tipos = s.execute(text("select tipo from agente.eventos order by id")).scalars().all()
    assert tipos == ["parada", "reanudada"]


def test_control_muestra_la_prueba_y_revierte_solo_si_hay_adopcion(
        cliente: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    cab = _como(monkeypatch, ADMIN)
    c = cliente.get("/v1/control", headers=cab).json()
    assert (c["mejora"], c["revertible"]) == (None, False)
    assert cliente.post("/v1/control/filosofia/revertir", headers=cab).status_code == 409
    with base.sesion() as s:
        previa = PlaybookVersion(version=1, contenido="v1", motivo="nacimiento", estado="retirada")
        nueva = PlaybookVersion(version=2, contenido="v2", motivo="m", estado="vigente")
        s.add_all([previa, nueva])
        s.flush()
        s.add_all([
            FichaMejora(hipotesis="h", cambio="c", criterio_exito="e", regla_parada="p",
                        playbook_candidata_id=nueva.id, estado="adoptada",
                        resultado={"vigente_previa_id": previa.id}),
            FichaMejora(hipotesis="otra", cambio="c", criterio_exito="e", regla_parada="p",
                        estado="en_sombra", sombra_hasta=date(2026, 12, 1))])
    c = cliente.get("/v1/control", headers=cab).json()
    assert c["revertible"] is True
    assert (c["mejora"]["hipotesis"], c["mejora"]["sombra_hasta"]) == ("otra", "2026-12-01")
    r = cliente.post("/v1/control/filosofia/revertir", headers=cab)
    assert r.status_code == 200 and r.json()["revertible"] is False
    with base.sesion() as s:
        estados = s.execute(text("select version, estado from agente.playbook_versiones "
                                 "order by version")).all()
        ev = s.execute(text("select tipo, creado_por from agente.eventos")).all()
    assert [tuple(e) for e in estados] == [(1, "vigente"), (2, "retirada")]
    assert [tuple(e) for e in ev] == [("filosofia_revertida", f"admin:{ADMIN}")]


def test_decisiones_pagina_y_recorta(cliente: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _decisiones(5)
    cab = _como(monkeypatch, ADMIN)
    uno = cliente.get("/v1/decisiones?limite=3", headers=cab).json()
    assert [d["id"] for d in uno["items"]] == [5, 4, 3]
    assert uno["siguiente"] == 3
    assert len(uno["items"][0]["razonamiento"]) <= 281
    dos = cliente.get(f"/v1/decisiones?limite=3&antes_de={uno['siguiente']}", headers=cab).json()
    assert [d["id"] for d in dos["items"]] == [2, 1]
    assert dos["siguiente"] is None


def test_decision_inexistente_404_y_existente_completa(cliente: TestClient,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    _decisiones(1)
    cab = _como(monkeypatch, ADMIN)
    assert cliente.get("/v1/decisiones/99", headers=cab).status_code == 404
    d = cliente.get("/v1/decisiones/1", headers=cab).json()
    assert len(d["razonamiento"]) == 400
    assert d["ordenes"] == []


def _llamada(ej: int | None, ciclo: uuid.UUID | None, creado: datetime, paso: int,
             etapa: str = "agente") -> LlamadaModelo:
    return LlamadaModelo(ejecucion_id=ej, etapa=etapa, paso=paso, modelo="m", ciclo=ciclo,
                         enviado=[{"role": "user", "content": "c"}], respuesta=f"r{paso}",
                         creado=creado)


def test_llamadas_de_una_decision_por_su_ciclo(cliente: TestClient,
                                               monkeypatch: pytest.MonkeyPatch) -> None:
    mio, otro = uuid.uuid4(), uuid.uuid4()
    t = datetime(2026, 11, 17, 23, 46, tzinfo=UTC)
    with base.sesion() as s:
        s.add(Decision(fecha_ny=date(2026, 11, 17), tipo="nada", propuesta={}, razonamiento="r",
                       modelo="m", ciclo=mio))
        s.add_all([_llamada(None, mio, t, 1), _llamada(None, otro, t, 1),
                   _llamada(None, mio, t, 1, "revisor"), _llamada(None, mio, t, 2)])
    cab = _como(monkeypatch, ADMIN)
    assert cliente.get("/v1/decisiones/9/llamadas", headers=cab).status_code == 404
    items = cliente.get("/v1/decisiones/1/llamadas", headers=cab).json()["items"]
    pares = [(i["etapa"], i["paso"]) for i in items]
    assert pares == [("agente", 1), ("revisor", 1), ("agente", 2)]
    assert items[0]["enviado"] == [{"role": "user", "content": "c"}]


def test_llamadas_sin_ciclo_se_reparten_por_ejecucion_y_hora(
        cliente: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # `creado` de la decisión es el inicio de su transacción: sus llamadas llegan después.
    t = datetime(2026, 11, 17, 23, 0, tzinfo=UTC)
    m = timedelta(minutes=1)
    with base.sesion() as s:
        ej = Ejecucion(tarea="despertar", fecha_ny=date(2026, 11, 17))
        s.add(ej)
        s.flush()
        s.add_all([Decision(ejecucion_id=ej.id, fecha_ny=date(2026, 11, 17), tipo="nada",
                            propuesta={}, razonamiento="r", modelo="m", creado=t + k * m)
                   for k in (0, 10)])
        s.add_all([_llamada(ej.id, None, t - m, 1), _llamada(ej.id, None, t + 2 * m, 2),
                   _llamada(ej.id, None, t + 3 * m, 1, "revisor"),
                   _llamada(ej.id, None, t + 4 * m, 1, "juicios"),
                   _llamada(ej.id, None, t + 11 * m, 3)])
    cab = _como(monkeypatch, ADMIN)
    uno = cliente.get("/v1/decisiones/1/llamadas", headers=cab).json()["items"]
    dos = cliente.get("/v1/decisiones/2/llamadas", headers=cab).json()["items"]
    assert [i["respuesta"] for i in uno] == ["r2", "r1"]
    assert [i["respuesta"] for i in dos] == ["r3"]


def test_resumen_trae_operaciones_y_hoy_el_total(cliente: TestClient,
                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    with base.sesion() as s:
        libro.abrir_libro(s, date(2026, 11, 17))
        s.add(Decision(fecha_ny=date(2026, 11, 17), tipo="operar", razonamiento="r", modelo="m",
                       propuesta={"operaciones": [{"ticker": "RDDT", "lado": "compra",
                                                   "importe": 300}]}))
    cab = _como(monkeypatch, ADMIN)
    hoy = cliente.get("/v1/hoy", headers=cab).json()
    assert hoy["decisiones_total"] == 1
    assert hoy["ultima_decision"]["operaciones"] == [{"ticker": "RDDT", "lado": "compra"}]
    assert hoy["ultima_decision"]["creado"]
    # La búsqueda también encuentra por empresa, aunque no salga en el razonamiento.
    assert len(cliente.get("/v1/diario?q=rddt", headers=cab).json()["items"]) == 1


def test_dia_junta_tareas_registro_y_decisiones(cliente: TestClient,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    d = date(2026, 11, 16)
    with base.sesion() as s:
        ej = Ejecucion(tarea="despertar", fecha_ny=d, estado="hecha")
        otra = Ejecucion(tarea="despertar", fecha_ny=date(2026, 11, 17))
        s.add_all([ej, otra])
        s.flush()
        dec = Decision(ejecucion_id=ej.id, fecha_ny=d, tipo="nada", propuesta={},
                       razonamiento="r", modelo="m")
        s.add(dec)
        s.flush()
        s.execute(text(
            "insert into agente.eventos (origen, tipo, datos, ejecucion_id, ocurrido) values "
            "('ciclo', 'decision', cast(:a as jsonb), :e, '2026-11-17 03:00+00'), "
            "('vigia', 'ciclo_pendiente', '{}', null, '2026-11-17 22:00+00')"),
            {"a": f'{{"decision_id": {dec.id}}}', "e": ej.id})
    cab = _como(monkeypatch, ADMIN)
    r = cliente.get("/v1/dia/2026-11-16", headers=cab).json()
    assert [e["id"] for e in r["ejecuciones"]] == [ej.id]
    # El evento de las 22:00 NY del 16 queda en su ejecución aunque en UTC ya sea día 17.
    assert [e["tipo"] for e in r["eventos"]] == ["decision"]
    assert [x["id"] for x in r["decisiones"]] == [dec.id]
    assert r["ordenes_ejecutadas"] == 0
    assert [p["tarea"] for p in r["programa"]][0] == "vigia_previo"
    assert cliente.get("/v1/dia/2026-11-15", headers=cab).json()["programa"] == []


def test_ciclo_actual_en_curso_hasta_que_hay_decision(cliente: TestClient,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    cab = _como(monkeypatch, ADMIN)
    assert cliente.get("/v1/ciclo/actual", headers=cab).json()["ciclo"] is None
    c = uuid.uuid4()
    ahora = datetime.now(UTC)
    with base.sesion() as s:
        ej = Ejecucion(tarea="despertar", fecha_ny=date(2026, 11, 17))
        s.add(ej)
        s.flush()
        s.add_all([_llamada(ej.id, c, ahora, 1), _llamada(ej.id, c, ahora, 2)])
    vivo = cliente.get("/v1/ciclo/actual", headers=cab).json()
    assert (vivo["ciclo"], vivo["en_curso"], len(vivo["items"])) == (str(c), True, 2)
    with base.sesion() as s:
        s.add(Decision(fecha_ny=date(2026, 11, 17), tipo="nada", propuesta={}, razonamiento="r",
                       modelo="m", ciclo=c))
    hecho = cliente.get("/v1/ciclo/actual", headers=cab).json()
    assert (hecho["en_curso"], hecho["decision_id"]) == (False, 1)


def test_seguimiento_da_las_cifras_de_screen(cliente: TestClient,
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    # Solo filas propias: la lista de seguimiento local no se vacía entre pruebas.
    with base.sesion() as s:
        s.execute(text("insert into agente.seguimiento (ticker, motivo) values ('ZZA', 'm'), "
                       "('ZZB', 'm')"))
        hoy = datetime.now(UTC).date()
        for k in range(30):
            s.execute(text("insert into agente.precios (ticker, fecha, cierre) "
                           "values ('ZZA', :f, :c)"),
                      {"f": hoy - timedelta(days=30 - k), "c": 10 + k})
    try:
        r = cliente.get("/v1/seguimiento", headers=_como(monkeypatch, ADMIN)).json()
        assert {"ZZA", "ZZB"} <= {x["ticker"] for x in r["lista"]}
        assert [f.split(" ")[:2] for f in r["filas"] if f.startswith("ZZA ")] == [["ZZA", "39.0"]]
        assert "ZZB" in r["sin_precios"]
        assert r["fecha_precios"] == (hoy - timedelta(days=1)).isoformat()
    finally:
        with base.sesion() as s:
            s.execute(text("delete from agente.seguimiento where ticker in ('ZZA', 'ZZB')"))


def test_informes_vacio_devuelve_lista_vacia(cliente: TestClient,
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    cab = _como(monkeypatch, ADMIN)
    r = cliente.get("/v1/informes?tipo=semanal", headers=cab)
    assert r.status_code == 200
    assert r.json() == {"items": []}
    assert cliente.get("/v1/informes/1", headers=cab).status_code == 404


def test_agente_diario_y_fichas_sin_datos(cliente: TestClient,
                                          monkeypatch: pytest.MonkeyPatch) -> None:
    _decisiones(1)
    cab = _como(monkeypatch, ADMIN)
    a = cliente.get("/v1/agente", headers=cab).json()
    assert a["filosofia"] is None
    assert a["gasto_mes"] == {"por_tipo": [], "total_usd": "0", "tope_usd": "10"}
    assert len(cliente.get("/v1/diario?q=RRR", headers=cab).json()["items"]) == 1
    assert cliente.get("/v1/diario?q=100%25", headers=cab).json()["items"] == []
    assert cliente.get("/v1/fichas/nada", headers=cab).status_code == 404
