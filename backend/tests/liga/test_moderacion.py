"""Moderación (plan §10, F6-A): la lista de bloqueo basta por sí sola, el modelo puede bloquear o
dejar en duda (con reporte automático), y si el modelo está apagado o falla se sigue solo con la
lista — nunca se bloquea a nadie porque la IA esté caída. Proveedor simulado. Contra el Postgres
de pruebas; se salta sin `LIGA_TEST_DATABASE_URL`."""

from __future__ import annotations

import json
import os
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
import app.llm as app_llm  # noqa: E402
from app.liga import db as liga_db  # noqa: E402
from app.liga.ia import moderacion  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")


class _FakeLLM:
    def __init__(self, contenido: str | None, *, lanza: bool = False) -> None:
        self._contenido = contenido
        self._lanza = lanza

    def chat(self, system: str, user: str, *, temperature: float = 0.0, top_p=None) -> str:  # noqa: ANN001
        if self._lanza:
            raise RuntimeError("el proveedor no responde")
        return self._contenido


def _get_llm_de(veredicto: str | None, *, lanza: bool = False):  # noqa: ANN201
    contenido = None if veredicto is None else json.dumps({"veredicto": veredicto})

    def _get_llm(**kwargs):  # noqa: ANN003, ANN202
        return _FakeLLM(contenido, lanza=lanza)
    return _get_llm


@pytest.fixture
def entorno(monkeypatch):  # noqa: ANN001, ANN201
    from app.config import settings

    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    fabrica_sesion = sessionmaker(bind=motor)
    monkeypatch.setattr(app_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(liga_db, "SessionLocal", fabrica_sesion)
    monkeypatch.setattr(settings, "enable_llm", True)

    cx = psycopg.connect(URL, autocommit=True)
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.moderacion.activo', 'true')")
    uid = uuid.uuid4()
    cx.execute("insert into auth.users (id, email) values (%s, %s)",
              (uid, f"{uid.hex[:12]}@prueba.local"))
    estrategia_id = cx.execute(
        "insert into liga.estrategias (dueno_id, nombre, forma, dibujo, color1, color2) "
        "values (%s, 'Prueba', 'escudo', 'liso', '#000000', '#FFFFFF') returning id",
        (uid,)).fetchone()[0]

    try:
        yield cx, str(estrategia_id)
    finally:
        cx.execute("delete from liga.reportes where objeto_id = %s", (str(estrategia_id),))
        # `liga.auditoria` es de solo añadir (disparador `solo_anadir`): limpiar de pruebas
        # necesita saltárselo, nunca en producción.
        cx.execute("set session_replication_role = replica")
        cx.execute("delete from liga.auditoria where objeto like %s", (f"%{estrategia_id}%",))
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from llm_call where stage = 'liga_moderacion'")
        cx.execute("delete from liga.estrategias where id = %s", (estrategia_id,))
        cx.execute("delete from auth.users where id = %s", (uid,))
        cx.execute("delete from liga.ajustes where clave = 'ia.moderacion.activo'")
        cx.close()
        motor.dispose()


def test_lista_de_bloqueo_basta_sola(entorno, monkeypatch) -> None:  # noqa: ANN001
    _, estrategia_id = entorno
    # El modelo diría "allow"; la lista bloquea igualmente sin llegar a llamarlo.
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("allow"))
    with pytest.raises(HTTPException) as exc:
        moderacion.evaluar("estrategia", estrategia_id, "Puto mercado")
    assert exc.value.status_code == 422


def test_modelo_bloquea(entorno, monkeypatch) -> None:  # noqa: ANN001
    _, estrategia_id = entorno
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("block"))
    with pytest.raises(HTTPException) as exc:
        moderacion.evaluar("estrategia", estrategia_id, "Texto normal pero el modelo lo bloquea")
    assert exc.value.status_code == 422


def test_modelo_en_duda_permite_y_crea_reporte(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, estrategia_id = entorno
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("doubt"))
    r = moderacion.evaluar("estrategia", estrategia_id, "Un nombre ambiguo")
    assert r.permitido is True
    assert r.veredicto == "doubt"
    fila = cx.execute(
        "select autor_id, tipo, estado from liga.reportes where objeto_id = %s",
        (estrategia_id,)).fetchone()
    assert fila is not None
    assert fila[0] is None  # reporte del sistema, no de un usuario
    assert fila[1] == "estrategia"
    assert fila[2] == "abierto"


def test_modelo_caido_se_sigue_solo_con_la_lista(entorno, monkeypatch) -> None:  # noqa: ANN001
    _, estrategia_id = entorno
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de(None, lanza=True))
    r = moderacion.evaluar("estrategia", estrategia_id, "Texto normal, sin nada de la lista")
    assert r.permitido is True
    assert r.veredicto == "allow"


def test_interruptor_apagado_se_sigue_solo_con_la_lista(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, estrategia_id = entorno
    cx.execute("update liga.ajustes set valor = 'false' where clave = 'ia.moderacion.activo'")
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("block"))  # ni se llega a mirar
    r = moderacion.evaluar("estrategia", estrategia_id, "Texto normal")
    assert r.permitido is True


# ---- segundo plano (hallazgo crítico de latencia #1: el modelo no bloquea la petición) --------


def test_evaluar_lista_nunca_llama_al_modelo(entorno, monkeypatch) -> None:  # noqa: ANN001
    _, estrategia_id = entorno
    llamado = {"veces": 0}

    def _get_llm(**kwargs):  # noqa: ANN003, ANN202
        llamado["veces"] += 1
        return _FakeLLM(json.dumps({"veredicto": "allow"}))

    monkeypatch.setattr(app_llm, "get_llm", _get_llm)
    # Ni bloqueada ni nada que mirar: `evaluar_lista` no toca el modelo bajo ningún concepto,
    # así que puede quedarse síncrona dentro de la petición sin añadir latencia del proveedor.
    moderacion.evaluar_lista("Texto normal")
    assert llamado["veces"] == 0


def test_evaluar_en_fondo_bloquea_oculta_lo_ya_guardado(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, estrategia_id = entorno
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("block"))
    # Simula lo que hace una ruta: primero guarda (aquí ya está guardada por el fixture), la
    # respuesta ya salió, y DESPUÉS corre el modelo como tarea de fondo.
    moderacion.evaluar_en_fondo("estrategia", estrategia_id,
                                "Texto normal pero el modelo lo bloquea")
    oculta = cx.execute("select oculta from liga.estrategias where id = %s",
                        (estrategia_id,)).fetchone()[0]
    assert oculta is True
    accion = cx.execute(
        "select accion from liga.auditoria where objeto = %s order by creada desc limit 1",
        (f"estrategia:{estrategia_id}",)).fetchone()
    assert accion is not None and accion[0] == "ia.moderacion.oculta"


def test_evaluar_en_fondo_en_duda_deja_visible_y_reporta(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, estrategia_id = entorno
    monkeypatch.setattr(app_llm, "get_llm", _get_llm_de("doubt"))
    moderacion.evaluar_en_fondo("estrategia", estrategia_id, "Un nombre ambiguo")
    oculta = cx.execute("select oculta from liga.estrategias where id = %s",
                        (estrategia_id,)).fetchone()[0]
    assert oculta is False
    reporte = cx.execute("select estado from liga.reportes where objeto_id = %s",
                         (estrategia_id,)).fetchone()
    assert reporte is not None and reporte[0] == "abierto"
