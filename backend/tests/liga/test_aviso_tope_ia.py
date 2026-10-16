"""Aviso mensual del gasto de IA con correo simulado y Postgres de pruebas."""

from __future__ import annotations

import os
from datetime import datetime

import pytest

psycopg = pytest.importorskip("psycopg")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.db as app_db  # noqa: E402
from app import avisos_admin  # noqa: E402
from app.i18n import MESSAGES  # noqa: E402
from app.liga.ia import comun  # noqa: E402

URL = os.environ.get("LIGA_TEST_DATABASE_URL")


@pytest.fixture
def entorno(monkeypatch):  # noqa: ANN001, ANN201
    if not URL:
        pytest.skip("Sin BD de pruebas (LIGA_TEST_DATABASE_URL)")
    motor = create_engine(URL.replace("postgresql://", "postgresql+psycopg://", 1))
    monkeypatch.setattr(app_db, "SessionLocal", sessionmaker(bind=motor))
    enviados = []
    monkeypatch.setattr(avisos_admin, "por_correo",
                        lambda *args, **kwargs: enviados.append((args, kwargs)))
    cx = psycopg.connect(URL, autocommit=True)
    try:
        yield cx, enviados
    finally:
        # La auditoría es de solo añadir; la limpieza se limita a los datos de estas pruebas.
        cx.execute("set session_replication_role = replica")
        cx.execute("delete from liga.auditoria where accion = 'aviso.ia_tope_80' "
                   "or (accion = 'ia.conversor' and actor_id is null)")
        cx.execute("set session_replication_role = origin")
        cx.execute("delete from llm_call where stage like 'liga_%'")
        cx.execute("delete from liga.ajustes where clave = 'ia.tope_mensual_usd'")
        cx.close()
        motor.dispose()


def _gasto(cx, stage: str, coste: float) -> None:  # noqa: ANN001
    cx.execute("""
        insert into llm_call (at, stage, model, prompt_cache_hit_tokens,
                              prompt_cache_miss_tokens, completion_tokens, cost_usd, ok)
        values (now(), %s, 'prueba-aviso-tope', 0, 100, 0, %s, true)
    """, (stage, coste))


def _registrar(coste: float = 0.1, *, finalidad: str = "conversor") -> int | None:
    llamada = comun.LlamadaIA(modelo="prueba-aviso-tope", tokens_entrada=10,
                              tokens_salida=5, coste_usd=coste, latencia_ms=1, ok=True)
    return comun.registrar_llamada(finalidad=finalidad, usuario_id=None, llamada=llamada)


def _tope(cx) -> None:  # noqa: ANN001
    cx.execute("insert into liga.ajustes (clave, valor) values ('ia.tope_mensual_usd', '5')")


def test_por_debajo_del_80_no_avisa(entorno) -> None:  # noqa: ANN001
    cx, enviados = entorno
    _tope(cx)
    _gasto(cx, "liga_lectura", 3.8)
    _gasto(cx, "liga_formacion", 10)
    _registrar()
    assert enviados == []


@pytest.mark.parametrize("coste", [0.1, 0.2])
def test_al_llegar_o_superar_el_80_avisa_una_vez_y_audita(entorno, coste) -> None:  # noqa: ANN001
    cx, enviados = entorno
    _tope(cx)
    _gasto(cx, "liga_lectura", 2)
    _gasto(cx, "liga_pregunta", 1.9)
    _registrar(coste)
    _registrar()
    assert enviados == [(("ia_tope_80", "/admin/liga/ajustes"),
                         {"gasto": f"{3.9 + coste:.2f}", "tope": "5.00"})]
    filas = cx.execute("select objeto, detalle, actor_id from liga.auditoria "
                       "where accion = 'aviso.ia_tope_80'").fetchall()
    assert len(filas) == 1
    objeto, detalle, actor = filas[0]
    assert objeto == f"mes:{datetime.now(comun.TZ_MADRID):%Y-%m}"
    assert float(detalle["gasto"]) == pytest.approx(3.9 + coste)
    assert float(detalle["tope"]) == 5
    assert actor is None


@pytest.mark.parametrize("valor", [None, "null"])
def test_sin_tope_no_avisa(entorno, valor) -> None:  # noqa: ANN001
    cx, enviados = entorno
    if valor is not None:
        cx.execute("insert into liga.ajustes (clave, valor) values ('ia.tope_mensual_usd', %s)",
                   (valor,))
    _gasto(cx, "liga_pregunta", 10)
    _registrar()
    assert enviados == []


def test_fallo_del_correo_no_tira_la_llamada(entorno, monkeypatch) -> None:  # noqa: ANN001
    cx, _ = entorno
    _tope(cx)

    def fallar(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        raise RuntimeError("Fallo simulado del correo")

    monkeypatch.setattr(avisos_admin, "por_correo", fallar)
    llamada_id = _registrar(4)
    assert cx.execute("select id from llm_call where id = %s", (llamada_id,)).fetchone()
    assert cx.execute("select count(*) from liga.auditoria "
                      "where accion = 'aviso.ia_tope_80'").fetchone()[0] == 0


@pytest.mark.parametrize("idioma", ["es", "en"])
def test_textos_del_aviso(idioma) -> None:  # noqa: ANN001
    assert MESSAGES[idioma]["correo_ia_tope_80_asunto"]
    assert "{gasto}" in MESSAGES[idioma]["correo_ia_tope_80_intro"]
    assert "{tope}" in MESSAGES[idioma]["correo_ia_tope_80_intro"]
    asunto, texto, html = avisos_admin.mensaje(
        "ia_tope_80", idioma, "/admin/liga/ajustes", (), datetime.now(comun.TZ_MADRID),
        gasto="4.00", tope="5.00")
    assert asunto == MESSAGES[idioma]["correo_ia_tope_80_asunto"]
    assert "4.00" in texto and "5.00" in texto
    assert "/admin/liga/ajustes" in html
