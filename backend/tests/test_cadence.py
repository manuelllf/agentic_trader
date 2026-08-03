"""Cadencia de decisión: el escaneo semanal es OBSERVATORIO (aprende sin tocar libros);
la cartera —sombra y propuestas a la real— solo se decide en el primer escaneo programado
del mes o en los escaneos manuales."""

from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    scan_service,
    scheduler,
)
from app.db import Base
from app.ledger import service as ledger
from app.models import BOOK_SHADOW, Approval, Proposal

_ET = ZoneInfo("America/New_York")


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class FakeLLM:
    def __init__(self, reply: str) -> None:
        self._reply = reply

    def chat(self, system: str, user: str, *, temperature: float = 0.3) -> str:
        return self._reply


_FAKE_REPLY = (
    '{"score": 90, "headline": "tesis", "report": "informe", "target_price": 150.0, '
    '"cash_pct": 0, "positions": [{"ticker": "AAA", "weight_pct": 100, '
    '"thesis": "t", "edge": "e", "risk": "r"}], "summary": "cartera concentrada", '
    '"regime": "neutral", "outlook": "estable", "favored_sectors": [], "avoided_sectors": []}'
)


def _stub_universo(monkeypatch, symbols: list[str]) -> None:
    """Universo fijo, como si viniera de la foto del último cierre."""
    from app.screener import universe as universe_mod

    monkeypatch.setattr(universe_mod, "build_universe", lambda: list(symbols))
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(symbols),
        {"fuente": "cierre", "at": "2026-07-27T20:30:00+00:00", "dias": 0, "size": len(symbols)},
    ))


def _stub_scan(monkeypatch) -> None:
    """El pipeline entero baratamente stubeado (mismo patrón que test_autoexec)."""
    from app import tracking
    from app.screener import fundamentals as fund_mod
    from app.screener import macro as macro_mod
    from app.screener.fundamentals import NameData

    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: FakeLLM(_FAKE_REPLY))
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    _stub_universo(monkeypatch, ["AAA"])
    monkeypatch.setattr(fund_mod, "gather", lambda t: NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ))
    monkeypatch.setattr(macro_mod, "get_macro_outlook", lambda llm, db=None: {
        "regime": "neutral", "vix": 15.0, "outlook": "estable",
        "favored_sectors": [], "avoided_sectors": [], "snapshot": "n/d",
    })
    monkeypatch.setattr(tracking, "live_prices", lambda _tickers: {"AAA": 100.0})
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)


def test_observatory_scan_learns_without_touching_books(db, monkeypatch) -> None:
    """decide=False: refresca el conocimiento (ranking) pero NO inventa propuesta, NO toca la
    sombra y NO crea aprobaciones para la real."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    # El ranking visible es el de la última DECISIÓN: sin una previa no hay qué refrescar, así
    # que se siembra una fila (como si viniera de un escaneo decidido anterior).
    db.add(models.Score(ticker="AAA", sector="Technology", score=1))
    db.commit()

    result = scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    assert result["decided"] is False
    assert db.query(models.Score).one().score == 90               # el ranking SÍ se refrescó
    assert db.query(Proposal).count() == 0                       # sin propuesta nueva
    assert db.query(Approval).count() == 0                       # cero propuestas a la real
    assert ledger.open_positions(db, BOOK_SHADOW) == []          # la sombra ni se ejecutó


def test_observatory_scan_preserves_decided_portfolio(db, monkeypatch) -> None:
    """Un observatorio DESPUÉS de una decisión no pisa nada: la cartera sombra y la propuesta
    decidida sobreviven intactas (cada elección vive su mes)."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5)           # decisión: compra AAA
    pos_before = {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)}
    prop_id = db.query(Proposal).one().id
    assert pos_before == {"AAA"}

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    assert {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)} == pos_before
    assert db.query(Proposal).one().id == prop_id                # la propuesta decidida sigue


def test_observatorio_actualiza_coincidencia_sin_borrar_el_resto(db, monkeypatch) -> None:
    """El observatorio ya NO pisa el ranking de la última decisión: los nombres que hoy no se
    re-analizan sobreviven intactos, y el que sí coincide se refresca con los datos nuevos."""
    from app import watchlist as watchlist_mod

    _stub_scan(monkeypatch)
    _stub_universo(monkeypatch, ["AAA", "BBB"])
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5)          # decisión: ranking = {AAA, BBB}
    assert {s.ticker for s in db.query(models.Score).all()} == {"AAA", "BBB"}
    watchlist_mod.drop(db, {"BBB"})   # BBB deja de arrastrarse: el próximo escaneo no la re-analiza

    _stub_universo(monkeypatch, ["AAA"])
    otra_reply = _FAKE_REPLY.replace('"score": 90', '"score": 77')
    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: FakeLLM(otra_reply))
    result = scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    rows = {s.ticker: s for s in db.query(models.Score).all()}
    assert set(rows) == {"AAA", "BBB"}          # BBB sigue en el ranking, intacta
    assert rows["BBB"].score == 90              # no se tocó: no coincidió con los profundos de hoy
    assert rows["AAA"].score == 77              # sí se refrescó
    assert result["refreshed"] == 1


