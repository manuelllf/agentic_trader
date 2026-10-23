"""Las estrategias y la casa seleccionan con un escaneo nuevo y mantienen con el mismo."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from test_procesos_integracion import (  # noqa: F401
    URL,
    fabrica,
    mercado,
    mundo,
)

from app import precios
from app.liga import estrategias
from app.liga.models import Posicion
from app.liga.motor import calendario
from app.liga.procesos import comun, formar

pytestmark = pytest.mark.skipif(
    not URL, reason="Sin BD de pruebas de la liga (LIGA_TEST_DATABASE_URL)")


def _previa_con_el_mismo_escaneo(db, mundo, corte):  # noqa: ANN001, ANN202, F811
    db.execute(text("update liga.jornadas set foto_id = :f, scan_run_id = :s "
                    "where dia_fin = :d"),
               {"f": mundo["foto"], "s": mundo["scan"], "d": corte})
    db.flush()


def _contexto_y_fila(db, mundo, corte):  # noqa: ANN001, ANN202, F811
    fechas = calendario.jornada_semanal(corte)
    j = SimpleNamespace(id=mundo["febrero"], foto_id=mundo["foto"],
                        scan_run_id=mundo["scan"], dia_base=corte,
                        cierre_inscripcion=fechas.cierre_inscripcion)
    ctx = formar.contexto(db, j)
    fila = db.execute(formar._ESTRATEGIAS, {"corte": ctx.corte}).all()
    return ctx, next(f for f in fila if f.id == mundo["reglas"])


def _anterior(db, mundo, estrategia_id, receta_id, corte, monkeypatch,  # noqa: ANN001, ANN202, F811
              pesos=None):  # noqa: ANN001
    base = date(2026, 12, 31)
    if "series_anteriores" not in mundo:
        db.execute(text("update liga.jornadas set dia_fin = :d, estado = 'cerrada', "
                        "sp_rentabilidad = 0 "
                        "where id = :j"), {"d": corte, "j": mundo["enero"]})
        mundo["series_anteriores"] = {}
        monkeypatch.setattr(precios, "series", lambda *_a, **_k: mundo["series_anteriores"])
    iid = db.execute(text(
        "insert into liga.inscripciones (jornada_id, estrategia_id, receta_id, estado) "
        "values (:j, :e, :r, 'cerrada') returning id"),
        {"j": mundo["enero"], "e": estrategia_id, "r": receta_id}).scalar()
    if pesos is None:
        pesos = [("ZQA", Decimal("60")), ("ZQD", Decimal("40"))]
    for ticker, peso in pesos:
        db.add(Posicion(inscripcion_id=iid, ticker=ticker, peso=peso))
    db.flush()
    mundo["series_anteriores"].update(
        {t: [precios.Cierre(base, 100), precios.Cierre(corte, 100)] for t, _ in pesos})
    return pesos


# fixtures de test_procesos_integracion: ruff los toma como redefinición
def test_escaneo_nuevo_revisar_selecciona(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 29))
        _anterior(db, mundo, fila.id, fila.receta_id, ctx.dia_base, monkeypatch)
        entrada, omitida, aviso = formar.entrada_de(db, ctx, list(ctx.empresas), set(), fila)

        assert ctx.cambio_de_mes is True
        assert fila.cada_dia_1 == "revisar"
        assert entrada.origen == "seleccion"
        assert len(entrada.posiciones) == 5
        assert omitida is None and aviso is None
        assert any(p.estrategia_id == mundo["pregunta"]
                   for p in formar._preguntas_por_estrategia(db, ctx))


def test_mismo_escaneo_revisar_mantiene_y_no_pregunta(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        _previa_con_el_mismo_escaneo(db, mundo, date(2027, 1, 8))
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 8))
        pesos = _anterior(db, mundo, fila.id, fila.receta_id, ctx.dia_base, monkeypatch)
        entrada, omitida, aviso = formar.entrada_de(db, ctx, list(ctx.empresas), set(), fila)

        assert ctx.cambio_de_mes is False
        assert fila.cada_dia_1 == "revisar"
        assert entrada.origen == "mantener"
        assert entrada.posiciones == pesos
        assert omitida is None and aviso is None
        assert formar._preguntas_por_estrategia(db, ctx) == []

        def no_preguntar(*_a, **_k):  # noqa: ANN002, ANN003, ANN202
            raise AssertionError("El corte intermedio no debe consultar la IA")

        monkeypatch.setattr(formar.ia_comun, "razon_no_disponible", no_preguntar)
        monkeypatch.setattr(formar.ia_pregunta, "responder_pendientes", no_preguntar)
        assert formar.rellenar_preguntas(db, ctx, fabrica) is None


def test_mismo_escaneo_quitada_cede_su_peso_a_la_siguiente(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        _previa_con_el_mismo_escaneo(db, mundo, date(2027, 1, 8))
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 8))
        _anterior(db, mundo, fila.id, fila.receta_id, ctx.dia_base, monkeypatch)
        nueva = estrategias.nueva_version_excluidas(db, fila.id, "ZQA", quitar=False)
        db.execute(text("update liga.estrategias set receta_id = :r where id = :e"),
                   {"r": nueva.id, "e": fila.id})
        _, fila = _contexto_y_fila(db, mundo, date(2027, 1, 8))
        entrada, omitida, aviso = formar.entrada_de(
            db, ctx, [e for e in ctx.empresas if e.ticker != "ZQL"], {"ZQL"}, fila)

        assert entrada.origen == "mantener"
        assert dict(entrada.posiciones) == {"ZQB": Decimal("60"), "ZQD": Decimal("40")}
        assert omitida is None and aviso is None


def test_mismo_escaneo_sin_anterior_cerrada_selecciona(
        fabrica, mundo) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        _previa_con_el_mismo_escaneo(db, mundo, date(2027, 1, 8))
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 8))
        assert formar._mantenidas(db, fila.id, ctx) is None
        entrada, omitida, aviso = formar.entrada_de(db, ctx, list(ctx.empresas), set(), fila)

        assert ctx.cambio_de_mes is False
        assert entrada.origen == "seleccion"
        assert len(entrada.posiciones) == 5
        assert omitida is None and aviso is None


def test_mismo_escaneo_la_casa_mantiene(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        _previa_con_el_mismo_escaneo(db, mundo, date(2027, 1, 8))
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 8))
        alpha = db.execute(text(
            "select id from liga.estrategias where casa_clave = 'alpha'")).scalar()
        pesos = _anterior(db, mundo, alpha, None, ctx.dia_base, monkeypatch,
                          [("ZQC", Decimal("70")), ("ZQK", Decimal("30"))])
        plan = formar.planificar(db, ctx, set())
        assert plan.casa["alpha"].posiciones == tuple(pesos)


def test_escaneo_nuevo_la_casa_sale_del_escaneo(
        fabrica, mundo, monkeypatch) -> None:  # noqa: ANN001, F811
    with comun.sesion(fabrica) as db:
        ctx, fila = _contexto_y_fila(db, mundo, date(2027, 1, 29))
        alpha = db.execute(text(
            "select id from liga.estrategias where casa_clave = 'alpha'")).scalar()
        _anterior(db, mundo, alpha, None, ctx.dia_base, monkeypatch,
                  [("ZQC", Decimal("70")), ("ZQK", Decimal("30"))])
        plan = formar.planificar(db, ctx, set())
        assert ctx.cambio_de_mes is True
        assert [t for t, _ in plan.casa["alpha"].posiciones] == ["ZQB", "ZQE", "ZQG", "ZQI"]
