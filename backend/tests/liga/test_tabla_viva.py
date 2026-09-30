"""La tabla del mes en juego es pública y provisional: se ordena por la rentabilidad del último
cierre, no espera al cierre de la jornada, y se guarda unos minutos en memoria. Sin BD."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.liga import rutas_publicas as rp
from app.liga.procesos import diario


def _fila(nombre: str) -> rp.FilaJornada:
    escudo = rp.EscudoOut(forma="circulo", dibujo="liso", color1="#000000", color2="#ffffff",
                          iniciales=None)
    return rp.FilaJornada(
        equipo=rp.EquipoOut(id=nombre, nombre=nombre, escudo=escudo, casa=None, autor=None),
        rentabilidad=None, dif_sp=None, puntos=None)


def _calculo(rentabilidad, dif=Decimal("0"), puntos=1) -> dict:
    return {"rentabilidad": rentabilidad, "dif": dif, "puntos": puntos}


def test_las_filas_vivas_van_de_mejor_a_peor_y_sin_calculo_al_final() -> None:
    vivo = {"por_inscripcion": {
        1: _calculo(Decimal("1.0"), Decimal("0.2"), 1),
        2: _calculo(Decimal("3.0"), Decimal("2.2"), 3),
        3: {"rentabilidad": None, "error": "sin cierre"},
    }}
    filas = rp._filas_vivas([_fila("a"), _fila("b"), _fila("c")], vivo, [1, 2, 3])
    assert [f.equipo.nombre for f in filas] == ["b", "a", "c"]
    assert (filas[0].puntos, filas[0].dif_sp) == (3, Decimal("2.2"))
    assert filas[2].rentabilidad is None and filas[2].puntos is None


def _preparar(monkeypatch, llamadas: list) -> None:
    @contextmanager
    def sesion(_fabrica):
        yield object()

    def calcular(_db, _j, dia):
        llamadas.append(dia)
        return {"dia": dia, "sp_rentabilidad": Decimal("1.5"),
                "filas": [{"inscripcion_id": 7, "rentabilidad": Decimal("2.0"),
                           "dif": Decimal("0.5"), "puntos": 1}]}

    diario.olvidar_vivo()
    monkeypatch.setattr(diario, "sesion", sesion)
    monkeypatch.setattr(diario, "jornada", lambda _db, _id: SimpleNamespace(estado="formada"))
    monkeypatch.setattr(diario, "ultimo_dia", lambda _db, _j: date(2026, 10, 9))
    monkeypatch.setattr(diario, "calcular", calcular)


def test_la_tabla_viva_se_calcula_una_vez_por_ventana_de_tiempo(monkeypatch) -> None:
    llamadas: list = []
    _preparar(monkeypatch, llamadas)
    ahora = [1000.0]
    a = diario.vivo(1, reloj=lambda: ahora[0])
    b = diario.vivo(1, reloj=lambda: ahora[0] + diario._VIVO_TTL - 1)
    assert a is b and len(llamadas) == 1
    assert a["dia"] == date(2026, 10, 9) and a["sp"] == Decimal("1.5")
    assert a["por_inscripcion"][7]["puntos"] == 1
    diario.vivo(1, reloj=lambda: ahora[0] + diario._VIVO_TTL + 1)
    assert len(llamadas) == 2
    diario.olvidar_vivo()


def test_si_el_calculo_falla_la_web_recibe_none_y_no_un_error(monkeypatch) -> None:
    _preparar(monkeypatch, [])
    monkeypatch.setattr(diario, "calcular", lambda *_a: (_ for _ in ()).throw(ValueError("x")))
    assert diario.vivo(2) is None
    diario.olvidar_vivo()


def test_una_jornada_que_no_esta_en_juego_no_tiene_tabla_viva(monkeypatch) -> None:
    _preparar(monkeypatch, [])
    monkeypatch.setattr(diario, "jornada", lambda _db, _id: SimpleNamespace(estado="cerrada"))
    assert diario.vivo(3) is None
    diario.olvidar_vivo()