def test_decision_sigue_reemplazando_el_ranking_entero(db, monkeypatch) -> None:
    """Una DECISIÓN conserva el comportamiento de siempre: borra la tabla Score entera y la
    reescribe solo con los profundos de ESTE escaneo — a diferencia del observatorio, que
    conserva lo que no coincide."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    # Fila de un escaneo previo que ya no aparece en el universo de este escaneo.
    db.add(models.Score(ticker="ZZZ", sector="Old", score=50))
    db.commit()

    result = scan_service.run_scan_and_store(db, sample_size=5)     # decisión: universo = {AAA}

    assert {s.ticker for s in db.query(models.Score).all()} == {"AAA"}   # ZZZ desapareció
    assert result["refreshed"] is None            # no aplica: fue reemplazo total, no refresco


def test_default_scan_decides_both_books(db, monkeypatch) -> None:
    """Sin argumento (escaneo manual / cadencia única): ciclo completo — la sombra se ejecuta
    y la real recibe sus propuestas."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    result = scan_service.run_scan_and_store(db, sample_size=5)

    assert result["decided"] is True
    assert db.query(Approval).count() >= 1
    assert {p.ticker for p in ledger.open_positions(db, BOOK_SHADOW)} == {"AAA"}


def test_decision_due_only_first_scheduled_week(monkeypatch) -> None:
    """El primer escaneo programado del mes cae siempre en día 1-7; el resto, observatorio."""
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", True)
    assert scheduler.decision_due(datetime(2026, 7, 7, 10, 15, tzinfo=_ET)) is True
    assert scheduler.decision_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is False
    assert scheduler.decision_due(datetime(2026, 7, 28, 10, 15, tzinfo=_ET)) is False

    # Cadencia única (flag apagado): todos los escaneos deciden.
    monkeypatch.setattr(scheduler.settings, "real_proposals_monthly", False)
    assert scheduler.decision_due(datetime(2026, 7, 14, 10, 15, tzinfo=_ET)) is True


# ---- informe persistido del escaneo (panel de errores) -----------------------

def _last_report(db) -> dict:
    return json.loads(db.get(models.Meta, "last_scan_report").value)


def test_scan_writes_persistent_report(db, monkeypatch) -> None:
    """Cada escaneo (observatorio y decisión) deja su informe en Meta con modo, contadores y
    novedades; con el pipeline stubeado, cero incidencias."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    rep = _last_report(db)
    assert rep["mode"] == "observatorio" and rep["error"] is None
    assert rep["issues"] == [] and rep["deep"] == 1
    # Sin decisión previa no hay ranking que coincida: nada se refresca y el ranking no lleva
    # novedades (el observatorio no lo puebla); pero SÍ aprende — AAA entra a la watchlist.
    assert rep["refreshed"] == 0
    assert not any(c.startswith("Ranking") for c in rep["changes"])
    assert any("Watchlist" in c and "entra AAA" in c for c in rep["changes"])

    scan_service.run_scan_and_store(db, sample_size=5)
    rep = _last_report(db)
    assert rep["mode"] == "decisión" and rep["error"] is None
    assert rep["refreshed"] is None
    # la decisión SÍ puebla el ranking (reemplazo total) y compra AAA → sale de la watchlist
    assert any("Ranking" in c and "entran AAA" in c for c in rep["changes"])
    assert any("Watchlist" in c and "sale AAA" in c for c in rep["changes"])


def test_scan_report_records_issues(db, monkeypatch) -> None:
    """Un nombre sin datos de mercado queda anotado como incidencia (antes: solo en logs)."""
    from app.screener import fundamentals as fund_mod
    from app.screener.fundamentals import NameData

    _stub_scan(monkeypatch)
    _stub_universo(monkeypatch, ["AAA", "BBB"])
    monkeypatch.setattr(fund_mod, "gather", lambda t: None if t == "BBB" else NameData(
        ticker=t, sector="Technology", industry="Software", price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[],
    ))
    ledger.allocate(db, 1000)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert any("BBB" in i and "sin datos" in i for i in _last_report(db)["issues"])


def test_scan_report_registra_novedades_del_ranking(db, monkeypatch) -> None:
    """Entre dos DECISIONES con distinto universo, el informe dice qué ENTRA y qué SALE del
    ranking — el reemplazo de la tabla Score era mudo y las novedades invisibles. (El
    observatorio ya no reemplaza la tabla entera, así que esta novedad solo se ve cuando el
    conjunto del ranking cambia de verdad: una decisión.)"""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5)          # decisión: ranking = {AAA} (compra)
    ledger.reset_shadow_book(db)   # libera la posición: el 2º escaneo no arrastra AAA por "held"

    _stub_universo(monkeypatch, ["BBB"])
    scan_service.run_scan_and_store(db, sample_size=5)          # decisión: ranking = {BBB}

    texto = " ".join(_last_report(db)["changes"])
    assert "entran BBB" in texto and "salen AAA" in texto


# ---- universo: sin foto del cierre no se decide ------------------------------

def test_decision_se_aborta_sin_foto_del_universo(db, monkeypatch) -> None:
    """Con el mercado abierto, NASDAQ solo ha contado medio día de volumen y el universo sale
    recortado. Un observatorio así avisa y sigue; una DECISIÓN mensual se aborta: elegir la
    cartera del mes mirando una fracción del mercado no es una decisión, es un accidente."""
    from app.screener import universe as universe_mod

    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        ["AAA"], {"fuente": "vivo", "at": None, "dias": None, "size": 1}))

    with pytest.raises(RuntimeError, match="Decisión abortada"):
        scan_service.run_scan_and_store(db, sample_size=5, decide=True)

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)   # observatorio sí corre
    assert any("EN VIVO" in i for i in _last_report(db)["issues"])


def test_escaneo_se_aborta_con_universo_de_emergencia(db, monkeypatch) -> None:
    """40 nombres de SEED no son un mercado: mejor un fallo visible en el panel que un ranking
    con pinta de normal."""
    from app.screener import universe as universe_mod

    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        ["AAA"], {"fuente": "seed", "at": None, "dias": None, "size": 40}))

    with pytest.raises(RuntimeError, match="Sin universo"):
        scan_service.run_scan_and_store(db, sample_size=5, decide=False)


# ---- memoria del embudo: badge, profundos no parseables y cursor rotatorio ----

def test_badge_de_seguimiento_dice_la_verdad_del_final(db, monkeypatch) -> None:
    """El badge se estampaba ANTES de actualizar la watchlist, así que iba un escaneo por
    detrás. Ahora se re-sella al final contra la watchlist REAL de después — también en
    observatorio, que solo actualiza filas existentes (no las crea)."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    # Fila de una decisión previa (AAA analizada, sin comprar esa vez).
    db.add(models.Score(ticker="AAA", sector="Technology", score=1, on_watchlist=False))
    db.commit()

    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert db.query(models.Score).one().on_watchlist is True    # AAA entra a vigilancia hoy

    scan_service.run_scan_and_store(db, sample_size=5)        # decide → compra AAA
    assert db.query(models.Score).one().on_watchlist is False


