"""Estrategia Jev (sombra sin dinero) y macro sin LLM: la cartera mecánica, lo que guarda el
escaneo y qué bloque macro ve cada etapa. Jev falso sin red y DeepSeek falso: cero LLM real."""

from __future__ import annotations

import json
import re
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import (
    models,  # noqa: F401  (registra las tablas)
    portfolio_service,
    scan_audit,
    scan_config,
    scan_llm_stage,
    scan_service,
)
from app.db import Base
from app.llm import jev as jev_mod
from app.llm.jev import JevProvider
from app.models import Proposal, ScanAudit, ScanRun, ScanRunIssue, Trade
from app.screener import macro as macro_mod
from app.screener.fundamentals import NameData


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _par(ticker: str, score: float, industry: str = "Software", confidence: float | None = 0.8,
         market_cap: float = 1e9):
    p = SimpleNamespace(ticker=ticker, score=score, confidence=confidence)
    d = SimpleNamespace(ticker=ticker, industry=industry, market_cap=market_cap)
    return p, d


# ---- cartera mecánica ---------------------------------------------------------------------

def test_cartera_jev_respeta_el_tope_por_industria() -> None:
    pares = [_par("A1", 90, "Semis"), _par("A2", 89, "Semis"), _par("A3", 88, "Semis"),
             _par("B1", 80, "Gold"), _par("C1", 70, "Banks"), _par("D1", 60, "Retail")]
    out = portfolio_service.cartera_jev(pares, set(), 5, 2)
    assert [p.ticker for p, _d in out] == ["A1", "A2", "B1", "C1", "D1"]


def test_cartera_jev_aparta_opadas_y_sin_industria() -> None:
    pares = [_par("OPA", 99, "Semis"), _par("ND", 98, "n/d"), _par("VACIA", 97, " "),
             _par("OK", 50, "Gold")]
    out = portfolio_service.cartera_jev(pares, {"OPA"}, 5, 2)
    assert [p.ticker for p, _d in out] == ["OK"]      # menos de 5 candidatos: no rellena


def test_cartera_jev_desempata_por_confianza_y_luego_por_tamano() -> None:
    pares = [_par("POCA", 80, "A", confidence=0.5), _par("MUCHA", 80, "B", confidence=0.9),
             _par("SIN", 80, "C", confidence=None, market_cap=9e12),
             _par("GRANDE", 70, "D", market_cap=5e12), _par("PEQUE", 70, "E", market_cap=1e9)]
    out = portfolio_service.cartera_jev(pares, set(), 5, 2)
    assert [p.ticker for p, _d in out] == ["MUCHA", "POCA", "SIN", "GRANDE", "PEQUE"]


def test_cartera_jev_sin_candidatos_es_vacia() -> None:
    assert portfolio_service.cartera_jev([], set(), 5, 2) == []


# ---- combinación y columnas de Jev ---------------------------------------------------------

def _answers(niveles: dict[str, float], conf: float = 0.8) -> dict:
    return {q: {"score": niveles[k], "confidence": conf} for k, q in jev_mod.PREGUNTAS.items()}


def test_combinar_normaliza_pesos_que_no_suman_uno(monkeypatch) -> None:
    monkeypatch.setattr(jev_mod.settings, "jev_pesos",
                        {"fundamentals": 2.0, "valuation": 0.0, "financing": 0.0,
                         "catalyst": 0.0})
    nota = jev_mod._combinar(_answers({"fundamentals": 9.0, "valuation": 0.0,
                                       "financing": 0.0, "catalyst": 0.0}))
    assert nota["score"] == 100.0                     # solo cuenta fundamentals


