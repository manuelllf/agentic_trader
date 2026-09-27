"""Rutas de admin de los procesos: solo el admin entra, llaman al servicio con su identidad como
actor y las negativas del dominio salen con su código. Sin BD: los servicios se sustituyen."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.liga import rutas_admin
from app.liga.auth import Identidad, require_admin
from app.liga.procesos.comun import ErrorProceso, NoEncontrado

ADMIN = Identidad(uid="00000000-0000-0000-0000-00000000a0a0", aal="aal2", claims={})


def _cliente(admin: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(rutas_admin.router)
    if admin:
        app.dependency_overrides[require_admin] = lambda: ADMIN
    return TestClient(app)


def test_sin_sesion_no_entra_nadie() -> None:
    c = _cliente(admin=False)
    assert c.get("/liga/admin/procesos/estado").status_code == 401
    assert c.post("/liga/admin/procesos/formar/ejecutar", json={"jornada_id": 1}).status_code == 401


def test_ejecutar_pasa_el_admin_como_actor(monkeypatch) -> None:  # noqa: ANN001
    llamadas = []

    def formar(jornada_id, actor=None):  # noqa: ANN001, ANN202
        llamadas.append((jornada_id, actor))
        return {"jornada_id": jornada_id, "estado": "formada"}

    monkeypatch.setattr(rutas_admin.formar, "ejecutar", formar)
    r = _cliente().post("/liga/admin/procesos/formar/ejecutar", json={"jornada_id": 7})
    assert r.status_code == 200 and r.json()["estado"] == "formada"
    assert llamadas == [(7, ADMIN.uid)]


def test_las_negativas_del_dominio_llevan_su_codigo(monkeypatch) -> None:  # noqa: ANN001
    def ya_formada(*a, **k):  # noqa: ANN002, ANN003, ANN202
        raise ErrorProceso("La jornada ya está formada.")

    def no_existe(*a, **k):  # noqa: ANN002, ANN003, ANN202
        raise NoEncontrado("No existe la jornada 99.")

    monkeypatch.setattr(rutas_admin.cerrar, "ejecutar", ya_formada)
    monkeypatch.setattr(rutas_admin.foto, "estado", no_existe)
    c = _cliente()
    r = c.post("/liga/admin/procesos/cerrar/ejecutar", json={"jornada_id": 1})
    assert (r.status_code, r.json()["detail"]) == (409, "La jornada ya está formada.")
    assert c.get("/liga/admin/procesos/foto/estado?jornada_id=99").status_code == 404


def test_el_cuerpo_se_valida(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(rutas_admin.foto, "vista_previa", lambda *a: {"ok": a})
    c = _cliente()
    assert c.post("/liga/admin/procesos/foto/vista-previa", json={"jornada_id": 0}).status_code \
        == 422
    r = c.post("/liga/admin/procesos/foto/vista-previa",
               json={"jornada_id": 3, "foto_id": 5})
    assert r.json() == {"ok": [3, 5, None]}


def test_interruptor_del_diario(monkeypatch) -> None:  # noqa: ANN001
    visto = {}

    def interruptor(activo, actor=None):  # noqa: ANN001, ANN202
        visto.update(activo=activo, actor=actor)
        return {"activo": activo}

    monkeypatch.setattr(rutas_admin.diario, "interruptor", interruptor)
    r = _cliente().post("/liga/admin/procesos/diario/interruptor", json={"activo": True})
    assert r.json() == {"activo": True} and visto == {"activo": True, "actor": ADMIN.uid}