def test_profundo_no_parseable_ni_puntua_ni_borra_watchlist(db, monkeypatch) -> None:
    """El scorer profundo va de 1 a 100: un 0 solo puede ser fallo de parseo. Se quedaba en el
    ranking como puntuación legítima Y, por debajo del umbral de expulsión, echaba al nombre de
    la watchlist — un fallo del LLM borraba memoria del agente."""
    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)   # AAA entra a vigilancia
    from app import watchlist as watchlist_mod
    assert watchlist_mod.tickers(db) == ["AAA"]

    # Solo falla el PROFUNDO: get_llm() sin argumentos es el caro; con modelo, el del pre-score.
    cero = _FAKE_REPLY.replace('"score": 90', '"score": 0')
    monkeypatch.setattr(scan_service, "get_llm",
                        lambda *a, **k: FakeLLM(_FAKE_REPLY if a else cero))
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)

    assert db.query(models.Score).count() == 0                 # fuera del ranking
    assert watchlist_mod.tickers(db) == ["AAA"]                # la memoria sobrevive al fallo
    assert any("no parseable" in i and "AAA" in i for i in _last_report(db)["issues"])


def test_cursor_rotatorio_no_avanza_si_el_escaneo_revienta(db, monkeypatch) -> None:
    """Avanzaba nada más construir la muestra: un escaneo que reventaba a mitad quemaba su
    franja del universo y esos nombres no volvían hasta la siguiente vuelta entera."""
    from app.screener import macro as macro_mod

    _stub_scan(monkeypatch)
    ledger.allocate(db, 1000)
    monkeypatch.setattr(macro_mod, "get_macro_outlook",
                        lambda llm, db=None: (_ for _ in ()).throw(RuntimeError("boom")))

    with pytest.raises(RuntimeError):
        scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert scan_service._scan_cursor(db) == 0                  # la franja no se consumió

    _stub_scan(monkeypatch)                                    # el macro vuelve a funcionar
    scan_service.run_scan_and_store(db, sample_size=5, decide=False)
    assert scan_service._scan_cursor(db) == 5                  # escaneo completo → sí avanza


def test_scan_failure_writes_report(db) -> None:
    """Si el escaneo revienta entero, el envoltorio deja el informe con el error — antes,
    un cron caído era invisible en la web (seguía enseñando datos viejos sin señal)."""
    scan_service.write_scan_failure(db, RuntimeError("boom"))
    rep = _last_report(db)
    assert rep["error"] == "boom" and rep["mode"] is None and rep["issues"] == []