def test_combinar_sin_confianza_conserva_la_nota() -> None:
    """La confianza es telemetría: que falte en una pregunta no puede costar el nombre."""
    answers = _answers(dict.fromkeys(jev_mod.PREGUNTAS, 5.0), conf=0.6)
    del answers["valuation_score"]["confidence"]
    answers["catalyst_score"]["confidence"] = None
    nota = jev_mod._combinar(answers)
    assert nota["score"] == 56.0
    assert nota["confidence"] == 0.6                  # media de las dos que sí la traen
    assert nota["dimensiones"]["valuation"] == [5.0, None]
    todas_fuera = _answers(dict.fromkeys(jev_mod.PREGUNTAS, 5.0))
    for a in todas_fuera.values():
        a["confidence"] = None
    assert jev_mod._combinar(todas_fuera)["confidence"] is None


def test_combinar_sin_nota_en_una_pregunta_es_fallo() -> None:
    answers = _answers(dict.fromkeys(jev_mod.PREGUNTAS, 5.0))
    del answers["valuation_score"]["score"]
    with pytest.raises(KeyError):
        jev_mod._combinar(answers)


def test_columnas_jev_escalan_y_redondean() -> None:
    cols = scan_audit._columnas_jev({"fundamentals": [7.835, 0.9125], "catalyst": [5.0, None]})
    assert cols == {"jev_fundamentals": 784, "jev_fundamentals_conf": 912,
                    "jev_catalyst": 500, "jev_catalyst_conf": None}
    assert scan_audit._columnas_jev(None) == {}


# ---- interruptor "Macro en Jev" ------------------------------------------------------------

def test_interruptor_jev_macro_cae_al_default_y_se_guarda(db, monkeypatch) -> None:
    from app.models import Meta

    monkeypatch.setattr(scan_config.settings, "jev_macro", False)
    assert scan_config.jev_macro_activa(db) is False
    db.add(Meta(key="scan_jev_macro", value="basura"))
    db.commit()
    assert scan_config.jev_macro_activa(db) is False  # valor raro = default, no un sí
    assert scan_config.set_jev_macro(db, True) is True
    assert scan_config.jev_macro_activa(db) is True
    monkeypatch.setattr(scan_config.settings, "jev_macro", False)
    assert scan_config.jev_macro_activa(db) is True   # lo guardado manda sobre settings


# ---- macro sin LLM -------------------------------------------------------------------------

def _df_mercado() -> pd.DataFrame:
    """Un año de cierres: 10y de 4.00 a 4.99 (+0.01/día), el resto a +0.1%/día."""
    n = 100
    idx = pd.date_range("2026-01-01", periods=n)
    cols = {}
    for tk in ["SPY", "QQQ", "IWM", "^VIX", "^TNX", "^IRX", "DX-Y.NYB", "GC=F", "HYG"]:
        if tk == "^TNX":
            serie = [4.0 + 0.01 * i for i in range(n)]
        else:
            serie = [100 * 1.001 ** i for i in range(n)]
        cols[(tk, "Close")] = serie
    return pd.DataFrame(cols, index=idx)


def test_datos_mercado_da_niveles_y_cambios_sin_petroleo(monkeypatch) -> None:
    monkeypatch.setattr(macro_mod.yf, "download", lambda *a, **k: _df_mercado())
    monkeypatch.setattr(macro_mod.yf, "Ticker",
                        lambda _t: SimpleNamespace(news=[{"title": " Fed holds "}, {}]))
    datos, titulares = macro_mod._datos_mercado()
    assert "10y yield 4.99% (+0.21 pp 1m, +0.63 pp 3m)." in datos
    assert datos.startswith("VIX ")
    for fuera in ("Oil", "WTI", "MA200", "52w"):
        assert fuera not in datos
    assert titulares == ["Fed holds"]


def test_datos_mercado_con_yahoo_caido_no_revienta(monkeypatch) -> None:
    def _boom(*_a, **_k):
        raise RuntimeError("yahoo caído")

    monkeypatch.setattr(macro_mod.yf, "download", _boom)
    assert macro_mod._datos_mercado() == ("", [])
    assert macro_mod.bloque_macro({"datos": ""}) == "n/d"


