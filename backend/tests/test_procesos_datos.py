"""Candado común de los procesos de datos (Vennett > Datos): solo uno corre a la vez.

Reproduce lo que antes pasaba: la foto, la poda y el escaneo se miraban entre sí, pero el universo
global, las tasas de cambio y la analítica no se miraban con nadie, así que dos lanzamientos
seguidos arrancaban los dos.
"""

from __future__ import annotations

import threading

import pytest
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app import auth, foto_service, pipeline, poda, procesos_datos
from app import scheduler as scheduler_mod
from app.api import routes_admin
from app.config import settings
from app.db import get_db
from app.screener import fx as fx_mod
from app.screener import universe_global


@pytest.fixture
def client(token_admin) -> TestClient:  # noqa: ANN001
    app = FastAPI()
    app.include_router(routes_admin.router, dependencies=[Depends(auth.require_auth)])
    app.dependency_overrides[get_db] = lambda: None     # ninguna ruta probada llega a leer la base
    return TestClient(app, headers={"Authorization": f"Bearer {token_admin}"})


@pytest.fixture
def soltar(monkeypatch):  # noqa: ANN001, ANN201
    """Los hilos de fondo (foto, universo global, poda) se quedan esperando hasta que el test los
    suelta, y al soltarlos cierran su estado como lo haría el real."""
    evento = threading.Event()

    def falso(modulo):  # noqa: ANN001, ANN202
        def _run(*_a, **_k) -> None:  # noqa: ANN002, ANN003
            evento.wait(5)
            with modulo._lock:
                modulo._state["status"] = "done"
        return _run

    for modulo in (foto_service, universe_global, poda):
        monkeypatch.setattr(modulo, "_run", falso(modulo))
        monkeypatch.setitem(modulo._state, "status", "idle")
    monkeypatch.setitem(pipeline._state, "status", "idle")
    yield evento
    evento.set()


def _esperar(condicion, segundos: float = 3.0) -> None:  # noqa: ANN001
    fin = threading.Event()
    for _ in range(int(segundos / 0.02)):
        if condicion():
            return
        fin.wait(0.02)
    raise AssertionError("la condición no llegó a cumplirse")


def test_dos_lanzamientos_seguidos_el_segundo_es_409(client, soltar) -> None:  # noqa: ANN001
    assert client.post("/admin/foto").status_code == 200
    # Lo que antes pasaba: solo la foto, la poda y el escaneo se miraban entre sí.
    assert client.post("/admin/foto").status_code == 409
    assert client.post("/admin/universo-global").status_code == 409
    assert client.post("/admin/universo-global/subir-csv",
                       files={"archivo": ("t.csv", b"a,b\n1,2\n")}).status_code == 409
    assert client.post("/admin/fx-sync").status_code == 409
    assert client.post("/admin/sync-analytics").status_code == 409
    assert client.post("/admin/universe-snapshot").status_code == 409
    assert client.post("/admin/poda").status_code == 409

    soltar.set()
    _esperar(lambda: procesos_datos.en_marcha() is None)
    assert client.post("/admin/universo-global").status_code == 200


def test_un_escaneo_en_marcha_cierra_el_sitio_a_todos(client, soltar, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setitem(pipeline._state, "status", "running")
    assert client.post("/admin/universo-global").status_code == 409
    assert client.post("/admin/fx-sync").status_code == 409


def test_quien_trabaja_dentro_de_la_peticion_ocupa_el_sitio(client, soltar, monkeypatch) -> None:  # noqa: ANN001
    dentro, salir = threading.Event(), threading.Event()

    def lenta(_db) -> dict:  # noqa: ANN001
        dentro.set()
        salir.wait(5)
        return {"divisas": 1, "recalculadas": 0}

    monkeypatch.setattr(fx_mod, "sincronizar", lenta)
    hilo = threading.Thread(target=lambda: client.post("/admin/fx-sync"))
    hilo.start()
    try:
        assert dentro.wait(3)
        assert procesos_datos.en_marcha()["id"] == "fx"
        assert client.post("/admin/foto").status_code == 409
        assert client.post("/admin/fx-sync").status_code == 409
        estado = client.get("/admin/procesos/estado").json()
        assert estado["en_marcha"]["id"] == "fx" and estado["en_marcha"]["desde"]
    finally:
        salir.set()
        hilo.join(5)
    assert procesos_datos.en_marcha() is None
    assert client.post("/admin/foto").status_code == 200


def test_si_el_proceso_falla_el_sitio_queda_libre(client, soltar, monkeypatch) -> None:  # noqa: ANN001
    def rota(_db) -> dict:  # noqa: ANN001
        raise RuntimeError("Yahoo caído")

    monkeypatch.setattr(fx_mod, "sincronizar", rota)
    r = client.post("/admin/fx-sync")
    assert r.json() == {"ok": False, "error": "Yahoo caído"}
    assert procesos_datos.en_marcha() is None


def test_el_cron_se_ve_y_bloquea_lo_manual_sin_ser_rechazado(client, soltar) -> None:  # noqa: ANN001
    with procesos_datos.marcar("fx"):
        with procesos_datos.marcar("fx"):       # dos pasadas solapadas: no se pisan al salir
            pass
        assert procesos_datos.en_marcha()["id"] == "fx"
        assert client.post("/admin/foto").status_code == 409
    assert procesos_datos.en_marcha() is None


def test_el_estado_dice_que_esta_libre(client, soltar) -> None:  # noqa: ANN001
    r = client.get("/admin/procesos/estado")
    assert r.status_code == 200 and r.json()["en_marcha"] is None
    assert set(r.json()["ultima"]) == {"analitica", "poda", "global"}


def test_el_horario_sale_de_los_trabajos_registrados(client, monkeypatch) -> None:  # noqa: ANN001
    nuevo = BackgroundScheduler(timezone="UTC")
    # Registra los trabajos sin arrancar el reloj.
    monkeypatch.setattr(nuevo, "start", lambda *a, **k: None)
    monkeypatch.setattr(scheduler_mod, "scheduler", nuevo)
    monkeypatch.setattr(settings, "enable_scheduler", True)
    scheduler_mod.start_scheduler()

    r = client.get("/admin/procesos/horario")
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["scheduler_activo"] is True
    por_id = {p["proceso"]: p for p in cuerpo["procesos"]}
    assert set(por_id) == {"foto", "global", "fund", "fx", "analitica", "poda"}

    foto = por_id["foto"]
    assert (foto["dias_semana"], foto["horas"], foto["minuto"]) == ("mon-fri", "16,18,20,22", "30")
    assert foto["zona"] == settings.scan_timezone
    assert (por_id["global"]["dia_mes"], por_id["global"]["horas"]) == ("1", "3")
    assert (por_id["fx"]["horas"], por_id["fx"]["zona"]) == ("5", "Europe/Madrid")
    assert (por_id["analitica"]["horas"], por_id["analitica"]["zona"]) == ("6", "Europe/Madrid")
    assert por_id["fund"]["automatico"] is False and por_id["poda"]["automatico"] is False


def test_sin_scheduler_ningun_proceso_es_automatico(client, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(scheduler_mod, "scheduler", BackgroundScheduler(timezone="UTC"))
    monkeypatch.setattr(settings, "enable_scheduler", False)
    cuerpo = client.get("/admin/procesos/horario").json()
    assert cuerpo["scheduler_activo"] is False
    assert not any(p["automatico"] for p in cuerpo["procesos"])
