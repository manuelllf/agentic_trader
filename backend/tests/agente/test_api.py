"""API del panel de admin contra la base real de pruebas, con la verificación del JWT sustituida."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.agente import api, base, libro, servicio
from app.agente.config import ajustes
from app.agente.models import Decision, FichaMejora, PlaybookVersion
from app.supabase_auth import Identidad

ADMIN = "11111111-1111-1111-1111-111111111111"
AJENO = "22222222-2222-2222-2222-222222222222"
_TABLAS = ("eventos, decisiones, ordenes, ejecutadas, movimientos_caja, precios, "
           "valor_diario, informes, fichas_mejora, lecciones, playbook_versiones")


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
