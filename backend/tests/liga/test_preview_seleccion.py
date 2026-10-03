from decimal import Decimal

from fastapi import HTTPException

from app.liga import preview_seleccion as ruta
from app.liga.auth import Identidad
from app.liga.estrategias import Contexto
from app.liga.motor.catalogo import EmpresaFoto
from app.liga.motor.seleccion import NotasJev


def _body() -> ruta.PreviewSeleccionIn:
    return ruta.PreviewSeleccionIn(
        reglas=[], excluidas=[], pregunta=None,
        pesos={"negocio": 20, "precio": 20, "deuda": 20, "pronto": 20, "pregunta": 0},
        n_empresas=3, reparto="igual", max_por_sector=0,
    )


def _notas() -> NotasJev:
    return NotasJev(*(Decimal("7") for _ in range(4)))


def test_preview_cuenta_y_ordena_desde_foto_y_notas_guardadas(monkeypatch) -> None:
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _uid: True)
    empresas = tuple(EmpresaFoto(t, nombre=t, sector="Technology", market_cap_usd=100)
                     for t in ("AAA", "BBB", "CCC", "DDD"))
    contexto = Contexto(foto_id=17, scan_run_id=29, plan_b=False, empresas=empresas,
                        notas={t: _notas() for t in ("AAA", "BBB", "CCC", "DDD")})
    monkeypatch.setattr(ruta.estrategias, "foto_y_notas_actuales", lambda: contexto)
    monkeypatch.setattr(ruta.estrategias, "respuestas_sistema", lambda *_: {})

    resultado = ruta.previsualizar(_body(), Identidad(uid="u1", aal="aal1", claims={}))

    assert resultado.estado == "disponible"
    assert resultado.foto_id == 17 and resultado.scan_run_id == 29
    assert (resultado.evaluadas, resultado.cumplen_reglas,
            resultado.candidatas_ordenadas) == (4, 4, 4)
    assert resultado.seleccionadas == 3
    assert [e.ticker for e in resultado.elegidas] == ["AAA", "BBB", "CCC"]
    assert resultado.caja_pct == 0
    assert resultado.sin_peso == 0
    assert resultado.catalogo_version == ruta.CATALOGO_VERSION
    assert resultado.explicacion is None


def test_preview_explica_candidatas_sin_puntuaciones_guardadas(monkeypatch) -> None:
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _uid: True)
    empresas = (EmpresaFoto("AAA", market_cap_usd=100), EmpresaFoto("BBB", market_cap_usd=90))
    contexto = Contexto(foto_id=1, scan_run_id=2, plan_b=True, empresas=empresas, notas={})
    monkeypatch.setattr(ruta.estrategias, "foto_y_notas_actuales", lambda: contexto)
    monkeypatch.setattr(ruta.estrategias, "respuestas_sistema", lambda *_: {})

    resultado = ruta.previsualizar(_body(), Identidad(uid="u1", aal="aal1", claims={}))

    assert resultado.estado == "incompleto"
    assert resultado.plan_b is True
    assert resultado.cumplen_reglas == 2
    assert resultado.seleccionadas == 0
    assert resultado.sin_notas == 2
    assert "No se han solicitado puntuaciones nuevas" in resultado.mensaje


def test_preview_sin_foto_devuelve_estado_explicito(monkeypatch) -> None:
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _uid: True)

    def sin_contexto():
        raise HTTPException(409, "Aún no hay una foto guardada.")

    monkeypatch.setattr(ruta.estrategias, "foto_y_notas_actuales", sin_contexto)
    resultado = ruta.previsualizar(_body(), Identidad(uid="u1", aal="aal1", claims={}))

    assert resultado.estado == "sin_datos"
    assert resultado.mensaje == "Aún no hay una foto guardada."
    assert resultado.evaluadas is None and resultado.elegidas == []
    assert resultado.sin_peso is None
    assert resultado.catalogo_version == ruta.CATALOGO_VERSION
    assert resultado.explicacion is None


def test_preview_sin_nombre_explica_y_recalcula_exclusiones_sin_guardar(monkeypatch) -> None:
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _uid: True)
    empresas = tuple(EmpresaFoto(t, nombre=t, market_cap_usd=100)
                     for t in ("AAA", "BBB", "CCC", "DDD"))
    contexto = Contexto(foto_id=17, scan_run_id=29, plan_b=False, empresas=empresas,
                        notas={t: _notas() for t in ("AAA", "BBB", "CCC", "DDD")})
    monkeypatch.setattr(ruta.estrategias, "foto_y_notas_actuales", lambda: contexto)
    monkeypatch.setattr(ruta.estrategias, "respuestas_sistema", lambda *_: {})

    def no_guardar(*_args, **_kwargs):
        raise AssertionError("La vista efímera no puede guardar una estrategia ni prueba.")

    monkeypatch.setattr(ruta.estrategias, "crear_prueba_sistema", no_guardar)
    body = _body().model_copy(update={"ticker": " aaa "})
    identidad = Identidad(uid="u1", aal="aal1", claims={})
    primera = ruta.previsualizar(body, identidad)
    assert "AAA entra" in primera.explicacion
    assert "id" not in primera.model_dump()

    excluida = ruta.previsualizar(body.model_copy(update={"excluidas": ["AAA"]}), identidad)
    assert [e.ticker for e in excluida.elegidas] == ["BBB", "CCC", "DDD"]
    assert "la quitaste tú" in excluida.explicacion


def test_preview_cuenta_peso_cero_sin_inventar_posicion(monkeypatch) -> None:
    monkeypatch.setattr(ruta._LIMITE_PREVIEW, "permitido", lambda _uid: True)
    empresas = tuple(EmpresaFoto(t, market_cap_usd=100) for t in ("AAA", "BBB", "CCC"))
    contexto = Contexto(foto_id=17, scan_run_id=29, plan_b=False, empresas=empresas,
                        notas={"AAA": _notas(), "BBB": _notas(),
                               "CCC": NotasJev(*(Decimal(0) for _ in range(4)))})
    monkeypatch.setattr(ruta.estrategias, "foto_y_notas_actuales", lambda: contexto)
    monkeypatch.setattr(ruta.estrategias, "respuestas_sistema", lambda *_: {})
    body = _body().model_copy(update={"reparto": "nota", "ticker": "CCC"})
    resultado = ruta.previsualizar(body, Identidad(uid="u1", aal="aal1", claims={}))
    assert resultado.sin_peso == 1
    assert resultado.seleccionadas == 2
    assert [e.ticker for e in resultado.elegidas] == ["AAA", "BBB"]
    assert "no pesa nada" in resultado.explicacion