def test_datos_mercado_con_tabla_vacia_avisa_en_el_log(monkeypatch, caplog) -> None:  # noqa: ANN001
    """yfinance suele devolver un DataFrame vacío en vez de lanzar: tiene que dejar rastro."""
    monkeypatch.setattr(macro_mod.yf, "download", lambda *a, **k: pd.DataFrame())
    monkeypatch.setattr(macro_mod.yf, "Ticker", lambda _t: SimpleNamespace(news=[]))

    with caplog.at_level("WARNING", logger=macro_mod.logger.name):
        assert macro_mod._datos_mercado() == ("", [])
    assert "Datos macro vacíos" in caplog.text


def test_get_macro_solo_usa_gdelt_si_google_news_falla(monkeypatch) -> None:
    from app.screener import events as events_mod

    llamadas: list[str] = []
    monkeypatch.setattr(macro_mod, "get_macro_regime", lambda: {"regime": "neutral", "vix": 15})
    monkeypatch.setattr(macro_mod, "_datos_mercado", lambda: ("VIX 15.0.", ["Y1"]))
    monkeypatch.setattr(events_mod, "wikipedia_current_events", lambda days, db=None: "ev")
    monkeypatch.setattr(events_mod, "wikipedia_scheduled_events", lambda db=None: "cal")
    monkeypatch.setattr(events_mod, "google_news_headlines", lambda db=None: [])
    monkeypatch.setattr(events_mod, "gdelt_headlines",
                        lambda db=None: llamadas.append("gdelt") or ["D1"])

    m = macro_mod.get_macro()
    assert llamadas == ["gdelt"]
    assert m["macro_headlines"] == {"yfinance": ["Y1"], "gnews": [], "gdelt": ["D1"]}
    assert macro_mod.bloque_macro(m).endswith("Recent market headlines:\n- Y1\n- D1")


def test_bloque_con_contexto_omite_secciones_vacias() -> None:
    assert macro_mod.bloque_macro({"datos": "VIX 15.0.", "wiki_events_text": "",
                                   "macro_headlines": {}}) == "VIX 15.0."


# ---- el escaneo con Jev falso --------------------------------------------------------------

# Nivel 0-9 de las 4 preguntas por ticker: la nota sale en ese orden.
_NIVELES = {"ND": 9.0, "A1": 8.0, "A2": 7.9, "A3": 7.8, "OPA": 7.5, "B1": 7.0, "C1": 6.0,
            "D1": 5.0}
_INDUSTRIA = {"ND": "n/d", "A1": "Semis", "A2": "Semis", "A3": "Semis", "OPA": "Oil",
              "B1": "Gold", "C1": "Banks", "D1": "Retail"}


class JevFalso(JevProvider):
    """El proveedor real salvo la llamada HTTP: guarda cada `state` para ver qué macro recibió."""

    def __init__(self) -> None:
        super().__init__(api_key="fake", stage="prescore")
        self.states: list[str] = []

    def _request(self, user: str) -> dict:
        self.states.append(user)
        ticker = re.search(r"^(\S+?)(?:\s\([^)]*\))?\s+—", user, re.MULTILINE).group(1)
        return jev_mod._combinar(_answers(dict.fromkeys(jev_mod.PREGUNTAS, _NIVELES[ticker])))


class DeepFalso:
    """Informe profundo (con 'Company: X') y constructor (resto): recoge los prompts."""

    def __init__(self) -> None:
        self.users: list[str] = []

    def chat(self, system: str, user: str, *, temperature: float = 0.3,
            top_p: float | None = None) -> str:
        self.users.append(user)
        m = re.search(r"Company: (\S+)", user)
        if m:
            return json.dumps({"report": "informe", "headline": "h", "score": 70,
                               "under_acquisition": m.group(1) == "OPA"})
        t = re.search(r"^(\S+) \([^)]*, cap ", user, re.MULTILINE).group(1)
        return json.dumps({"positions": [{"ticker": t, "weight_pct": 100, "thesis": "t",
                                          "edge": "e", "risk": "r"}], "summary": "cartera"})


def _stub_escaneo(monkeypatch, prescore) -> DeepFalso:  # noqa: ANN001
    from app import tracking
    from app.screener import fundamentals as fund_mod
    from app.screener import universe as universe_mod

    deep = DeepFalso()

    def fake_get_llm(model: str | None = None, **kw):
        return prescore if kw.get("provider") == "jev" else deep

    monkeypatch.setattr(scan_service, "get_llm", fake_get_llm)
    monkeypatch.setattr(scan_llm_stage, "get_llm", fake_get_llm)
    monkeypatch.setattr(scan_llm_stage.settings, "typesafe_api_key", "fake")
    monkeypatch.setattr(scan_llm_stage.settings, "prescore_provider", "jev")
    monkeypatch.setattr(scan_service.settings, "llm_provider", "deepseek")
    monkeypatch.setattr(scan_service.settings, "always_deep_tickers", [])
    monkeypatch.setattr(scan_service.settings, "max_position_pct", 100.0)
    monkeypatch.setattr(scan_service.settings, "min_positions", 1)
    monkeypatch.setattr(scan_service, "_memory_store", lambda: None)
    monkeypatch.setattr(scan_service.time, "sleep", lambda s: None)
    monkeypatch.setattr(universe_mod, "universe_for_scan", lambda db: (
        list(_NIVELES), {"fuente": "cierre", "at": "2026-09-23T20:30:00+00:00", "dias": 0,
                         "size": len(_NIVELES)}))
    monkeypatch.setattr(fund_mod, "gather", lambda t, db=None, **kw: (NameData(
        ticker=t, sector="Tech", industry=_INDUSTRIA[t], price=100.0,
        fundamentals_text="- P/E: 20", technical_text="RSI 55", market_cap=5e9, news=[]), None))
    monkeypatch.setattr(macro_mod, "get_macro", lambda db=None: {
        "regime": "neutral", "vix": 15.0, "datos": "VIX 15.0.",
        "wiki_events_text": "Strait of Hormuz: tanker attacked.",
        "macro_headlines": {"gnews": ["Fed hikes rates"]},
    })
    monkeypatch.setattr(tracking, "live_prices", lambda tickers: dict.fromkeys(tickers, 100.0))
    return deep


_ESPERADA = ["A1", "A2", "B1", "C1", "D1"]   # sin ND (sin industria), A3 (tope), OPA (opada)


def test_escaneo_con_jev_guarda_su_cartera_y_sus_4_notas(db, monkeypatch) -> None:
    jev = JevFalso()
    _stub_escaneo(monkeypatch, jev)

    result = scan_service.run_scan_and_store(db, decide=True)

    assert [p["ticker"] for p in result["jev_cartera"]] == _ESPERADA
    assert {p["weight_pct"] for p in result["jev_cartera"]} == {20.0}
    filas = {r.ticker: r for r in db.query(ScanAudit).all()}
    assert {t for t, r in filas.items() if r.jev_funded} == set(_ESPERADA)
    assert filas["A3"].jev_funded is False
    assert filas["A1"].jev_fundamentals == 800 and filas["A1"].jev_catalyst_conf == 800
    assert db.query(ScanRun).one().jev_macro is False


def test_por_defecto_jev_ve_solo_datos_y_deepseek_el_macro_completo(db, monkeypatch) -> None:
    jev = JevFalso()
    deep = _stub_escaneo(monkeypatch, jev)

    scan_service.run_scan_and_store(db, decide=False)

    assert all("Hormuz" not in s and "Fed hikes" not in s for s in jev.states)
    assert all("VIX 15.0." in s for s in jev.states)
    profundos = [u for u in deep.users if "Company:" in u]
    assert profundos and all("Recent events (last 7 days):" in u for u in profundos)
    constructor = [u for u in deep.users if "Company:" not in u]
    assert constructor and "Fed hikes rates" in constructor[0]


def test_con_el_interruptor_jev_ve_eventos_y_titulares(db, monkeypatch) -> None:
    jev = JevFalso()
    _stub_escaneo(monkeypatch, jev)
    scan_config.set_jev_macro(db, True)

    scan_service.run_scan_and_store(db, decide=False)

    assert all("Hormuz" in s and "Fed hikes rates" in s for s in jev.states)
    assert db.query(ScanRun).one().jev_macro is True


def test_observatorio_calcula_la_cartera_jev_sin_tocar_dinero(db, monkeypatch) -> None:
    _stub_escaneo(monkeypatch, JevFalso())

    result = scan_service.run_scan_and_store(db, decide=False)

    assert [p["ticker"] for p in result["jev_cartera"]] == _ESPERADA
    assert db.query(Proposal).count() == 0 and db.query(Trade).count() == 0
    assert not any("Cartera Jev" in i.texto for i in db.query(ScanRunIssue).all())


def test_cartera_jev_incompleta_se_avisa(db, monkeypatch) -> None:
    """Con menos nombres de los pedidos cada uno pesa más del 20%: que se vea en el informe."""
    _stub_escaneo(monkeypatch, JevFalso())
    monkeypatch.setattr(scan_service.settings, "jev_portfolio_n", 6)

    result = scan_service.run_scan_and_store(db, decide=False)

    assert len(result["jev_cartera"]) == 5
    assert {p["weight_pct"] for p in result["jev_cartera"]} == {20.0}
    avisos = [i.texto for i in db.query(ScanRunIssue).all()]
    assert any("Cartera Jev incompleta: 5 de 6" in a for a in avisos)


def test_sin_prescore_de_jev_no_hay_cartera_jev(db, monkeypatch) -> None:
    """Con otro prescore (override del modal), ni cartera ni flag: no se inventa."""
    class OtroPrescore:
        def chat(self, system: str, user: str, *, temperature: float = 0.3,
                top_p: float | None = None) -> str:
            return json.dumps({"score": 60})

    otro = OtroPrescore()
    deep = _stub_escaneo(monkeypatch, otro)
    monkeypatch.setattr(scan_llm_stage.settings, "typesafe_api_key", "")
    monkeypatch.setattr(scan_llm_stage.settings, "dashscope_api_key", "")

    def fake_get_llm(model: str | None = None, **kw):
        return otro if kw.get("stage") == "prescore" else deep

    monkeypatch.setattr(scan_llm_stage, "get_llm", fake_get_llm)

    result = scan_service.run_scan_and_store(db, decide=False)

    assert result["jev_cartera"] == [] and result["jev_macro"] is None
    assert all(r.jev_funded is None for r in db.query(ScanAudit).all())
    assert db.query(ScanRun).one().jev_macro is None


def test_recomponer_usa_el_macro_de_hoy_no_el_resumen_de_la_propuesta(db, monkeypatch) -> None:
    """Antes metía `Proposal.macro_summary` (un resumen en español) como si fuera el macro."""
    from app.models import Score

    deep = _stub_escaneo(monkeypatch, JevFalso())
    monkeypatch.setattr(scan_service, "get_llm", lambda *a, **k: deep)
    db.add(Proposal(cash_target_pct=0, macro_summary="RESUMEN VIEJO"))
    db.add(Score(ticker="A1", sector="Tech", score=80, headline="h", report="informe",
                 price=100.0, market_cap=5e9))
    db.commit()

    scan_service.recheck(db)

    assert "Fed hikes rates" in deep.users[-1] and "RESUMEN VIEJO" not in deep.users[-1]
    nueva = db.query(Proposal).order_by(Proposal.id.desc()).first()
    assert nueva.macro_summary == "cartera"          # el resumen del constructor
